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
  const { data, error } = await db.rpc('create_session', {
    p_input: {
      title: input.title,
      description: input.description ?? null,
      route_id: input.routeId ?? null,
      visibility: input.visibility ?? 'private',
      max_participants: input.maxParticipants ?? 20,
      meetup_location: meetupLocation,
      is_no_drop: input.isNoDrop ?? true,
      scheduled_start: input.scheduledStart ?? null,
    },
  });
  if (error) throwSessionError('createSession', error);
  if (!data) throw new Error('Session creation returned no session.');
  return data;
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

/** Attaches a planned route to a session, or clears it with null. */
export async function setSessionRoute(
  sessionId: string,
  routeId: string | null
): Promise<void> {
  const db = requireSupabase();
  const { error } = await db
    .from('ride_sessions')
    .update({ route_id: routeId })
    .eq('session_id', sessionId);
  if (error) throw new Error(`[Supabase] setSessionRoute: ${error.message}`);
}

export async function setSessionStatus(
  sessionId: string,
  status: SessionStatus
): Promise<void> {
  const db = requireSupabase();
  const { error } = await db.rpc('set_session_status', { p_session_id: sessionId, p_status: status });
  if (error) throwSessionError('setSessionStatus', error);
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
  const { data, error } = await db.rpc('join_session', {
    p_session_id: sessionId,
    ...(bikeId ? { p_bike_id: bikeId } : {}),
  });
  if (error) throwSessionError('joinSession', error);
  return data;
}

export async function setMyParticipantStatus(
  sessionId: string,
  userId: string,
  status: ParticipantStatus
): Promise<void> {
  const db = requireSupabase();
  const { error } = await db.rpc('set_participant_status', { p_session_id: sessionId, p_status: status });
  if (error) throwSessionError('setMyParticipantStatus', error);
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
  const { error } = await db.rpc('respond_to_session_invite', { p_invite_id: invite.invite_id, p_response: response });
  if (error) throwSessionError('respondToInvite', error);
}

export const MEMBERSHIP_CONFLICT_MESSAGE = 'You are already in a session. Leave your current session before joining another.';

function throwSessionError(operation: string, error: { code?: string; message: string; details?: string | null }): never {
  if (error.code === '23505' && `${error.message} ${error.details ?? ''}`.includes('session_participants_one_current_per_user')) {
    throw new Error(MEMBERSHIP_CONFLICT_MESSAGE);
  }
  throw new Error(`[Supabase] ${operation}: ${error.message}`);
}

export type CurrentSession = RideSessionRow & { participationJoinedAt?: string };

/** One committed snapshot; a cached room ID is never evidence of membership. */
export async function fetchCurrentSession(userId: string): Promise<CurrentSession | null> {
  const { data, error } = await requireSupabase()
    .from('session_participants')
    .select('joined_at, session:ride_sessions!inner(*)')
    .eq('user_id', userId)
    .in('status', ['joined', 'riding', 'paused']);
  if (error) throwSessionError('fetchCurrentSession', error);
  const rows = (data ?? []) as unknown as { joined_at: string; session: RideSessionRow }[];
  if (rows.length > 1) throw new Error('Multiple current memberships found. Resolve the database conflict before continuing.');
  // Do not hide corrupt terminal-current rows with a server-side parent filter.
  if (rows[0] && ['completed', 'cancelled'].includes(rows[0].session.status)) {
    throw new Error('Current membership points to an ended session. Reconcile the database before continuing.');
  }
  return rows[0] ? { ...rows[0].session, participationJoinedAt: rows[0].joined_at } : null;
}
