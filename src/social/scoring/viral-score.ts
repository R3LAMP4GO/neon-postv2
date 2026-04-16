/**
 * Platform-specific viral scoring engine.
 *
 * Computes a composite viral score (0-100) from engagement metrics,
 * with per-platform formulas, quality weighting, and freshness decay.
 */

// ── Types ──

export type ScoringPlatform = 'tiktok' | 'youtube' | 'instagram' | 'twitter' | 'linkedin';

export interface EngagementMetrics {
  likes: number;
  comments: number;
  shares: number;
  views: number;
}

export interface ViralScoreBreakdown {
  /** Composite score 0-100 */
  score: number;
  /** Engagement rate component (0-100, weighted 55%) */
  engagementRate: number;
  /** Velocity component (0-100, weighted 30%) */
  velocity: number;
  /** Volume component (0-100, weighted 15%) */
  volume: number;
  /** Freshness multiplier 0-1 (applied after composite) */
  freshness: number;
  /** Human-readable tier */
  tier: ViralTier;
  platform: ScoringPlatform;
}

export type ViralTier = 'viral' | 'good' | 'average' | 'low';

// ── Platform config ──

interface PlatformConfig {
  /** Whether engagement rate uses views (true) or treats total engagement as the base */
  viewsBased: boolean;
  /** Metric weights: [likes, comments, shares] */
  weights: [number, number, number];
  /** Engagement rate thresholds: [low, avg, good, viral] — values are percentages */
  thresholds: [number, number, number, number];
  /** Volume benchmarks (log-scaled): [low, avg, good, viral] — raw total engagement */
  volumeBenchmarks: [number, number, number, number];
}

const PLATFORM_CONFIG: Record<ScoringPlatform, PlatformConfig> = {
  tiktok: {
    viewsBased: true,
    weights: [0.5, 2, 3],
    thresholds: [2, 5, 10, 18],
    volumeBenchmarks: [100, 1_000, 10_000, 100_000],
  },
  youtube: {
    viewsBased: true,
    weights: [0.5, 3, 2],
    thresholds: [1, 2.5, 5, 10],
    volumeBenchmarks: [50, 500, 5_000, 50_000],
  },
  instagram: {
    viewsBased: false,
    weights: [1, 3, 0],
    thresholds: [0.5, 1.5, 4, 8],
    volumeBenchmarks: [50, 500, 5_000, 50_000],
  },
  twitter: {
    viewsBased: true,
    weights: [0.5, 1, 1],
    thresholds: [0.05, 0.2, 0.5, 1.5],
    volumeBenchmarks: [20, 200, 2_000, 20_000],
  },
  linkedin: {
    viewsBased: false,
    weights: [1, 3, 2],
    thresholds: [0.5, 1.5, 4, 8],
    volumeBenchmarks: [20, 200, 2_000, 20_000],
  },
};

// ── Helpers ──

/** Clamp a value between min and max. */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Map a value to 0-100 based on threshold breakpoints.
 * Below thresholds[0] → 0-25, between [0]-[1] → 25-50, etc.
 */
function thresholdToScore(value: number, thresholds: [number, number, number, number]): number {
  if (value <= 0) return 0;
  if (value >= thresholds[3]) return 100;

  const bands: Array<{ lo: number; hi: number; scoreLo: number; scoreHi: number }> = [
    { lo: 0, hi: thresholds[0], scoreLo: 0, scoreHi: 25 },
    { lo: thresholds[0], hi: thresholds[1], scoreLo: 25, scoreHi: 50 },
    { lo: thresholds[1], hi: thresholds[2], scoreLo: 50, scoreHi: 75 },
    { lo: thresholds[2], hi: thresholds[3], scoreLo: 75, scoreHi: 100 },
  ];

  for (const band of bands) {
    if (value <= band.hi) {
      const ratio = (value - band.lo) / (band.hi - band.lo);
      return band.scoreLo + ratio * (band.scoreHi - band.scoreLo);
    }
  }

  return 100;
}

/** Hours elapsed since a given ISO date string. */
function hoursElapsed(discoveredAt: string): number {
  const then = new Date(discoveredAt).getTime();
  const now = Date.now();
  return Math.max(0, (now - then) / (1000 * 60 * 60));
}

/**
 * Freshness multiplier: 1.0 for first 48h, linear decay to 0.5 at 168h (7 days),
 * then stays at 0.5 floor.
 */
function freshnessFactor(hours: number): number {
  if (hours <= 48) return 1.0;
  if (hours >= 168) return 0.5;
  // Linear decay from 1.0 to 0.5 over 48h-168h
  return 1.0 - ((hours - 48) / (168 - 48)) * 0.5;
}

// ── Core scoring ──

/**
 * Calculate the engagement rate for a platform.
 * Views-based platforms divide by views; others use total engagement as a self-referential rate
 * (since we don't have follower counts from scraping).
 */
function calcEngagementRate(
  metrics: EngagementMetrics,
  config: PlatformConfig
): number {
  const { likes, comments, shares, views } = metrics;
  const [wLike, wComment, wShare] = config.weights;
  const weighted = likes * wLike + comments * wComment + shares * wShare;

  if (config.viewsBased) {
    if (views <= 0) return 0;
    return (weighted / views) * 100;
  }

  // For non-views platforms without follower data, we use a volume-adjusted approach:
  // Scale engagement relative to views if available, otherwise use raw total as proxy.
  if (views > 0) {
    return (weighted / views) * 100;
  }

  // No views data: use total raw engagement and map through volume benchmarks instead.
  // Return a synthetic rate based on log-scale of total engagement.
  const total = likes + comments + shares;
  if (total <= 0) return 0;
  return Math.min(10, Math.log10(total + 1) * 2);
}

/**
 * Calculate velocity score (0-100): engagement relative to content age.
 * Higher engagement in less time = higher velocity.
 */
function calcVelocity(metrics: EngagementMetrics, hours: number): number {
  const total = metrics.likes + metrics.comments + metrics.shares;
  if (total <= 0) return 0;

  // Engagement per hour, with minimum 1h to avoid division by near-zero
  const effectiveHours = Math.max(1, hours);
  const perHour = total / effectiveHours;

  // Log-scale mapping: 1/h → ~0, 10/h → ~25, 100/h → ~50, 1000/h → ~75, 10000/h → ~100
  return clamp(Math.log10(perHour + 1) * 25, 0, 100);
}

/**
 * Calculate volume score (0-100): raw engagement numbers, log-scaled against platform benchmarks.
 */
function calcVolume(metrics: EngagementMetrics, config: PlatformConfig): number {
  const total = metrics.likes + metrics.comments + metrics.shares;
  return thresholdToScore(total, config.volumeBenchmarks);
}

// ── Public API ──

/**
 * Calculate a composite viral score (0-100) with full breakdown.
 *
 * @param platform - Target platform for scoring
 * @param metrics - Engagement metrics (likes, comments, shares, views)
 * @param discoveredAt - ISO date string of when content was discovered (for freshness/velocity)
 */
export function calculateViralScore(
  platform: ScoringPlatform,
  metrics: EngagementMetrics,
  discoveredAt?: string
): ViralScoreBreakdown {
  const config = PLATFORM_CONFIG[platform];
  const hours = discoveredAt ? hoursElapsed(discoveredAt) : 1;

  const engagementRate = thresholdToScore(calcEngagementRate(metrics, config), config.thresholds);
  const velocity = calcVelocity(metrics, hours);
  const volume = calcVolume(metrics, config);
  const freshness = freshnessFactor(hours);

  // Weighted composite (research-backed: ER primary signal, velocity most validated predictor)
  const rawScore =
    engagementRate * 0.55 +
    velocity * 0.30 +
    volume * 0.15;

  const score = clamp(Math.round(rawScore * freshness), 0, 100);

  return {
    score,
    engagementRate: Math.round(engagementRate),
    velocity: Math.round(velocity),
    volume: Math.round(volume),
    freshness: Math.round(freshness * 100) / 100,
    tier: getViralTier(score),
    platform,
  };
}

/**
 * Map a viral score to a human-readable tier.
 */
export function getViralTier(score: number): ViralTier {
  if (score >= 75) return 'viral';
  if (score >= 50) return 'good';
  if (score >= 25) return 'average';
  return 'low';
}
