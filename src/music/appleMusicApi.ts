/**
 * The dedicated Apple Music API (api.music.apple.com). This is the ONLY
 * Apple catalog source in the app: no iTunes Search API anywhere.
 *
 * Catalog search needs the MusicKit developer token (the same one used
 * for MusicKit JS on web). Tracks come back as real catalog resources,
 * so the IDs handed to MusicKit for queueing are the catalog's own
 * playParams IDs, and previews come from the resource's previews array.
 */
import type { CanonicalTrack } from './types';
import { ProviderError } from './types';

const API_BASE = 'https://api.music.apple.com/v1';
export const DEFAULT_STOREFRONT = 'us';

export function getAppleDeveloperToken(): string {
  return (
    process.env.EXPO_PUBLIC_APPLE_MUSICKIT_DEVELOPER_TOKEN ?? ''
  ).trim();
}

interface AppleArtwork {
  url?: string;
}

interface AppleSongAttributes {
  name?: string;
  artistName?: string;
  albumName?: string;
  artwork?: AppleArtwork;
  durationInMillis?: number;
  isrc?: string;
  contentRating?: string;
  url?: string;
  previews?: { url?: string }[];
  playParams?: { id?: string; kind?: string };
}

interface AppleSongResource {
  id: string;
  attributes?: AppleSongAttributes;
}

function songToTrack(song: AppleSongResource): CanonicalTrack | null {
  const a = song.attributes;
  if (!a?.name) return null;
  const catalogId = a.playParams?.id ?? song.id;
  return {
    isrc: a.isrc ?? '',
    title: a.name,
    artist: a.artistName ?? '',
    album: a.albumName,
    artworkUrl: a.artwork?.url
      ?.replace('{w}', '600')
      .replace('{h}', '600'),
    durationMs: a.durationInMillis ?? 0,
    bpm: null,
    explicit: a.contentRating === 'explicit',
    previewUrl: a.previews?.[0]?.url ?? null,
    appleMusicUrl: a.url,
    providerIds: { apple: catalogId },
  };
}

async function appleFetch(path: string): Promise<unknown> {
  const token = getAppleDeveloperToken();
  if (!token) {
    throw new ProviderError(
      'not_configured',
      'Apple Music needs the MusicKit developer token. Set EXPO_PUBLIC_APPLE_MUSICKIT_DEVELOPER_TOKEN in .env (mint one with: npm run mint:apple-token) and restart Metro.'
    );
  }
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new ProviderError(
      'network',
      `Apple Music API returned ${res.status} for ${path.split('?')[0]}.`
    );
  }
  return res.json();
}

/** Search the Apple Music catalog (dedicated API, not iTunes). */
export async function searchAppleCatalog(
  term: string,
  limit = 15,
  storefront: string = DEFAULT_STOREFRONT
): Promise<CanonicalTrack[]> {
  const data = (await appleFetch(
    `/catalog/${storefront}/search?term=${encodeURIComponent(term)}&types=songs&limit=${limit}`
  )) as { results?: { songs?: { data?: AppleSongResource[] } } };
  const songs = data?.results?.songs?.data ?? [];
  return songs
    .map(songToTrack)
    .filter((t): t is CanonicalTrack => t !== null);
}

/** Exact catalog lookup by ISRC, through the dedicated API filter. */
export async function lookupAppleSongByIsrc(
  isrc: string,
  storefront: string = DEFAULT_STOREFRONT
): Promise<CanonicalTrack | null> {
  const data = (await appleFetch(
    `/catalog/${storefront}/songs?filter[isrc]=${encodeURIComponent(isrc)}`
  )) as { data?: AppleSongResource[] };
  const song = data?.data?.[0];
  return song ? songToTrack(song) : null;
}

/**
 * Best preview URL for a track, from the Apple Music catalog only:
 * the track's own preview, then an ISRC match, then a title/artist
 * search. Returns null (never throws) when nothing is available, so
 * callers decide what the absence means.
 */
export async function findApplePreviewUrl(
  track: CanonicalTrack
): Promise<string | null> {
  if (track.previewUrl) return track.previewUrl;
  try {
    if (track.isrc) {
      const byIsrc = await lookupAppleSongByIsrc(track.isrc);
      if (byIsrc?.previewUrl) return byIsrc.previewUrl;
    }
    const results = await searchAppleCatalog(
      `${track.title} ${track.artist}`,
      5
    );
    const title = track.title.toLowerCase();
    const match =
      results.find((r) => r.title.toLowerCase() === title && r.previewUrl) ??
      results.find((r) => r.previewUrl);
    return match?.previewUrl ?? null;
  } catch {
    return null;
  }
}
