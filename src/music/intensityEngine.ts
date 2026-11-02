// src/music/intensityEngine.ts
// Section 9: Intensity to BPM Engine
// - 9.1: Per-member sample -> target BPM -> Median aggregation (robust to outliers) -> 30s EWMA smoothing -> 15s hysteresis
// - 9.2: Activity mappings (Run: cadence spm directly; Bike: cadence * 2 or speed/HR fallback) & Bucket table
// - 9.4: Transition policy (1st choice: best BPM match in queue; 2nd choice: small rate nudge if capabilities.canSetRate)

import { ActivityMode } from '../data/sessionData';
import {
  IntensityBucket,
  IntensityTargetEventPayload,
  ProviderCapabilities,
  ProviderId,
  QueueItem,
} from './types';

export interface MemberIntensitySample {
  userId: string;
  mode: ActivityMode;
  cadence?: number;
  paceSecPerKm?: number;
  speedMps?: number;
  heartRate?: number;
  atMs: number;
}

export interface BucketMeta {
  id: IntensityBucket;
  label: string;
  minBpm: number;
  maxBpm: number;
  typicalFeel: string;
  color: string;
}

export const INTENSITY_BUCKETS: BucketMeta[] = [
  {
    id: 'warmup',
    label: 'Warmup',
    minBpm: 110,
    maxBpm: 129,
    typicalFeel: 'Easy start, cool-down',
    color: '#38BDF8',
  },
  {
    id: 'cruise',
    label: 'Cruise',
    minBpm: 130,
    maxBpm: 149,
    typicalFeel: 'Steady endurance',
    color: '#34D399',
  },
  {
    id: 'tempo',
    label: 'Tempo',
    minBpm: 150,
    maxBpm: 164,
    typicalFeel: 'Comfortably hard',
    color: '#D4FF00',
  },
  {
    id: 'push',
    label: 'Push',
    minBpm: 165,
    maxBpm: 180,
    typicalFeel: 'Intervals, climbs, finish',
    color: '#FF4D2A',
  },
];

export function classifyBpmBucket(bpm: number): IntensityBucket {
  if (bpm < 130) return 'warmup';
  if (bpm < 150) return 'cruise';
  if (bpm < 165) return 'tempo';
  return 'push';
}

export function getBucketMeta(bucket: IntensityBucket): BucketMeta {
  return (
    INTENSITY_BUCKETS.find((b) => b.id === bucket) || INTENSITY_BUCKETS[2]
  );
}

/**
 * Section 9.2: Map a single member's workout sample to a target BPM.
 * - Run: Cadence in steps/min directly (song BPM = spm)
 * - Bike: Cadence x 2 (pedaling 85-95 rpm maps to 170-190 BPM feel, or scaled into 110-180 bucket range),
 *   with speed/heart-rate fallback if cadence sensor is absent.
 */
export function sampleToMemberTargetBpm(sample: MemberIntensitySample): number {
  if (sample.mode === 'run') {
    if (sample.cadence && sample.cadence > 0) {
      return Math.max(110, Math.min(180, Math.round(sample.cadence)));
    }
    if (sample.speedMps && sample.speedMps > 0) {
      // ~3.8 m/s (8.5 mph) -> ~168 spm
      return Math.max(110, Math.min(180, Math.round(115 + sample.speedMps * 14)));
    }
  } else {
    // Bike mode: Cadence x 2 (or speed/HR zone mapping)
    if (sample.cadence && sample.cadence > 0) {
      const doubled = sample.cadence * 2;
      // If rider is spinning easy (e.g. 65-74 rpm -> 130-148 BPM), or pushing (85-90 rpm -> 170-180 BPM)
      return Math.max(110, Math.min(180, Math.round(doubled)));
    }
    if (sample.speedMps && sample.speedMps > 0) {
      return Math.max(110, Math.min(180, Math.round(110 + sample.speedMps * 5.5)));
    }
  }

  if (sample.heartRate && sample.heartRate > 0) {
    return Math.max(110, Math.min(180, Math.round(sample.heartRate)));
  }

  return 155;
}

/** Compute the statistical median of a numeric array (Section 9.1 step 2) */
export function computeMedian(values: number[]): number {
  if (values.length === 0) return 155;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid];
  }
  return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

export class IntensityEngine {
  private latestSamples = new Map<string, MemberIntensitySample>();
  private smoothedBpm = 168;
  private rawMedianBpm = 168;
  private lastUpdatedMs: number | null = null;

  private activeBucket: IntensityBucket = 'push';
  private candidateBucket: IntensityBucket | null = null;
  private candidateSinceMs: number | null = null;

  // Section 9.1 constants: 30s EWMA time constant, 15s hysteresis
  private readonly ewmaTimeConstantMs = 30_000;
  private readonly hysteresisDurationMs = 15_000;

  public ingestSample(sample: MemberIntensitySample): void {
    this.latestSamples.set(sample.userId, sample);
  }

  public ingestBatch(
    samples: MemberIntensitySample[],
    nowMs: number = Date.now(),
    bypassSmoothingAndHysteresis = false
  ): {
    targetBpm: number;
    rawMedianBpm: number;
    memberTargetBpms: { userId: string; bpm: number }[];
    bucket: IntensityBucket;
    bucketChanged: boolean;
    hysteresisProgressSec: number;
    pendingBucket: IntensityBucket | null;
  } {
    for (const s of samples) {
      this.latestSamples.set(s.userId, s);
    }

    const memberTargetBpms = Array.from(this.latestSamples.values()).map(
      (s) => ({
        userId: s.userId,
        bpm: sampleToMemberTargetBpm(s),
      })
    );

    const medianBpm = computeMedian(memberTargetBpms.map((m) => m.bpm));
    this.rawMedianBpm = medianBpm;

    if (this.lastUpdatedMs === null || bypassSmoothingAndHysteresis) {
      this.smoothedBpm = medianBpm;
    } else {
      const dtMs = Math.max(50, nowMs - this.lastUpdatedMs);
      // Exponentially weighted average with tau = 30s: alpha = 1 - exp(-dt / tau)
      const alpha = 1 - Math.exp(-dtMs / this.ewmaTimeConstantMs);
      this.smoothedBpm =
        this.smoothedBpm + alpha * (medianBpm - this.smoothedBpm);
    }
    this.lastUpdatedMs = nowMs;

    const roundedTarget = Math.round(this.smoothedBpm);
    const immediateBucket = classifyBpmBucket(roundedTarget);
    let bucketChanged = false;
    let hysteresisProgressSec = 0;

    if (bypassSmoothingAndHysteresis) {
      if (immediateBucket !== this.activeBucket) {
        this.activeBucket = immediateBucket;
        bucketChanged = true;
      }
      this.candidateBucket = null;
      this.candidateSinceMs = null;
    } else if (immediateBucket !== this.activeBucket) {
      if (this.candidateBucket !== immediateBucket) {
        this.candidateBucket = immediateBucket;
        this.candidateSinceMs = nowMs;
      } else if (this.candidateSinceMs !== null) {
        const elapsedInCandidateMs = nowMs - this.candidateSinceMs;
        hysteresisProgressSec = Math.min(
          15,
          Number((elapsedInCandidateMs / 1000).toFixed(1))
        );
        if (elapsedInCandidateMs >= this.hysteresisDurationMs) {
          this.activeBucket = immediateBucket;
          this.candidateBucket = null;
          this.candidateSinceMs = null;
          bucketChanged = true;
        }
      }
    } else {
      this.candidateBucket = null;
      this.candidateSinceMs = null;
    }

    return {
      targetBpm: roundedTarget,
      rawMedianBpm: medianBpm,
      memberTargetBpms,
      bucket: this.activeBucket,
      bucketChanged,
      hysteresisProgressSec,
      pendingBucket: this.candidateBucket,
    };
  }

  /**
   * Section 9.4 Transition Policy:
   * 1. First choice: Pick the queue item whose native BPM is closest to targetBpm.
   * 2. Second choice: Small rate nudge (within +/- 8%) ONLY where provider.capabilities.canSetRate is true,
   *    or full pitch-preserving time-stretch in LocalFileProvider djay demo mode.
   */
  public selectBestQueueItemForBpm(
    queue: QueueItem[],
    targetBpm: number,
    currentQueueItemId: string | null
  ): QueueItem | null {
    const candidates = queue.filter((item) => item.track.bpm !== null);
    if (candidates.length === 0) return null;

    let best = candidates[0];
    let bestDiff = Math.abs((best.track.bpm || 150) - targetBpm);

    for (const item of candidates) {
      const diff = Math.abs((item.track.bpm || 150) - targetBpm);
      if (
        diff < bestDiff ||
        (diff === bestDiff && item.queueItemId !== currentQueueItemId)
      ) {
        best = item;
        bestDiff = diff;
      }
    }
    return best;
  }

  /**
   * Compute recommended playback rate for a provider given current track BPM and target BPM (Section 9.4).
   * - Spotify (`canSetRate: false`): Always 1.0x (song choice handles intensity).
   * - Apple iOS (`canSetRate: true`): Small nudge only if within +/- 8% of target.
   * - Local Files (`id === 'local'`): Pitch-preserving time-stretch up to +/- 20% for the djay demo.
   */
  public computeRecommendedRate(
    providerId: ProviderId,
    capabilities: ProviderCapabilities,
    trackNativeBpm: number | null,
    targetBpm: number | null
  ): { rate: number; explanation: string } {
    if (!capabilities.canSetRate || !trackNativeBpm || !targetBpm) {
      return {
        rate: 1.0,
        explanation:
          '1.00x (Catalog native tempo — intensity changes track selection)',
      };
    }

    const ratio = targetBpm / trackNativeBpm;

    if (providerId === 'local') {
      // Section 6.4 & 9.4: Local-files djay demo mode shows true pitch-preserving time-stretch
      const stretched = Math.max(0.82, Math.min(1.22, ratio));
      return {
        rate: Number(stretched.toFixed(3)),
        explanation: `${stretched.toFixed(2)}x pitch-preserved stretch (${trackNativeBpm} -> ${Math.round(trackNativeBpm * stretched)} BPM)`,
      };
    }

    // Apple Music on iOS: small nudge only when within +/- 8%
    if (Math.abs(ratio - 1.0) <= 0.08) {
      return {
        rate: Number(ratio.toFixed(3)),
        explanation: `${ratio.toFixed(2)}x small MusicKit rate nudge (±8% cap)`,
      };
    }

    return {
      rate: 1.0,
      explanation: '1.00x (Delta > 8% — waiting for next track boundary)',
    };
  }

  public buildIntensityTargetEvent(
    queue: QueueItem[],
    currentQueueItemId: string | null,
    reason: string
  ): IntensityTargetEventPayload {
    const targetBpm = Math.round(this.smoothedBpm);
    const bestItem = this.selectBestQueueItemForBpm(
      queue,
      targetBpm,
      currentQueueItemId
    );
    return {
      targetBpm,
      rawMedianBpm: this.rawMedianBpm,
      bucket: this.activeBucket,
      reason,
      recommendedQueueItemId: bestItem ? bestItem.queueItemId : null,
    };
  }

  public getState() {
    return {
      targetBpm: Math.round(this.smoothedBpm),
      rawMedianBpm: this.rawMedianBpm,
      bucket: this.activeBucket,
      pendingBucket: this.candidateBucket,
    };
  }
}

