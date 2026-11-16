-- Read-only. Run as an administrator before migration; retain the output privately.
-- This lists every current row, including parent state and host ownership.
select p.user_id, p.session_id, s.title, s.status as session_status,
       s.host_id, p.role, p.status, p.joined_at, p.started_at,
       p.finished_at, p.left_at
from public.session_participants p
join public.ride_sessions s using (session_id)
where p.status in ('joined', 'riding', 'paused')
order by p.user_id, p.joined_at;

-- Duplicate current memberships (never pick a survivor from cached UI state).
select user_id, count(*) as current_count,
       array_agg(session_id order by joined_at) as conflicting_sessions
from public.session_participants
where status in ('joined', 'riding', 'paused')
group by user_id having count(*) > 1;

-- Stale current rows on terminal parents, separately from duplicates.
select p.*, s.status as session_status, s.ended_at
from public.session_participants p
join public.ride_sessions s using (session_id)
where p.status in ('joined', 'riding', 'paused')
  and s.status in ('completed', 'cancelled');

-- An open host session also needs its current host row before rollout.
select s.session_id, s.host_id, s.status
from public.ride_sessions s
left join public.session_participants p
  on p.session_id = s.session_id and p.user_id = s.host_id
where s.status not in ('completed', 'cancelled')
  and (p.user_id is null or p.role <> 'host' or p.status not in ('joined', 'riding', 'paused'));
