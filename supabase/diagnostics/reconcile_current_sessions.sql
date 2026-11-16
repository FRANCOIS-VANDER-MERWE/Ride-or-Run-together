-- ADMINISTRATOR REVIEW REQUIRED. Copy this file and fill the two mappings from
-- the read-only audit. Do not infer survivor choices from timestamps/localStorage.
-- This transaction changes statuses/timestamps only; it never deletes history.
begin;
set local lock_timeout = '10s';
lock table public.ride_sessions, public.session_participants in share row exclusive mode;
create temporary table session_survivors(user_id uuid primary key, retained_session_id uuid not null) on commit drop;
create temporary table session_terminations(session_id uuid primary key, terminal_status public.session_status not null check(terminal_status in ('completed','cancelled'))) on commit drop;

-- REVIEWED_MAPPING_INSERTS
-- insert into session_survivors values ('USER_UUID','RETAINED_SESSION_UUID');
-- insert into session_terminations values ('EXTRA_HOST_SESSION_UUID','cancelled');

do $$
begin
  if exists(select 1 from session_survivors m where not exists(
    select 1 from public.session_participants p join public.ride_sessions s using(session_id)
    where p.user_id=m.user_id and p.session_id=m.retained_session_id and p.status in ('joined','riding','paused')
      and s.status not in ('completed','cancelled') and not exists(select 1 from session_terminations t where t.session_id=s.session_id)
  )) then raise exception 'Every retained session must be a current nonterminal membership and must not be terminated'; end if;
  if exists(select 1 from session_terminations t where not exists(select 1 from public.ride_sessions s where s.session_id=t.session_id)) then
    raise exception 'Termination mapping contains a missing session';
  end if;
  if exists(select 1 from public.session_participants p join session_survivors m using(user_id)
    join public.ride_sessions s using(session_id)
    where p.session_id<>m.retained_session_id and p.status in ('joined','riding','paused')
      and (p.role='host' or p.user_id=s.host_id) and s.status not in ('completed','cancelled')
      and not exists(select 1 from session_terminations t where t.session_id=p.session_id)) then
    raise exception 'Conflicting host sessions require explicit termination; hosts cannot be silently demoted or removed';
  end if;
end $$;
update public.ride_sessions s set status=t.terminal_status, ended_at=coalesce(s.ended_at,now())
from session_terminations t where s.session_id=t.session_id and s.status not in ('completed','cancelled');

-- Also finalize stale current rows attached to already terminal sessions.
update public.session_participants p set
  status=case when s.status='completed' then 'finished'::public.participant_status else 'left'::public.participant_status end,
  finished_at=case when s.status='completed' then coalesce(p.finished_at,s.ended_at,now()) else p.finished_at end,
  left_at=case when s.status='cancelled' then coalesce(p.left_at,s.ended_at,now()) else p.left_at end
from public.ride_sessions s where s.session_id=p.session_id and s.status in ('completed','cancelled') and p.status in ('joined','riding','paused');
update public.session_participants p set status='left',left_at=coalesce(p.left_at,now())
from session_survivors m where p.user_id=m.user_id and p.session_id<>m.retained_session_id
  and p.role='guest' and p.status in ('joined','riding','paused');
do $$
begin
  if exists(select 1 from public.session_participants where status in ('joined','riding','paused') group by user_id having count(*)>1) then
    raise exception 'Unresolved duplicate memberships remain. Supply all reviewed choices; this reconciliation was rolled back';
  end if;
  if exists(select 1 from public.ride_sessions s left join public.session_participants p
    on p.session_id=s.session_id and p.user_id=s.host_id
    where s.status not in ('completed','cancelled') and (p.user_id is null or p.role<>'host' or p.status not in ('joined','riding','paused'))) then
    raise exception 'An open session has no current host. Explicitly repair or terminate it; this reconciliation was rolled back';
  end if;
end $$;
commit;
