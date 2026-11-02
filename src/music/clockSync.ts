// src/music/clockSync.ts
// Section 7.3: NTP-style Clock Synchronization
// - Sends clock:ping with clientSentAtMs
// - Receives clock:pong with clientSentAtMs, serverReceivedAtMs, serverSentAtMs
// - Keeps the offset from the ping with the lowest RTT out of the last 5
// - Smooths changes: never moves appliedOffset by more than 50 ms at once

import { ClockPongEventPayload } from './types';

export interface ClockSample {
  rttMs: number;
  offsetMs: number;
  sampledAtMs: number;
}

export class ClockSync {
  private samples: ClockSample[] = [];
  private appliedOffsetMs = 0;
  private lastRttMs = 18;
  private hasInitialized = false;

  /** Create a clock:ping payload (Section 7.3 step 1) */
  public createPing(): { clientSentAtMs: number } {
    return { clientSentAtMs: Date.now() };
  }

  /** Process a clock:pong reply from the sync server (Section 7.3 steps 3-5) */
  public handlePong(
    pong: ClockPongEventPayload,
    clientReceivedAtMs: number = Date.now()
  ): { rttMs: number; appliedOffsetMs: number; rawBestOffsetMs: number } {
    const serverProcessingMs = Math.max(
      0,
      pong.serverSentAtMs - pong.serverReceivedAtMs
    );
    const rttMs = Math.max(
      1,
      clientReceivedAtMs - pong.clientSentAtMs - serverProcessingMs
    );
    const offsetMs =
      (pong.serverReceivedAtMs -
        pong.clientSentAtMs +
        (pong.serverSentAtMs - clientReceivedAtMs)) /
      2;

    this.lastRttMs = Math.round(rttMs);
    this.samples.push({
      rttMs,
      offsetMs,
      sampledAtMs: clientReceivedAtMs,
    });

    // Keep only the last 5 samples
    if (this.samples.length > 5) {
      this.samples.shift();
    }

    // Pick the offset from the ping with the lowest RTT out of the last 5
    const bestSample = this.samples.reduce((best, curr) =>
      curr.rttMs < best.rttMs ? curr : best
    );

    if (!this.hasInitialized) {
      this.appliedOffsetMs = Math.round(bestSample.offsetMs);
      this.hasInitialized = true;
    } else {
      // Smooth changes: never let a new measurement move the applied offset by more than 50 ms at once
      const delta = bestSample.offsetMs - this.appliedOffsetMs;
      const clampedDelta = Math.max(-50, Math.min(50, delta));
      this.appliedOffsetMs = Math.round(this.appliedOffsetMs + clampedDelta);
    }

    return {
      rttMs: this.lastRttMs,
      appliedOffsetMs: this.appliedOffsetMs,
      rawBestOffsetMs: Math.round(bestSample.offsetMs),
    };
  }

  /** serverNow() = Date.now() + appliedOffset (Section 7.3 step 5) */
  public serverNow(): number {
    return Date.now() + this.appliedOffsetMs;
  }

  /** Convert a server timestamp (e.g. playAtServerMs) into the local clock equivalent */
  public toLocalTime(serverMs: number): number {
    return serverMs - this.appliedOffsetMs;
  }

  public getAppliedOffsetMs(): number {
    return this.appliedOffsetMs;
  }

  public getLastRttMs(): number {
    return this.lastRttMs;
  }

  public getSamples(): readonly ClockSample[] {
    return this.samples;
  }
}

