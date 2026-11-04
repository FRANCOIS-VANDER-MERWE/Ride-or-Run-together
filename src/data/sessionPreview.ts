import type { ActivityMode } from './sessionData';

export interface SampleSession {
  code: string;
  name: string;
  mode: ActivityMode;
  route: string;
  distance: string;
  target: string;
  status: 'available' | 'full' | 'ended';
  participantCount: number;
}

export const SAMPLE_SESSIONS: SampleSession[] = [
  { code: 'RUN123', name: 'Coastal Tempo Run', mode: 'run', route: 'Seawall Loop', distance: '4 mi', target: '9:00 min/mi', status: 'available', participantCount: 2 },
  { code: 'RIDE12', name: 'Bay Loop Ride', mode: 'ride', route: 'Bay Loop', distance: '12 mi', target: '14 mph', status: 'available', participantCount: 2 },
  { code: 'FULL12', name: 'Full group example', mode: 'run', route: 'Seawall Loop', distance: '4 mi', target: '9:00 min/mi', status: 'full', participantCount: 8 },
  { code: 'ENDED1', name: 'Ended session example', mode: 'ride', route: 'Bay Loop', distance: '12 mi', target: '14 mph', status: 'ended', participantCount: 2 },
];

export function findSampleSession(code: string): SampleSession | undefined {
  return SAMPLE_SESSIONS.find((sample) => sample.code === code.trim().toUpperCase());
}

export function createHostPreview(name: string, mode: ActivityMode): SampleSession | undefined {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 40) return undefined;
  const route = SAMPLE_SESSIONS[mode === 'run' ? 0 : 1];
  return { ...route, code: 'HOST01', name: trimmed, participantCount: 0 };
}
