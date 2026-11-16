import type { RideSessionRow } from '../src/services/database.types';
export const ride = (id: string, host = 'host'): RideSessionRow => ({
  session_id: id, host_id: host, route_id: null, title: id, description: null,
  status: 'lobby', visibility: 'public', max_participants: 20, meetup_location: null,
  is_no_drop: true, scheduled_start: null, started_at: null, ended_at: null, created_at: '2026-11-15T12:00:00Z',
});
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
