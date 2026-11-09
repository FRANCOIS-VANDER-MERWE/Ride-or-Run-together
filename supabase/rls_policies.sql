-- =====================================================================
-- PACELOCK Row Level Security policies
--
-- WHY THIS FILE EXISTS: schema.sql (the pg_dump at the repo root)
-- enables Row Level Security on every public table but defines ZERO
-- policies. With RLS on and no policies, the Supabase API denies every
-- read and write to the anon and authenticated roles. Run this file in
-- the Supabase SQL editor (or supabase db push) AFTER schema.sql.
-- It is safe to re-run: policies are dropped and recreated.
--
-- Model: everything requires a signed-in user (role authenticated).
-- The security definer helpers below exist so policies can ask "is
-- this user in that session" without RLS recursing into itself.
-- =====================================================================

-- ---------- helpers ----------
create or replace function public.is_session_host(p_session_id uuid)
returns boolean language sql stable security definer
set search_path = public as $$
  select exists (
    select 1 from public.ride_sessions
    where session_id = p_session_id and host_id = auth.uid()
  );
$$;

create or replace function public.is_session_participant(p_session_id uuid)
returns boolean language sql stable security definer
set search_path = public as $$
  select exists (
    select 1 from public.session_participants
    where session_id = p_session_id and user_id = auth.uid()
  );
$$;

create or replace function public.has_session_invite(p_session_id uuid)
returns boolean language sql stable security definer
set search_path = public as $$
  select exists (
    select 1 from public.session_invites
    where session_id = p_session_id
      and invitee_id = auth.uid()
      and status in ('pending', 'accepted')
  );
$$;

create or replace function public.can_view_session(p_session_id uuid)
returns boolean language sql stable security definer
set search_path = public as $$
  select exists (
    select 1 from public.ride_sessions s
    where s.session_id = p_session_id
      and (
        s.visibility in ('public', 'friends')
        or s.host_id = auth.uid()
        or public.is_session_participant(p_session_id)
        or public.has_session_invite(p_session_id)
      )
  );
$$;


create or replace function public.is_playlist_owner(p_playlist_id uuid)
returns boolean language sql stable security definer
set search_path = public as $$
  select exists (
    select 1 from public.playlists
    where playlist_id = p_playlist_id and owner_id = auth.uid()
  );
$$;

create or replace function public.are_friends(p_other uuid)
returns boolean language sql stable security definer
set search_path = public as $$
  select exists (
    select 1 from public.friendships
    where status = 'accepted'
      and ((user_a_id = auth.uid() and user_b_id = p_other)
        or (user_b_id = auth.uid() and user_a_id = p_other))
  );
$$;

-- ---------- profiles ----------
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated using (true);
drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- user_stats ----------
drop policy if exists user_stats_select on public.user_stats;
create policy user_stats_select on public.user_stats
  for select to authenticated
  using (user_id = auth.uid() or public.are_friends(user_id));
drop policy if exists user_stats_insert on public.user_stats;
create policy user_stats_insert on public.user_stats
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists user_stats_update on public.user_stats;
create policy user_stats_update on public.user_stats
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- user_bikes ----------
drop policy if exists user_bikes_all on public.user_bikes;
create policy user_bikes_all on public.user_bikes
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- user_music_accounts (token blobs: owner only) ----------
drop policy if exists user_music_accounts_all on public.user_music_accounts;
create policy user_music_accounts_all on public.user_music_accounts
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- friendships ----------
drop policy if exists friendships_select on public.friendships;
create policy friendships_select on public.friendships
  for select to authenticated
  using (user_a_id = auth.uid() or user_b_id = auth.uid());
drop policy if exists friendships_insert on public.friendships;
create policy friendships_insert on public.friendships
  for insert to authenticated
  with check (
    requested_by = auth.uid()
    and (user_a_id = auth.uid() or user_b_id = auth.uid())
  );
drop policy if exists friendships_update on public.friendships;
create policy friendships_update on public.friendships
  for update to authenticated
  using (user_a_id = auth.uid() or user_b_id = auth.uid())
  with check (user_a_id = auth.uid() or user_b_id = auth.uid());
drop policy if exists friendships_delete on public.friendships;
create policy friendships_delete on public.friendships
  for delete to authenticated
  using (user_a_id = auth.uid() or user_b_id = auth.uid());

-- ---------- routes (shared content: any signed-in user can read) ----------
drop policy if exists routes_select on public.routes;
create policy routes_select on public.routes
  for select to authenticated using (true);
drop policy if exists routes_insert on public.routes;
create policy routes_insert on public.routes
  for insert to authenticated with check (created_by = auth.uid());
drop policy if exists routes_update on public.routes;
create policy routes_update on public.routes
  for update to authenticated
  using (created_by = auth.uid()) with check (created_by = auth.uid());
drop policy if exists routes_delete on public.routes;
create policy routes_delete on public.routes
  for delete to authenticated using (created_by = auth.uid());

-- ---------- ride_sessions ----------
drop policy if exists ride_sessions_select on public.ride_sessions;
-- NOTE: this policy deliberately does NOT call can_view_session().
-- That helper queries ride_sessions itself, and during an
-- INSERT ... RETURNING (what supabase-js .insert().select() sends) the
-- just-inserted row is not yet visible to a same-table query inside a
-- policy, so the visibility check failed and Postgres reported the
-- whole insert as an RLS violation. Direct column checks below are
-- evaluated against the actual row, and the two helpers query other
-- tables, so inserts with RETURNING pass.
create policy ride_sessions_select on public.ride_sessions
  for select to authenticated
  using (
    visibility in ('public', 'friends')
    or host_id = auth.uid()
    or public.is_session_participant(session_id)
    or public.has_session_invite(session_id)
  );
drop policy if exists ride_sessions_insert on public.ride_sessions;
create policy ride_sessions_insert on public.ride_sessions
  for insert to authenticated with check (host_id = auth.uid());
drop policy if exists ride_sessions_update on public.ride_sessions;
create policy ride_sessions_update on public.ride_sessions
  for update to authenticated
  using (host_id = auth.uid()) with check (host_id = auth.uid());
drop policy if exists ride_sessions_delete on public.ride_sessions;
create policy ride_sessions_delete on public.ride_sessions
  for delete to authenticated using (host_id = auth.uid());

-- ---------- session_participants ----------
drop policy if exists session_participants_select on public.session_participants;
create policy session_participants_select on public.session_participants
  for select to authenticated
  using (
    public.can_view_session(session_id)
    or public.is_session_host(session_id)
  );
drop policy if exists session_participants_insert on public.session_participants;
create policy session_participants_insert on public.session_participants
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and (public.can_view_session(session_id) or public.is_session_host(session_id))
  );
drop policy if exists session_participants_update on public.session_participants;
create policy session_participants_update on public.session_participants
  for update to authenticated
  using (user_id = auth.uid() or public.is_session_host(session_id))
  with check (user_id = auth.uid() or public.is_session_host(session_id));
drop policy if exists session_participants_delete on public.session_participants;
create policy session_participants_delete on public.session_participants
  for delete to authenticated
  using (user_id = auth.uid() or public.is_session_host(session_id));

-- ---------- session_invites (only the host invites, for now) ----------
drop policy if exists session_invites_select on public.session_invites;
create policy session_invites_select on public.session_invites
  for select to authenticated
  using (
    invitee_id = auth.uid()
    or invited_by = auth.uid()
    or public.is_session_host(session_id)
  );
drop policy if exists session_invites_insert on public.session_invites;
create policy session_invites_insert on public.session_invites
  for insert to authenticated
  with check (
    invited_by = auth.uid() and public.is_session_host(session_id)
  );
drop policy if exists session_invites_update on public.session_invites;
create policy session_invites_update on public.session_invites
  for update to authenticated
  using (invitee_id = auth.uid()) with check (invitee_id = auth.uid());
drop policy if exists session_invites_delete on public.session_invites;
create policy session_invites_delete on public.session_invites
  for delete to authenticated
  using (invited_by = auth.uid() or invitee_id = auth.uid());

-- ---------- location_pings (partitioned: policy on the parent) ----------
drop policy if exists location_pings_select on public.location_pings;
create policy location_pings_select on public.location_pings
  for select to authenticated
  using (
    user_id = auth.uid() or public.is_session_participant(session_id)
  );
drop policy if exists location_pings_insert on public.location_pings;
create policy location_pings_insert on public.location_pings
  for insert to authenticated
  with check (
    user_id = auth.uid() and public.is_session_participant(session_id)
  );

-- ---------- ride_metrics ----------
drop policy if exists ride_metrics_select on public.ride_metrics;
create policy ride_metrics_select on public.ride_metrics
  for select to authenticated
  using (
    user_id = auth.uid() or public.is_session_participant(session_id)
  );
drop policy if exists ride_metrics_write on public.ride_metrics;
create policy ride_metrics_write on public.ride_metrics
  for insert to authenticated
  with check (
    user_id = auth.uid() and public.is_session_participant(session_id)
  );
drop policy if exists ride_metrics_update on public.ride_metrics;
create policy ride_metrics_update on public.ride_metrics
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- tracks (shared catalog) ----------
drop policy if exists tracks_select on public.tracks;
create policy tracks_select on public.tracks
  for select to authenticated using (true);
drop policy if exists tracks_insert on public.tracks;
create policy tracks_insert on public.tracks
  for insert to authenticated with check (true);

-- ---------- playlists and playlist_tracks (owner only in v1) ----------
drop policy if exists playlists_all on public.playlists;
create policy playlists_all on public.playlists
  for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists playlist_tracks_all on public.playlist_tracks;
create policy playlist_tracks_all on public.playlist_tracks
  for all to authenticated
  using (public.is_playlist_owner(playlist_id))
  with check (public.is_playlist_owner(playlist_id));

-- ---------- session_queue ----------
drop policy if exists session_queue_select on public.session_queue;
create policy session_queue_select on public.session_queue
  for select to authenticated
  using (
    public.is_session_participant(session_id)
    or public.is_session_host(session_id)
  );
drop policy if exists session_queue_insert on public.session_queue;
create policy session_queue_insert on public.session_queue
  for insert to authenticated
  with check (
    added_by = auth.uid()
    and (public.is_session_participant(session_id)
      or public.is_session_host(session_id))
  );
drop policy if exists session_queue_update on public.session_queue;
create policy session_queue_update on public.session_queue
  for update to authenticated
  using (
    public.is_session_participant(session_id)
    or public.is_session_host(session_id)
  );
drop policy if exists session_queue_delete on public.session_queue;
create policy session_queue_delete on public.session_queue
  for delete to authenticated
  using (added_by = auth.uid() or public.is_session_host(session_id));

-- ---------- session_playback_state ----------
drop policy if exists session_playback_state_select on public.session_playback_state;
create policy session_playback_state_select on public.session_playback_state
  for select to authenticated
  using (
    public.is_session_participant(session_id)
    or public.is_session_host(session_id)
  );
drop policy if exists session_playback_state_insert on public.session_playback_state;
create policy session_playback_state_insert on public.session_playback_state
  for insert to authenticated
  with check (public.is_session_host(session_id));
drop policy if exists session_playback_state_update on public.session_playback_state;
create policy session_playback_state_update on public.session_playback_state
  for update to authenticated
  using (
    public.is_session_participant(session_id)
    or public.is_session_host(session_id)
  );

-- ---------- realtime publication ----------
-- Postgres changes for the low-volume shared state tables. High-volume
-- GPS fixes should ride the broadcast channel (joinPackRealtimeSession)
-- instead of postgres_changes, so location_pings is intentionally not
-- published here.
do $$
declare t text;
begin
  foreach t in array array[
    'session_participants', 'session_invites',
    'session_queue', 'session_playback_state', 'ride_sessions'
  ] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
