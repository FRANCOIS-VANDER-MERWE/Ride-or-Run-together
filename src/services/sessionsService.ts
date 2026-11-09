/**
 * Ride sessions: creation, discovery, lifecycle, participants, and
 * invites. Tables: ride_sessions, session_participants,
 * session_invites, session_playback_state.
 */
import { requireSupabase } from './supabaseClient';
import type {
  GeoJsonPoint,
  InviteStatus,
  ParticipantStatus,
  RideSessionRow,
  SessionInviteRow,
  SessionParticipantRow,
  SessionStatus,
  SessionVisibility,
} from './database.types';

export interface CreateSessionInput {
  title: string;
  description?: string;
  routeId?: string;
  visibility?: SessionVisibility;
  maxParticipants?: number;
  meetup?: { lat: number; lng: number };
  isNoDrop?: boolean;
  scheduledStart?: string;
}

/**
 * Creates a session plus the two rows that make it usable: the host's
 * own participant row and the empty playback state row.
 */
export async function createSession(
  hostId: string,
  input: CreateSessionInput
): Promise<RideSessionRow> {
  const db = requireSupabase();
  const meetupLocation: GeoJsonPoint | null = input.meetup
    ? {
        type: 'Point',
        coordinates: [input.meetup.lng, input.meetup.lat],
      }
    : null;
  const { data: session, error } = await db
    .from('ride_sessions')
    .insert({
      host_id: hostId,
      title: input.title,
      description: input.description ?? null,
      route_id: input.routeId ?? null,
      visibility: input.visibility ?? 'private',
      max_participants: input.maxParticipants ?? 20,
      meetup_location: meetupLocation,
      is_no_drop: input.isNoDrop ?? true,
      scheduled_start: input.scheduledStart ?? null,
      status: 'lobby',
    })
    .select('*')
    .single();
  if (error || !session) {
    throw new Error(`[Supabase] createSession: ${error?.message}`);
  }
  const { error: participantError } = await db
    .from('session_participants')
    .insert({
      session_id: session.session_id,
      user_id: hostId,
      role: 'host',
      status: 'joined',
    });
  if (participantError) {
    throw new Error(
      `[Supabase] createSession participant: ${participantError.message}`
    );
  }
  const { error: playbackError } = await db
    .from('session_playback_state')
    .insert({ session_id: session.session_id, dj_user_id: hostId });
  if (playbackError) {
    throw new Error(
      `[Supabase] createSession playback state: ${playbackError.message}`
    );
  }
  return session;
}

export async function fetchSession(
  sessionId: string
): Promise<RideSessionRow | null> {
  const db = requireSupabase();
  const { data, error } = await db
    .from('ride_sessions')
    .select('*')
    .eq('session_id', sessionId)
    .maybeSingle();
  if (error) throw new Error(`[Supabase] fetchSession: ${error.message}`);
  return data;
}

/** Sessions the user hosts or participates in, newest first. */
export async function fetchMySessions(
  userId: string
): Promise<RideSessionRow[]> {
  const db = requireSupabase();
  const { data: mine, error: mineError } = await db
    .from('session_participants')
    .select('session_id')
    .eq('user_id', userId);
  if (mineError) {
    throw new Error(`[Supabase] fetchMySessions: ${mineError.message}`);
  }
  const ids = (mine ?? []).map((r) => r.session_id);
  const { data, error } = await db
    .from('ride_sessions')
    .select('*')
    .or(
      ids.length > 0
        ? `host_id.eq.${userId},session_id.in.(${ids.join(',')})`
        : `host_id.eq.${userId}`
    )
    .order('created_at', { ascending: false });
  if (error) throw new Error(`[Supabase] fetchMySessions: ${error.message}`);
  return data ?? [];
}

/** Public and friends-visible sessions that are open to join. */
export async function fetchDiscoverableSessions(
  limit = 30
): Promise<RideSessionRow[]> {
  const db = requireSupabase();
  const { data, error } = await db
    .from('ride_sessions')
    .select('*')
    .in('visibility', ['public', 'friends'])
    .in('status', ['scheduled', 'lobby', 'active'])
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    throw new Error(`[Supabase] fetchDiscoverableSessions: ${error.message}`);
  }
  return data ?? [];
}

export async function setSessionStatus(
  sessionId: string,
  status: SessionStatus
): Promise<void> {
  const db = requireSupabase();
  const patch: Partial<RideSessionRow> = { status };
  if (status === 'active') patch.started_at = new Date().toISOString();
  if (status === 'completed' || status === 'cancelled') {
    patch.ended_at = new Date().toISOString();
  }
  const { error } = await db
    .from('ride_sessions')
    .update(patch)
    .eq('session_id', sessionId);
  if (error) throw new Error(`[Supabase] setSessionStatus: ${error.message}`);
}

export async function fetchParticipants(
  sessionId: string
): Promise<SessionParticipantRow[]> {
  const db = requireSupabase();
  const { data, error } = await db
    .from('session_participants')
    .select('*')
    .eq('session_id', sessionId)
    .order('joined_at', { ascending: true });
  if (error) {
    throw new Error(`[Supabase] fetchParticipants: ${error.message}`);
  }
  return data ?? [];
}

export async function joinSession(
  sessionId: string,
  userId: string,
  bikeId?: string
): Promise<SessionParticipantRow> {
  const db = requireSupabase();
  const { data, error } = await db
    .from('session_participants')
    .upsert(
      {
        session_id: sessionId,
        user_id: userId,
        bike_id: bikeId ?? null,
        role: 'guest',
        status: 'joined',
        left_at: null,
      },
      { onConflict: 'session_id,user_id' }
    )
    .select('*')
    .single();
  if (error) throw new Error(`[Supabase] joinSession: ${error.message}`);
  return data;
}

export async function setMyParticipantStatus(
  sessionId: string,
  userId: string,
  status: ParticipantStatus
): Promise<void> {
  const db = requireSupabase();
  const patch: Partial<SessionParticipantRow> = { status };
  const now = new Date().toISOString();
  if (status === 'riding') patch.started_at = now;
  if (status === 'finished') patch.finished_at = now;
  if (status === 'left') patch.left_at = now;
  const { error } = await db
    .from('session_participants')
    .update(patch)
    .eq('session_id', sessionId)
    .eq('user_id', userId);
  if (error) {
    throw new Error(`[Supabase] setMyParticipantStatus: ${error.message}`);
  }
}

export async function sendInvite(
  sessionId: string,
  invitedBy: string,
  inviteeId: string
): Promise<SessionInviteRow> {
  const db = requireSupabase();
  const { data, error } = await db
    .from('session_invites')
    .insert({
      session_id: sessionId,
      invited_by: invitedBy,
      invitee_id: inviteeId,
    })
    .select('*')
    .single();
  if (error) throw new Error(`[Supabase] sendInvite: ${error.message}`);
  return data;
}

export async function fetchMyInvites(
  userId: string
): Promise<SessionInviteRow[]> {
  const db = requireSupabase();
  const { data, error } = await db
    .from('session_invites')
    .select('*')
    .eq('invitee_id', userId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  if (error) throw new Error(`[Supabase] fetchMyInvites: ${error.message}`);
  return data ?? [];
}

/** Responding accept also joins the session as a guest participant. */
export async function respondToInvite(
  invite: SessionInviteRow,
  response: Extract<InviteStatus, 'accepted' | 'declined'>
): Promise<void> {
  const db = requireSupabase();
  const { error } = await db
    .from('session_invites')
    .update({ status: response, responded_at: new Date().toISOString() })
    .eq('invite_id', invite.invite_id);
  if (error) throw new Error(`[Supabase] respondToInvite: ${error.message}`);
  if (response === 'accepted') {
    await joinSession(invite.session_id, invite.invitee_id);
  }
}
