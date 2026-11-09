export type ActivityMode = 'run' | 'ride';

export type RoadConditionType = 'optimal' | 'caution' | 'hazard';

export interface Athlete {
  id: string;
  name: string;
  handle: string;
  role: string;
  isSelf?: boolean;
  avatar: string;
  color: string;
  progress: number; // 0 to 100 (%)
  speedMph: number;
  heartRate: number;
  cadence: number; // spm for run, rpm for ride
  powerWatts: number;
  spotifySynced: boolean;
  spotifyDriftMs: number;
  liveKitLatencyMs: number;
  statusMessage: string;
}

export interface RoadSegment {
  id: string;
  startPct: number;
  endPct: number;
  name: string;
  condition: RoadConditionType;
  conditionLabel: string;
  detail: string;
  gradePct: number;
  gripPct: number;
  windSpeedMph: number;
  windDir: string;
  speedImpactFactor: number;
}

export interface RoadHazardPin {
  id: string;
  progressPct: number;
  type: RoadConditionType;
  title: string;
  reportedBy: string;
  timestamp: string;
  description: string;
}

export interface SpotifyTrack {
  id: string;
  isrc?: string;
  uri: string;
  title: string;
  artist: string;
  album: string;
  coverUrl: string;
  durationSec: number;
  bpm: number;
  targetMode: ActivityMode | 'both';
}

export interface VoiceTransmission {
  id: string;
  speakerId: string;
  speakerName: string;
  speakerColor: string;
  speakerAvatar: string;
  transcript: string;
  timestamp: string;
  durationSec: number;
  progressAtCallPct: number;
}

export interface BroadcastSignalEvent {
  id: string;
  timestamp: string;
  initiator: string;
  action: 'PLAY_TRACK' | 'PAUSE_SYNC' | 'SEEK_POSITION' | 'BPM_LOCK_RESYNC' | 'HAZARD_DUCK_AUDIO';
  customEndpoint: string;
  customPayload: {
    session_id: string;
    broadcast_type: string;
    spotify_track_uri: string;
    position_ms: number;
    server_epoch_ms: number;
  };
  clientSpotifyEndpoint: string;
  clientSpotifyBody: {
    uris: string[];
    position_ms: number;
    device_compensation_ms: number;
  };
  peersTranslated: number;
  avgDriftMs: number;
}

export interface RouteConfig {
  mode: ActivityMode;
  title: string;
  subtitle: string;
  locationLabel: string;
  totalDistanceMiles: number;
  elevationGainFt: number;
  weatherTempF: number;
  weatherCondition: string;
  humidityPct: number;
  headwindMph: number;
  headwindDir: string;
  targetSpeedMph: number;
  checkpoints: { pct: number; label: string; elevationFt: number }[];
  segments: RoadSegment[];
}

export const ROUTE_CONFIGS: Record<ActivityMode, RouteConfig> = {
  run: {
    mode: 'run',
    title: 'MARINA SEAWALL -> GOLDEN GATE OVERLOOK',
    subtitle: 'Threshold Pack Tempo Run · Coastal Asphalt & Trail',
    locationLabel: 'San Francisco, CA · Crissy Field Corridor',
    totalDistanceMiles: 6.4,
    elevationGainFt: 420,
    weatherTempF: 59,
    weatherCondition: 'Crisp Marine Layer · High Visibility',
    humidityPct: 68,
    headwindMph: 9,
    headwindDir: 'WNW',
    targetSpeedMph: 8.6,
    checkpoints: [
      { pct: 0, label: 'Marina Green Start', elevationFt: 12 },
      { pct: 28, label: 'Crissy Lagoon Split', elevationFt: 18 },
      { pct: 55, label: 'Fort Point Seawall', elevationFt: 45 },
      { pct: 78, label: 'Battery Spencer Climb', elevationFt: 380 },
      { pct: 100, label: 'Point Bonita Finish', elevationFt: 410 },
    ],
    segments: [
      {
        id: 'seg-run-1',
        startPct: 0,
        endPct: 35,
        name: 'Marina Boulevard Promenade',
        condition: 'optimal',
        conditionLabel: 'CLEAR DRY ASPHALT',
        detail: 'Fast flat packed path · Google Maps Traffic: Clear',
        gradePct: 0.4,
        gripPct: 98,
        windSpeedMph: 6,
        windDir: 'NW',
        speedImpactFactor: 1.04,
      },
      {
        id: 'seg-run-2',
        startPct: 35,
        endPct: 62,
        name: 'Hopper’s Hands Seawall Causeway',
        condition: 'caution',
        conditionLabel: 'Wet Tide Spray & 14mph Crosswind',
        detail: 'Slick granite curb & ocean mist · Reduce stride length 5%',
        gradePct: 1.8,
        gripPct: 81,
        windSpeedMph: 14,
        windDir: 'WNW',
        speedImpactFactor: 0.94,
      },
      {
        id: 'seg-run-3',
        startPct: 62,
        endPct: 82,
        name: 'Battery Godfrey Switchbacks',
        condition: 'hazard',
        conditionLabel: 'Steep 7.8% Grade + Trail Narrowing',
        detail: 'Single-file construction barrier & steep incline',
        gradePct: 7.8,
        gripPct: 76,
        windSpeedMph: 17,
        windDir: 'W',
        speedImpactFactor: 0.83,
      },
      {
        id: 'seg-run-4',
        startPct: 82,
        endPct: 100,
        name: 'Presidio Bluff Finish Corridor',
        condition: 'optimal',
        conditionLabel: 'OPTIMAL TAILWIND SPRINT',
        detail: 'Fresh resurfaced bike/run lane · Ideal kick finish',
        gradePct: -1.2,
        gripPct: 99,
        windSpeedMph: 4,
        windDir: 'E',
        speedImpactFactor: 1.08,
      },
    ],
  },
  ride: {
    mode: 'ride',
    title: 'MARIN HEADLANDS PELOTON LOOP',
    subtitle: 'Group Aero Draft & Climb Session · Road Cycling',
    locationLabel: 'Marin County, CA · Hawk Hill & Conzelman Rd',
    totalDistanceMiles: 18.5,
    elevationGainFt: 1680,
    weatherTempF: 61,
    weatherCondition: 'Dry Tarmac · Gusty Coastal Ridges',
    humidityPct: 62,
    headwindMph: 12,
    headwindDir: 'NW',
    targetSpeedMph: 23.4,
    checkpoints: [
      { pct: 0, label: 'Presidio Gate Rollout', elevationFt: 110 },
      { pct: 25, label: 'Golden Gate West Span', elevationFt: 245 },
      { pct: 52, label: 'Kirby Cove Overlook', elevationFt: 590 },
      { pct: 76, label: 'Hawk Hill Summit (9.2%)', elevationFt: 920 },
      { pct: 100, label: 'Rodeo Beach Sprint Finish', elevationFt: 45 },
    ],
    segments: [
      {
        id: 'seg-ride-1',
        startPct: 0,
        endPct: 32,
        name: 'Bridge Approach & Fast Flats',
        condition: 'optimal',
        conditionLabel: 'SMOOTH TARMAC · FAST PACELINE',
        detail: 'Google Maps Road Condition: Green · High-grip asphalt',
        gradePct: 1.1,
        gripPct: 98,
        windSpeedMph: 8,
        windDir: 'NW',
        speedImpactFactor: 1.06,
      },
      {
        id: 'seg-ride-2',
        startPct: 32,
        endPct: 58,
        name: 'Golden Gate Span & Vista Point',
        condition: 'caution',
        conditionLabel: '21mph Side-Gusts & Expansion Joints',
        detail: 'Hold deep-section wheels steady · Tight single-file draft',
        gradePct: 2.6,
        gripPct: 86,
        windSpeedMph: 21,
        windDir: 'WNW',
        speedImpactFactor: 0.92,
      },
      {
        id: 'seg-ride-3',
        startPct: 58,
        endPct: 81,
        name: 'Conzelman Road / Hawk Hill Wall',
        condition: 'hazard',
        conditionLabel: '9.4% Climb + Loose Gravel Shoulder',
        detail: 'Road maintenance zone at Turn 4 + heavy tourist car traffic',
        gradePct: 9.4,
        gripPct: 74,
        windSpeedMph: 16,
        windDir: 'W',
        speedImpactFactor: 0.72,
      },
      {
        id: 'seg-ride-4',
        startPct: 81,
        endPct: 100,
        name: 'Bunker Road Aero Valley Straight',
        condition: 'optimal',
        conditionLabel: 'CLEAR DESCENDING EXPRESSWAY',
        detail: 'Zero cross-traffic · Protected cycling lane to finish',
        gradePct: -2.8,
        gripPct: 99,
        windSpeedMph: 5,
        windDir: 'N',
        speedImpactFactor: 1.15,
      },
    ],
  },
};

export const INITIAL_ATHLETES: Athlete[] = [
  {
    id: 'athlete-maya',
    name: 'Maya Lin',
    handle: '@mayalin',
    role: 'Pack Leader',
    avatar:
      'https://images.unsplash.com/photo-1648863397001-cd77a7e98bd8?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=400',
    color: '#00F0FF',
    progress: 70.6,
    speedMph: 8.9,
    heartRate: 171,
    cadence: 174,
    powerWatts: 278,
    spotifySynced: true,
    spotifyDriftMs: 4,
    liveKitLatencyMs: 18,
    statusMessage: 'Setting 6:45/mi tempo at the crest',
  },
  {
    id: 'athlete-you',
    name: 'Alex Rivera (You)',
    handle: '@alex_r',
    role: 'Session Host',
    isSelf: true,
    avatar:
      'https://images.unsplash.com/photo-1744706908605-ac30eb45f98c?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=400',
    color: '#D4FF00',
    progress: 68.4,
    speedMph: 8.6,
    heartRate: 166,
    cadence: 170,
    powerWatts: 264,
    spotifySynced: true,
    spotifyDriftMs: 0,
    liveKitLatencyMs: 14,
    statusMessage: 'Locked in draft · Broadcasting Spotify BPM',
  },
  {
    id: 'athlete-marcus',
    name: 'Marcus Vance',
    handle: '@mvance',
    role: 'Sprinter',
    avatar:
      'https://images.unsplash.com/photo-1609377375724-8fadc82cd50e?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=400',
    color: '#10B981',
    progress: 65.8,
    speedMph: 8.5,
    heartRate: 164,
    cadence: 168,
    powerWatts: 255,
    spotifySynced: true,
    spotifyDriftMs: 7,
    liveKitLatencyMs: 22,
    statusMessage: 'Holding 25m off your rear shoulder',
  },
  {
    id: 'athlete-elena',
    name: 'Elena Rostova',
    handle: '@elena_r',
    role: 'Climber',
    avatar:
      'https://images.unsplash.com/photo-1726195225009-56c724665a49?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=400',
    color: '#F59E0B',
    progress: 62.1,
    speedMph: 8.3,
    heartRate: 169,
    cadence: 172,
    powerWatts: 242,
    spotifySynced: true,
    spotifyDriftMs: 5,
    liveKitLatencyMs: 25,
    statusMessage: 'Pushing through the seawall crosswind',
  },
  {
    id: 'athlete-devon',
    name: 'Devon Brooks',
    handle: '@dbrooks',
    role: 'Sweep / Anchor',
    avatar:
      'https://images.unsplash.com/photo-1614660762109-bb0157fcbd7d?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=400',
    color: '#A855F7',
    progress: 57.9,
    speedMph: 8.1,
    heartRate: 158,
    cadence: 165,
    powerWatts: 230,
    spotifySynced: true,
    spotifyDriftMs: 9,
    liveKitLatencyMs: 29,
    statusMessage: 'Sweeping rear pack · Clear road behind',
  },
];

export const INITIAL_HAZARD_PINS: RoadHazardPin[] = [
  {
    id: 'haz-1',
    progressPct: 48.5,
    type: 'caution',
    title: 'Standing Tide Water & Gusts',
    reportedBy: 'Elena Rostova',
    timestamp: '3m ago',
    description: 'Right lane has 2 inches of bay spray — stay left near centerline.',
  },
  {
    id: 'haz-2',
    progressPct: 71.2,
    type: 'hazard',
    title: 'Steep 7.8% Pitch + Cones',
    reportedBy: 'Maya Lin',
    timestamp: 'Just now',
    description: 'Road narrows to single-file around utility barriers on the climb.',
  },
  {
    id: 'haz-3',
    progressPct: 88.0,
    type: 'optimal',
    title: 'Green Wave / Open Sprint',
    reportedBy: 'Google Maps Live',
    timestamp: 'Live API',
    description: 'Zero intersections or cross-traffic for final 0.8 mi finish chute.',
  },
];

export const SPOTIFY_PLAYLIST: SpotifyTrack[] = [
  {
    id: 'trk-1',
    isrc: 'USRC17607839',
    uri: 'spotify:track:7k9xTempoKinetic01',
    title: 'HYPERDRIVE CADENCE (170 BPM EDIT)',
    artist: 'Klangwerk & Subkinetic',
    album: 'Negative Split Sessions Vol. 4',
    coverUrl:
      'https://images.unsplash.com/photo-1759074558477-6f35e3a5eb30?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=400',
    durationSec: 214,
    bpm: 170,
    targetMode: 'run',
  },
  {
    id: 'trk-2',
    isrc: 'GBUM72401982',
    uri: 'spotify:track:4m2vPelotonAeroSlip02',
    title: 'SLIPSTREAM VELOCITY',
    artist: 'Bicep // Overmono Club Dub',
    album: 'Headlands Night Ride',
    coverUrl:
      'https://images.unsplash.com/photo-1761104169769-1aefefbcb5f2?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=400',
    durationSec: 248,
    bpm: 132,
    targetMode: 'ride',
  },
  {
    id: 'trk-3',
    isrc: 'AUAP02500441',
    uri: 'spotify:track:9p1zThresholdHorizon03',
    title: 'LACTATE THRESHOLD // NEON COAST',
    artist: 'RÜFÜS DU SOL · Pack Edit',
    album: 'Endurance Telemetry',
    coverUrl:
      'https://images.unsplash.com/photo-1654590390722-c1448c8993aa?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=400',
    durationSec: 229,
    bpm: 158,
    targetMode: 'both',
  },
  {
    id: 'trk-4',
    isrc: 'GBAHS2500914',
    uri: 'spotify:track:2x8qApexSummitKick04',
    title: 'SUMMIT ATTACK (FINAL KILOMETER)',
    artist: 'Fred again.. x Joy Anonymous',
    album: 'USB Pack Broadcast',
    coverUrl:
      'https://images.unsplash.com/photo-1679189792474-6c2796dc78ab?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=400',
    durationSec: 196,
    bpm: 174,
    targetMode: 'both',
  },
  {
    id: 'trk-5',
    isrc: 'USAT22503310',
    uri: 'spotify:track:5w1kMarinaDawnWarmup05',
    title: 'MARINA DAWN ROLLOUT (WARMUP)',
    artist: 'Tycho & Ben Böhmer',
    album: 'Golden Gate Warmup Tapes',
    coverUrl:
      'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=400',
    durationSec: 205,
    bpm: 122,
    targetMode: 'both',
  },
  {
    id: 'trk-6',
    isrc: 'DEUM72508821',
    uri: 'spotify:track:8z4pBerlinDubplateExcl06',
    title: 'BERLIN DUBPLATE (SPOTIFY EXCLUSIVE)',
    artist: 'Kobosil // Ostgut Ton',
    album: 'Regional White Label',
    coverUrl:
      'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=400',
    durationSec: 218,
    bpm: 162,
    targetMode: 'both',
  },
];

export const INITIAL_VOICE_CALLOUTS: VoiceTransmission[] = [
  {
    id: 'vc-1',
    speakerId: 'athlete-maya',
    speakerName: 'Maya Lin',
    speakerColor: '#00F0FF',
    speakerAvatar:
      'https://images.unsplash.com/photo-1648863397001-cd77a7e98bd8?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=400',
    transcript:
      'Approaching the 7.8% Battery climb in 200 meters — cones on the right shoulder, tuck in single file!',
    timestamp: '14s ago',
    durationSec: 4.2,
    progressAtCallPct: 70.1,
  },
  {
    id: 'vc-2',
    speakerId: 'athlete-marcus',
    speakerName: 'Marcus Vance',
    speakerColor: '#10B981',
    speakerAvatar:
      'https://images.unsplash.com/photo-1609377375724-8fadc82cd50e?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=400',
    transcript:
      'Copy that Maya, right on Alex’s heels. This 170 BPM drop is keeping my cadence locked in!',
    timestamp: '48s ago',
    durationSec: 3.6,
    progressAtCallPct: 65.2,
  },
  {
    id: 'vc-3',
    speakerId: 'athlete-elena',
    speakerName: 'Elena Rostova',
    speakerColor: '#F59E0B',
    speakerAvatar:
      'https://images.unsplash.com/photo-1726195225009-56c724665a49?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=400',
    transcript:
      'Watch the wet patch near the seawall bench — grip drops a bit there, then clear asphalt ahead.',
    timestamp: '2m ago',
    durationSec: 3.9,
    progressAtCallPct: 61.0,
  },
];

export const TEAMMATE_CALLOUT_SAMPLES: {
  athleteId: string;
  runText: string;
  rideText: string;
}[] = [
  {
    athleteId: 'athlete-maya',
    runText: 'Cresting the hill in 60 seconds! Hold your form, then we open up the stride on the descent!',
    rideText: 'Over the top of Hawk Hill in 30 seconds! Stay in my slipstream for the 35mph descent!',
  },
  {
    athleteId: 'athlete-marcus',
    runText: 'Feeling super strong on this track — Alex, let’s close the 30m gap to Maya together!',
    rideText: 'Rotating through to pull the paceline for the next mile — hop on my wheel Alex!',
  },
  {
    athleteId: 'athlete-elena',
    runText: 'Road surface just cleared up 100% — dry asphalt and tailwind from here to the finish line!',
    rideText: 'Crosswind easing off around the bend — tarmac is bone dry, safe to get back in the drops!',
  },
  {
    athleteId: 'athlete-devon',
    runText: 'All clear behind us, no bikes or traffic approaching. Closing in at 6:52 pace!',
    rideText: 'Car back! Single file for 5 seconds... okay car is past, all clear to fan out!',
  },
];

export const INITIAL_BROADCAST_LOGS: BroadcastSignalEvent[] = [
  {
    id: 'sig-101',
    timestamp: '18:24:12.408',
    initiator: 'Alex Rivera (Host)',
    action: 'PLAY_TRACK',
    customEndpoint: 'POST https://api.pacelock.run/v1/session/sf-884/broadcast',
    customPayload: {
      session_id: 'sf-884-pack-tempo',
      broadcast_type: 'SPOTIFY_SYNC_SIGNAL',
      spotify_track_uri: 'spotify:track:7k9xTempoKinetic01',
      position_ms: 84210,
      server_epoch_ms: 1743548652408,
    },
    clientSpotifyEndpoint: 'PUT https://api.spotify.com/v1/me/player/play',
    clientSpotifyBody: {
      uris: ['spotify:track:7k9xTempoKinetic01'],
      position_ms: 84222,
      device_compensation_ms: 12,
    },
    peersTranslated: 5,
    avgDriftMs: 5.2,
  },
  {
    id: 'sig-100',
    timestamp: '18:21:04.119',
    initiator: 'Maya Lin (Leader)',
    action: 'BPM_LOCK_RESYNC',
    customEndpoint: 'POST https://api.pacelock.run/v1/session/sf-884/broadcast',
    customPayload: {
      session_id: 'sf-884-pack-tempo',
      broadcast_type: 'CADENCE_BPM_MATCH',
      spotify_track_uri: 'spotify:track:7k9xTempoKinetic01',
      position_ms: 0,
      server_epoch_ms: 1743548464119,
    },
    clientSpotifyEndpoint: 'PUT https://api.spotify.com/v1/me/player/play',
    clientSpotifyBody: {
      uris: ['spotify:track:7k9xTempoKinetic01'],
      position_ms: 14,
      device_compensation_ms: 14,
    },
    peersTranslated: 5,
    avgDriftMs: 4.8,
  },
];
