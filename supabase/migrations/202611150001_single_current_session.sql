-- Apply AFTER schema.sql and supabase/rls_policies.sql. See the rollout runbook.
begin;
set local lock_timeout = '10s';
lock table public.ride_sessions, public.session_participants, public.session_invites in share row exclusive mode;

do $$
declare conflicts jsonb;
begin
  select jsonb_agg(to_jsonb(c)) into conflicts from (
    select 'duplicate_current' as problem, user_id, array_agg(session_id) as sessions
    from public.session_participants where status in ('joined','riding','paused')
    group by user_id having count(*) > 1
    union all
    select 'terminal_current', p.user_id, array_agg(p.session_id)
    from public.session_participants p join public.ride_sessions s using(session_id)
    where p.status in ('joined','riding','paused') and s.status in ('completed','cancelled') group by p.user_id
    union all
    select 'missing_current_host', s.host_id, array_agg(s.session_id)
    from public.ride_sessions s left join public.session_participants p
      on p.session_id = s.session_id and p.user_id = s.host_id
    where s.status not in ('completed','cancelled')
      and (p.user_id is null or p.role <> 'host' or p.status not in ('joined','riding','paused')) group by s.host_id
  ) c;
  if conflicts is not null then
    raise exception 'single_current_session preflight failed' using
      detail = conflicts::text,
      hint = 'Run supabase/diagnostics/current_session_conflicts.sql. Review survivor mapping; release extra guests and explicitly terminate conflicting host sessions. No rows were changed.';
  end if;
end $$;

create unique index session_participants_one_current_per_user
on public.session_participants(user_id) where status in ('joined','riding','paused');

-- Lock the parent before admitting participation. End/cancel takes the same lock,
-- so a join cannot commit after terminal cleanup with a stale parent snapshot.
create function public.guard_session_participation() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.ride_sessions;
begin
  if TG_OP = 'UPDATE' and (new.session_id <> old.session_id or new.user_id <> old.user_id or new.role <> old.role) then
    raise exception 'Participant identity and role cannot be changed';
  end if;
  select * into s from public.ride_sessions
    where session_id = case when TG_OP = 'DELETE' then old.session_id else new.session_id end for update;
  -- Cascading deletion of a parent has no remaining parent to guard.
  if not found and TG_OP = 'DELETE' then return old; end if;
  if not found then raise exception 'Session not found'; end if;
  if TG_OP = 'DELETE' then
    if old.user_id = s.host_id and s.status not in ('completed','cancelled') then
      raise exception 'Hosts must end or cancel their session before leaving';
    end if;
    return old;
  end if;
  if (new.role = 'host') <> (new.user_id = s.host_id) then
    raise exception 'Participant role must match session ownership';
  end if;
  if new.status in ('joined','riding','paused') and s.status in ('completed','cancelled') then
    raise exception 'Session has ended';
  end if;
  if new.user_id = s.host_id and new.status not in ('joined','riding','paused') and s.status not in ('completed','cancelled') then
    raise exception 'Hosts must end or cancel their session before leaving';
  end if;
  if new.bike_id is not null and not exists(select 1 from public.user_bikes where bike_id = new.bike_id and user_id = new.user_id) then
    raise exception 'Bike does not belong to participant';
  end if;
  if TG_OP = 'UPDATE' and old.status not in ('joined','riding','paused') and new.status in ('joined','riding','paused') then
    new.joined_at := now(); new.started_at := null; new.finished_at := null; new.left_at := null;
  end if;
  if new.status = 'riding' then new.started_at := coalesce(new.started_at, now()); end if;
  if new.status = 'finished' then new.finished_at := coalesce(new.finished_at, now()); end if;
  if new.status in ('left','dropped') then new.left_at := coalesce(new.left_at, now()); end if;
  return new;
end $$;
create trigger guard_session_participation before insert or update or delete on public.session_participants
for each row execute function public.guard_session_participation();

create function public.guard_session_lifecycle() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.host_id <> old.host_id or new.session_id <> old.session_id then
    raise exception 'Session ownership and identity cannot be changed';
  end if;
  if old.status in ('completed','cancelled') and new.status <> old.status then
    raise exception 'Terminal sessions cannot be reopened or remapped';
  end if;
  if new.status = 'active' then new.started_at := coalesce(old.started_at, new.started_at, now()); end if;
  if new.status in ('completed','cancelled') then new.ended_at := coalesce(old.ended_at, new.ended_at, now()); end if;
  return new;
end $$;
create trigger guard_session_lifecycle before update on public.ride_sessions
for each row execute function public.guard_session_lifecycle();

create function public.finalize_session_lifecycle() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if TG_OP = 'INSERT' and new.status not in ('completed','cancelled') then
    -- Direct table creation also reserves the host slot in this transaction.
    insert into public.session_participants(session_id,user_id,role,status)
      values(new.session_id,new.host_id,'host','joined');
    insert into public.session_playback_state(session_id,dj_user_id) values(new.session_id,new.host_id);
  elsif TG_OP = 'UPDATE' and new.status in ('completed','cancelled') and old.status <> new.status then
    update public.session_participants set
      status = case when new.status = 'completed' then 'finished'::public.participant_status else 'left'::public.participant_status end,
      finished_at = case when new.status = 'completed' then coalesce(finished_at,new.ended_at,now()) else finished_at end,
      left_at = case when new.status = 'cancelled' then coalesce(left_at,new.ended_at,now()) else left_at end
    where session_id = new.session_id and status in ('joined','riding','paused');
    update public.session_playback_state set is_playing = false where session_id = new.session_id;
  end if;
  return new;
end $$;
create trigger finalize_session_lifecycle after insert or update on public.ride_sessions
for each row execute function public.finalize_session_lifecycle();

create function public.create_session(p_input jsonb) returns public.ride_sessions
language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.ride_sessions; u uuid := auth.uid();
begin
  if u is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  insert into public.ride_sessions(host_id,title,description,route_id,visibility,max_participants,meetup_location,is_no_drop,scheduled_start,status)
  values(u,p_input->>'title',p_input->>'description',(p_input->>'route_id')::uuid,
    coalesce((p_input->>'visibility')::public.session_visibility,'private'),
    coalesce((p_input->>'max_participants')::smallint,20),
    case when p_input->'meetup_location' is not null and p_input->'meetup_location' <> 'null'::jsonb
      then public.ST_GeomFromGeoJSON((p_input->'meetup_location')::text)::public.geography else null end,
    coalesce((p_input->>'is_no_drop')::boolean,true),(p_input->>'scheduled_start')::timestamptz,'lobby') returning * into s;
  return s;
end $$;

create function public.join_session(p_session_id uuid, p_bike_id uuid default null) returns public.session_participants
language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.ride_sessions; p public.session_participants; u uuid := auth.uid();
begin
  if u is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select * into s from public.ride_sessions where session_id = p_session_id for update;
  if not found or not public.can_view_session(p_session_id) then
    raise exception 'Session not accessible' using errcode = '42501';
  end if;
  if s.status in ('completed','cancelled') then raise exception 'Session has ended'; end if;
  select * into p from public.session_participants where session_id = p_session_id and user_id = u;
  if found and p.status in ('joined','riding','paused') then return p; end if;
  insert into public.session_participants(session_id,user_id,bike_id,role,status)
    values(p_session_id,u,p_bike_id,case when s.host_id = u then 'host'::public.participant_role else 'guest'::public.participant_role end,'joined')
    on conflict(session_id,user_id) do update set status='joined', joined_at=now(), started_at=null,
      finished_at=null, left_at=null, bike_id=coalesce(excluded.bike_id,session_participants.bike_id)
    returning * into p;
  return p;
end $$;

create function public.set_session_status(p_session_id uuid, p_status public.session_status) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  update public.ride_sessions set status=p_status where session_id=p_session_id and host_id=auth.uid();
  if not found then raise exception 'Only the host may change session status' using errcode='42501'; end if;
end $$;

create function public.set_participant_status(p_session_id uuid, p_status public.participant_status) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  perform 1 from public.ride_sessions where session_id=p_session_id for update;
  -- Live-activity status messages cannot rejoin a departed interval. Only an
  -- explicit join (or an intentional direct write guarded by the index) can.
  update public.session_participants set status=p_status where session_id=p_session_id and user_id=auth.uid()
    and (status in ('joined','riding','paused') or p_status not in ('joined','riding','paused'));
  if not found then raise exception 'Current participant not found' using errcode='42501'; end if;
end $$;

-- A direct invite UPDATE must have the same transactional semantics as the RPC.
create function public.guard_session_invite() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if TG_OP = 'INSERT' then
    if new.status <> 'pending' then raise exception 'New invitations must be pending'; end if;
    return new;
  end if;
  if new.session_id <> old.session_id or new.invitee_id <> old.invitee_id or new.invited_by <> old.invited_by then
    raise exception 'Invitation identity cannot be changed';
  end if;
  if new.status = old.status then return new; end if;
  if old.status <> 'pending' then raise exception 'Invitation was already resolved'; end if;
  if new.status in ('accepted','declined') then
    if auth.uid() is distinct from old.invitee_id then raise exception 'Only the invitee may respond' using errcode='42501'; end if;
    if new.status = 'accepted' then perform public.join_session(old.session_id); end if;
    new.responded_at := coalesce(new.responded_at,now());
  end if;
  return new;
end $$;
create trigger guard_session_invite before insert or update on public.session_invites
for each row execute function public.guard_session_invite();

create function public.respond_to_session_invite(p_invite_id uuid, p_response public.invite_status) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or p_response not in ('accepted','declined') then raise exception 'Invalid invitation response' using errcode='42501'; end if;
  update public.session_invites set status=p_response where invite_id=p_invite_id and invitee_id=auth.uid();
  if not found then raise exception 'Invitation not accessible' using errcode='42501'; end if;
end $$;

-- Keep historical membership readable; require current membership for live writes.
create function public.is_current_session_participant(p_session_id uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists(select 1 from public.session_participants p join public.ride_sessions s using(session_id)
    where p.session_id=p_session_id and p.user_id=auth.uid() and p.status in ('joined','riding','paused')
      and s.status not in ('completed','cancelled'));
$$;
drop policy location_pings_insert on public.location_pings;
create policy location_pings_insert on public.location_pings for insert to authenticated
with check(user_id=auth.uid() and public.is_current_session_participant(session_id));
drop policy session_queue_insert on public.session_queue;
create policy session_queue_insert on public.session_queue for insert to authenticated
with check(added_by=auth.uid() and public.is_current_session_participant(session_id));
drop policy session_queue_update on public.session_queue;
create policy session_queue_update on public.session_queue for update to authenticated
using(public.is_current_session_participant(session_id)) with check(public.is_current_session_participant(session_id));
drop policy session_queue_delete on public.session_queue;
create policy session_queue_delete on public.session_queue for delete to authenticated
using(public.is_current_session_participant(session_id) and (added_by=auth.uid() or public.is_session_host(session_id)));
drop policy session_playback_state_update on public.session_playback_state;
create policy session_playback_state_update on public.session_playback_state for update to authenticated
using(public.is_current_session_participant(session_id)) with check(public.is_current_session_participant(session_id));
drop policy session_playback_state_insert on public.session_playback_state;
create policy session_playback_state_insert on public.session_playback_state for insert to authenticated
with check(public.is_session_host(session_id) and public.is_current_session_participant(session_id));

revoke all on function public.guard_session_participation(), public.guard_session_lifecycle(), public.finalize_session_lifecycle(), public.guard_session_invite() from public, anon, authenticated;
revoke all on function public.create_session(jsonb), public.join_session(uuid,uuid), public.set_session_status(uuid,public.session_status), public.set_participant_status(uuid,public.participant_status), public.respond_to_session_invite(uuid,public.invite_status), public.is_current_session_participant(uuid) from public, anon;
grant execute on function public.create_session(jsonb), public.join_session(uuid,uuid), public.set_session_status(uuid,public.session_status), public.set_participant_status(uuid,public.participant_status), public.respond_to_session_invite(uuid,public.invite_status), public.is_current_session_participant(uuid) to authenticated;
notify pgrst, 'reload schema';
commit;
