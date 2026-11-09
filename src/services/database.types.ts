/**
 * Typed view of the real Supabase schema in schema.sql (repo root).
 *
 * The previous client types described invented tables (public.users,
 * public.friends) that do not exist in the deployed schema. Everything
 * below matches schema.sql exactly: table names, primary key names
 * (session_id, playlist_id, queue_item_id, and friends), enums, and the
 * PostGIS geography columns.
 *
 * Geography columns are exchanged with PostgREST as GeoJSON objects,
 * so they are typed as GeoJSON here.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type GeoJsonPoint = {
  type: 'Point';
  coordinates: [number, number];
}

export type GeoJsonLineString = {
  type: 'LineString';
  coordinates: [number, number][];
}

export type GeoJsonGeometry = GeoJsonPoint | GeoJsonLineString;

export type FriendshipStatus = 'pending' | 'accepted' | 'blocked';
export type InviteStatus = 'pending' | 'accepted' | 'declined' | 'expired';
export type MusicProviderId = 'spotify' | 'apple_music';
export type ParticipantRole = 'host' | 'guest';
export type ParticipantStatus =
  | 'joined'
  | 'riding'
  | 'paused'
  | 'finished'
  | 'left'
  | 'dropped';
export type QueueItemStatus =
  | 'queued'
  | 'playing'
  | 'played'
  | 'skipped'
  | 'removed';
export type SessionStatus =
  | 'scheduled'
  | 'lobby'
  | 'active'
  | 'paused'
  | 'completed'
  | 'cancelled';
export type SessionVisibility = 'private' | 'friends' | 'public';

export type ProfileRow = {
  user_id: string;
  username: string;
  share_live_location: boolean;
  created_at: string;
  updated_at: string;
  last_active_at: string | null;
  deleted_at: string | null;
}

export type UserStatsRow = {
  user_id: string;
  total_rides: number;
  total_group_rides: number;
  total_distance_m: number;
  total_moving_s: number;
  total_elevation_m: number;
  longest_ride_m: number;
  current_streak_weeks: number;
  updated_at: string;
}

export type UserBikeRow = {
  bike_id: string;
  user_id: string;
  name: string;
  bike_type: string | null;
  is_default: boolean;
  created_at: string;
  retired_at: string | null;
}

export type UserMusicAccountRow = {
  user_id: string;
  provider: MusicProviderId;
  provider_user_id: string | null;
  /** Encrypted token blobs (bytea). The client never writes raw tokens. */
  access_token_enc: string | null;
  refresh_token_enc: string | null;
  expires_at: string | null;
}

export type FriendshipRow = {
  user_a_id: string;
  user_b_id: string;
  requested_by: string;
  status: FriendshipStatus;
  created_at: string;
  responded_at: string | null;
}

export type RouteRow = {
  route_id: string;
  created_by: string;
  name: string;
  description: string | null;
  path: GeoJsonLineString;
  start_point: GeoJsonPoint;
  end_point: GeoJsonPoint;
  is_loop: boolean;
  distance_m: number;
  est_duration_s: number | null;
  times_ridden: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export type RideSessionRow = {
  session_id: string;
  host_id: string;
  route_id: string | null;
  title: string;
  description: string | null;
  status: SessionStatus;
  visibility: SessionVisibility;
  max_participants: number | null;
  meetup_location: GeoJsonPoint | null;
  is_no_drop: boolean;
  scheduled_start: string | null;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
}

export type SessionParticipantRow = {
  session_id: string;
  user_id: string;
  bike_id: string | null;
  role: ParticipantRole;
  status: ParticipantStatus;
  map_color: string | null;
  is_muted: boolean;
  joined_at: string;
  started_at: string | null;
  finished_at: string | null;
  left_at: string | null;
}

export type SessionInviteRow = {
  invite_id: string;
  session_id: string;
  invited_by: string;
  invitee_id: string;
  status: InviteStatus;
  created_at: string;
  responded_at: string | null;
}

export type LocationPingRow = {
  ping_id: number;
  session_id: string;
  user_id: string;
  recorded_at: string;
  location: GeoJsonPoint;
  altitude_m: number | null;
  accuracy_m: number | null;
  speed_mps: number | null;
  heading_deg: number | null;
}

export type RideMetricsRow = {
  session_id: string;
  user_id: string;
  distance_m: number;
  moving_time_s: number;
  elapsed_time_s: number;
  avg_speed_mps: number | null;
  max_speed_mps: number | null;
  elevation_gain_m: number | null;
  route_completion_pct: number | null;
  recorded_path: GeoJsonLineString | null;
  computed_at: string;
}

export type TrackRow = {
  track_id: string;
  provider: MusicProviderId;
  provider_track_id: string;
  title: string;
  artist: string;
  album: string | null;
  duration_ms: number | null;
  artwork_url: string | null;
}

export type PlaylistRow = {
  playlist_id: string;
  owner_id: string;
  name: string;
  provider: MusicProviderId | null;
  provider_playlist_id: string | null;
  created_at: string;
  updated_at: string;
}

export type PlaylistTrackRow = {
  playlist_id: string;
  position: number;
  track_id: string;
  added_at: string;
}

export type SessionQueueRow = {
  queue_item_id: string;
  session_id: string;
  track_id: string;
  added_by: string | null;
  source_playlist_id: string | null;
  position: number;
  status: QueueItemStatus;
  added_at: string;
  played_at: string | null;
}

export type SessionPlaybackStateRow = {
  session_id: string;
  current_item_id: string | null;
  is_playing: boolean;
  position_ms: number;
  position_updated_at: string;
  dj_user_id: string | null;
  duck_for_voice: boolean;
}

type InsertOf<Row, Required extends keyof Row> = Pick<Row, Required> &
  Partial<Omit<Row, Required>>;
type UpdateOf<Row> = Partial<Row>;

interface TableDef<Row, Required extends keyof Row> {
  Row: Row;
  Insert: InsertOf<Row, Required>;
  Update: UpdateOf<Row>;
  Relationships: [];
}

export type Database = {
  public: {
    Tables: {
      profiles: TableDef<ProfileRow, 'user_id' | 'username'>;
      user_stats: TableDef<UserStatsRow, 'user_id'>;
      user_bikes: TableDef<UserBikeRow, 'user_id' | 'name'>;
      user_music_accounts: TableDef<
        UserMusicAccountRow,
        'user_id' | 'provider'
      >;
      friendships: TableDef<
        FriendshipRow,
        'user_a_id' | 'user_b_id' | 'requested_by'
      >;
      routes: TableDef<
        RouteRow,
        'created_by' | 'name' | 'path' | 'start_point' | 'end_point' | 'distance_m'
      >;
      ride_sessions: TableDef<RideSessionRow, 'host_id' | 'title'>;
      session_participants: TableDef<
        SessionParticipantRow,
        'session_id' | 'user_id'
      >;
      session_invites: TableDef<
        SessionInviteRow,
        'session_id' | 'invited_by' | 'invitee_id'
      >;
      location_pings: TableDef<
        LocationPingRow,
        'session_id' | 'user_id' | 'recorded_at' | 'location'
      >;
      ride_metrics: TableDef<RideMetricsRow, 'session_id' | 'user_id'>;
      tracks: TableDef<
        TrackRow,
        'provider' | 'provider_track_id' | 'title' | 'artist'
      >;
      playlists: TableDef<PlaylistRow, 'owner_id' | 'name'>;
      playlist_tracks: TableDef<
        PlaylistTrackRow,
        'playlist_id' | 'position' | 'track_id'
      >;
      session_queue: TableDef<
        SessionQueueRow,
        'session_id' | 'track_id' | 'position'
      >;
      session_playback_state: TableDef<
        SessionPlaybackStateRow,
        'session_id'
      >;
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      friendship_status: FriendshipStatus;
      invite_status: InviteStatus;
      music_provider: MusicProviderId;
      participant_role: ParticipantRole;
      participant_status: ParticipantStatus;
      queue_item_status: QueueItemStatus;
      session_status: SessionStatus;
      session_visibility: SessionVisibility;
    };
    CompositeTypes: Record<string, never>;
  };
}
