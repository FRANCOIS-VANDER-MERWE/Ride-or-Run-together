// Native audio commands cannot be cancelled after dispatch. Drain old commands
// and their cleanup before letting a new participation interval control the player.
let pending: Promise<void> = Promise.resolve();
export function runSessionAudio(isCurrent: () => boolean, command: () => Promise<void>): Promise<void> {
  const work = pending.then(async () => { if (isCurrent()) await command(); });
  pending = work.catch(() => {});
  return work;
}
