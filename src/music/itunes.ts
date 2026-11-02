// src/music/itunes.ts
// Apple iTunes Search / Lookup API client.
//
// This is a public catalog API: no account, key, or developer token needed.
// It is how Apple Music tracks are searched on native (where MusicKit is
// not available to an Expo app without a native module), and it provides
// the official preview stream URLs that the in-app player plays. Previews
// are also used to give Spotify tracks an in-app sound fallback, matched
// by ISRC so it is the same recording.

import { CanonicalTrack } from './types';

interface ItunesSong {
  trackId?: number;
  trackName?: string;
  artistName?: string;
  collectionName?: string;
  trackTimeMillis?: number;
  previewUrl?: string;
  artworkUrl100?: string;
  isrc?: string;
  trackExplicitness?: string;
  kind?: string;
  trackViewUrl?: string;
  isStreamable?: boolean;
}

async function itunesJson(url: string): Promise<{ results?: ItunesSong[] }> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`iTunes API request failed (${res.status})`);
  }
  return (await res.json()) as { results?: ItunesSong[] };
}

export function itunesSongToTrack(song: ItunesSong): CanonicalTrack | null {
  if (!song.trackId || !song.trackName) return null;
  return {
    isrc: song.isrc ?? '',
    title: song.trackName,
    artist: song.artistName ?? '',
    album: song.collectionName,
    artworkUrl: song.artworkUrl100
      ? song.artworkUrl100.replace('100x100bb.jpg', '600x600bb.jpg')
      : undefined,
    durationMs: song.trackTimeMillis ?? 0,
    bpm: null,
    explicit: song.trackExplicitness === 'explicit',
    previewUrl: song.previewUrl ?? null,
    appleMusicUrl: song.trackViewUrl,
    streamable: song.isStreamable,
    providerIds: { apple: String(song.trackId) },
  };
}

export async function searchItunes(
  term: string,
  limit = 15
): Promise<CanonicalTrack[]> {
  const url =
    `https://itunes.apple.com/search?term=${encodeURIComponent(term)}` +
    `&media=music&entity=song&limit=${limit}`;
  const data = await itunesJson(url);
  return (data.results ?? [])
    .map(itunesSongToTrack)
    .filter((t): t is CanonicalTrack => t !== null);
}

// Best effort only: the public iTunes lookup endpoint accepts an ISRC but
// in practice returns no results for many recordings, so callers must not
// depend on it. findPreviewUrl treats title + artist search as the
// reliable path.
export async function lookupItunesByIsrc(
  isrc: string
): Promise<CanonicalTrack | null> {
  if (!isrc) return null;
  const url = `https://itunes.apple.com/lookup?isrc=${encodeURIComponent(isrc)}&entity=song`;
  const data = await itunesJson(url);
  const first = (data.results ?? [])[0];
  return first ? itunesSongToTrack(first) : null;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Find a playable preview URL for any canonical track: its own preview if
 * present, else the same recording on iTunes (by ISRC), else a careful
 * title + artist search. Returns null when nothing trustworthy is found.
 */
export async function findPreviewUrl(
  track: CanonicalTrack
): Promise<string | null> {
  if (track.previewUrl) return track.previewUrl;
  try {
    if (track.isrc) {
      const byIsrc = await lookupItunesByIsrc(track.isrc);
      if (byIsrc?.previewUrl) return byIsrc.previewUrl;
    }
    const results = await searchItunes(`${track.title} ${track.artist}`, 5);
    const wantTitle = normalize(track.title);
    const match = results.find(
      (r) =>
        r.previewUrl &&
        (normalize(r.title) === wantTitle ||
          wantTitle.startsWith(normalize(r.title)) ||
          normalize(r.title).startsWith(wantTitle))
    );
    return match?.previewUrl ?? null;
  } catch {
    return null;
  }
}
