-- Roll back app to old services BEFORE this script, under a write maintenance window.
-- This restores prior live-write policies. Reconciled rows remain historical.
begin;
lock table public.ride_sessions, public.session_participants, public.session_invites in share row exclusive mode;
drop trigger guard_session_participation on public.session_participants;
drop trigger guard_session_lifecycle on public.ride_sessions;
drop trigger finalize_session_lifecycle on public.ride_sessions;
drop trigger guard_session_invite on public.session_invites;
drop function public.guard_session_participation(), public.guard_session_lifecycle(), public.finalize_session_lifecycle(), public.guard_session_invite();
drop function public.create_session(jsonb), public.join_session(uuid,uuid), public.set_session_status(uuid,public.session_status), public.set_participant_status(uuid,public.participant_status), public.respond_to_session_invite(uuid,public.invite_status);
drop index public.session_participants_one_current_per_user;
drop policy location_pings_insert on public.location_pings;
create policy location_pings_insert on public.location_pings for insert to authenticated
with check(user_id=auth.uid() and public.is_session_participant(session_id));
drop policy session_queue_insert on public.session_queue;
create policy session_queue_insert on public.session_queue for insert to authenticated
with check(added_by=auth.uid() and (public.is_session_participant(session_id) or public.is_session_host(session_id)));
drop policy session_queue_update on public.session_queue;
create policy session_queue_update on public.session_queue for update to authenticated
using(public.is_session_participant(session_id) or public.is_session_host(session_id));
drop policy session_queue_delete on public.session_queue;
create policy session_queue_delete on public.session_queue for delete to authenticated
using(added_by=auth.uid() or public.is_session_host(session_id));
drop policy session_playback_state_update on public.session_playback_state;
create policy session_playback_state_update on public.session_playback_state for update to authenticated
using(public.is_session_participant(session_id) or public.is_session_host(session_id));
drop policy session_playback_state_insert on public.session_playback_state;
create policy session_playback_state_insert on public.session_playback_state for insert to authenticated
with check(public.is_session_host(session_id));
drop function public.is_current_session_participant(uuid);
notify pgrst, 'reload schema';
commit;
