/**
 * Friendships. The table stores one row per pair with the hard
 * constraint user_a_id < user_b_id, requested_by recording who sent
 * the request. Every write here maintains that ordering.
 */
import { requireSupabase } from './supabaseClient';
import type { FriendshipRow, ProfileRow } from './database.types';
import { fetchProfile } from './profilesService';

function orderedPair(
  x: string,
  y: string
): { user_a_id: string; user_b_id: string } {
  return x < y
    ? { user_a_id: x, user_b_id: y }
    : { user_a_id: y, user_b_id: x };
}

export async function sendFriendRequest(
  myUserId: string,
  otherUserId: string
): Promise<FriendshipRow> {
  if (myUserId === otherUserId) {
    throw new Error('You cannot send a friend request to yourself.');
  }
  const db = requireSupabase();
  const pair = orderedPair(myUserId, otherUserId);
  const { data, error } = await db
    .from('friendships')
    .upsert(
      { ...pair, requested_by: myUserId, status: 'pending', responded_at: null },
      { onConflict: 'user_a_id,user_b_id' }
    )
    .select('*')
    .single();
  if (error) throw new Error(`[Supabase] sendFriendRequest: ${error.message}`);
  return data;
}

export interface FriendWithProfile {
  friendship: FriendshipRow;
  friend: ProfileRow | null;
}

async function withProfiles(
  rows: FriendshipRow[],
  myUserId: string
): Promise<FriendWithProfile[]> {
  const out: FriendWithProfile[] = [];
  for (const friendship of rows) {
    const friendId =
      friendship.user_a_id === myUserId
        ? friendship.user_b_id
        : friendship.user_a_id;
    out.push({ friendship, friend: await fetchProfile(friendId) });
  }
  return out;
}

export async function fetchFriends(
  myUserId: string
): Promise<FriendWithProfile[]> {
  const db = requireSupabase();
  const { data, error } = await db
    .from('friendships')
    .select('*')
    .or(`user_a_id.eq.${myUserId},user_b_id.eq.${myUserId}`)
    .eq('status', 'accepted');
  if (error) throw new Error(`[Supabase] fetchFriends: ${error.message}`);
  return withProfiles(data ?? [], myUserId);
}

/** Pending requests sent TO me (someone else is the requester). */
export async function fetchIncomingRequests(
  myUserId: string
): Promise<FriendWithProfile[]> {
  const db = requireSupabase();
  const { data, error } = await db
    .from('friendships')
    .select('*')
    .or(`user_a_id.eq.${myUserId},user_b_id.eq.${myUserId}`)
    .eq('status', 'pending')
    .neq('requested_by', myUserId);
  if (error) {
    throw new Error(`[Supabase] fetchIncomingRequests: ${error.message}`);
  }
  return withProfiles(data ?? [], myUserId);
}

export async function respondToFriendRequest(
  myUserId: string,
  otherUserId: string,
  accept: boolean
): Promise<void> {
  const db = requireSupabase();
  const pair = orderedPair(myUserId, otherUserId);
  if (accept) {
    const { error } = await db
      .from('friendships')
      .update({ status: 'accepted', responded_at: new Date().toISOString() })
      .eq('user_a_id', pair.user_a_id)
      .eq('user_b_id', pair.user_b_id);
    if (error) {
      throw new Error(`[Supabase] respondToFriendRequest: ${error.message}`);
    }
  } else {
    const { error } = await db
      .from('friendships')
      .delete()
      .eq('user_a_id', pair.user_a_id)
      .eq('user_b_id', pair.user_b_id)
      .eq('status', 'pending');
    if (error) {
      throw new Error(`[Supabase] respondToFriendRequest: ${error.message}`);
    }
  }
}

export async function removeFriend(
  myUserId: string,
  otherUserId: string
): Promise<void> {
  const db = requireSupabase();
  const pair = orderedPair(myUserId, otherUserId);
  const { error } = await db
    .from('friendships')
    .delete()
    .eq('user_a_id', pair.user_a_id)
    .eq('user_b_id', pair.user_b_id);
  if (error) throw new Error(`[Supabase] removeFriend: ${error.message}`);
}
