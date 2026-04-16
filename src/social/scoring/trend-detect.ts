/**
 * Trend detection engine.
 *
 * Analyzes discovered content for emerging topic clusters,
 * scoring them by velocity, volume, recency, and growth.
 */

import type { DiscoveredContent } from '../../memory/discovered-content';

// ── Types ──

export type TrendStatus = 'breakout' | 'rising' | 'emerging';

export interface TrendCluster {
  /** Top keywords that define this cluster */
  keywords: string[];
  /** Items belonging to this cluster */
  items: DiscoveredContent[];
  /** Composite trend score 0-100 */
  score: number;
  /** Velocity component (avg viral score, 35%) */
  velocity: number;
  /** Volume component (item count log-scaled, 25%) */
  volume: number;
  /** Recency component (avg age weighted, 25%) */
  recency: number;
  /** Growth component (newer outperforms older, 15%) */
  growth: number;
  /** Human-readable status */
  status: TrendStatus;
}

// ── Stop words ──

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'it', 'its', 'this', 'that', 'was',
  'are', 'be', 'been', 'has', 'have', 'had', 'do', 'does', 'did', 'not',
  'no', 'so', 'if', 'as', 'we', 'he', 'she', 'you', 'they', 'my', 'your',
  'our', 'his', 'her', 'up', 'out', 'can', 'will', 'just', 'all', 'about',
  'more', 'some', 'how', 'what', 'when', 'who', 'which', 'would', 'could',
  'than', 'then', 'now', 'new', 'also', 'like', 'get', 'got', 'make',
  'one', 'two', 'into', 'over', 'very', 'much', 'most', 'other', 'only',
  'amp', 'via', 'per', 'etc', 'im', 'ive', 'dont', 'cant', 'wont',
]);

// ── Helpers ──

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Tokenize text into lowercase words, stripping punctuation. */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s#]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
}

/** Extract unigrams and bigrams from text, returning a frequency map. */
function extractKeywords(text: string): Map<string, number> {
  const tokens = tokenize(text);
  const freq = new Map<string, number>();

  // Unigrams
  for (const token of tokens) {
    freq.set(token, (freq.get(token) ?? 0) + 1);
  }

  // Bigrams
  for (let i = 0; i < tokens.length - 1; i++) {
    const bigram = `${tokens[i]} ${tokens[i + 1]}`;
    freq.set(bigram, (freq.get(bigram) ?? 0) + 1);
  }

  return freq;
}

/** Get text from a content item (title + body + tags). */
function getItemText(item: DiscoveredContent): string {
  const parts: string[] = [];
  if (item.title) parts.push(item.title);
  if (item.body) parts.push(item.body);
  if (item.tags) parts.push(item.tags);
  return parts.join(' ');
}

/** Hours elapsed since an ISO date string. */
function hoursElapsed(dateStr: string): number {
  const then = new Date(dateStr).getTime();
  return Math.max(0, (Date.now() - then) / (1000 * 60 * 60));
}

/** Get the effective viral score for an item (use stored or estimate from engagement). */
function getItemScore(item: DiscoveredContent): number {
  if (item.viral_score != null) return item.viral_score;
  // Fallback: simple log-scaled engagement estimate (0-100)
  const total = item.likes + item.comments + item.shares;
  if (total <= 0) return 0;
  return clamp(Math.log10(total + 1) * 20, 0, 100);
}

// ── Clustering ──

/**
 * Build keyword→items index and cluster items by shared top keywords.
 * Items share a cluster if they have overlapping high-frequency keywords.
 */
function clusterByKeywords(
  items: DiscoveredContent[]
): Array<{ keywords: string[]; items: DiscoveredContent[] }> {
  // Build per-item keyword sets
  const itemKeywords: Array<{ item: DiscoveredContent; keywords: Set<string> }> = [];
  const globalFreq = new Map<string, number>();

  for (const item of items) {
    const text = getItemText(item);
    if (!text.trim()) continue;

    const freq = extractKeywords(text);
    // Keep top keywords for this item (by frequency, min 1 occurrence)
    const sorted = [...freq.entries()]
      .filter(([, count]) => count >= 1)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([kw]) => kw);

    const kwSet = new Set(sorted);
    itemKeywords.push({ item, keywords: kwSet });

    for (const kw of kwSet) {
      globalFreq.set(kw, (globalFreq.get(kw) ?? 0) + 1);
    }
  }

  // Find keywords that appear in at least 2 items (potential cluster anchors)
  const clusterAnchors = [...globalFreq.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1]);

  // Greedy clustering: assign items to the best matching anchor keyword group
  const assigned = new Set<string>();
  const clusters: Array<{ keywords: string[]; items: DiscoveredContent[] }> = [];

  for (const [anchor] of clusterAnchors) {
    const members = itemKeywords.filter(
      ({ item, keywords }) => !assigned.has(item.id) && keywords.has(anchor)
    );

    if (members.length < 2) continue;

    // Find additional shared keywords among cluster members
    const sharedKeywords = new Map<string, number>();
    for (const { keywords } of members) {
      for (const kw of keywords) {
        sharedKeywords.set(kw, (sharedKeywords.get(kw) ?? 0) + 1);
      }
    }

    // Keep keywords present in at least half of members
    const threshold = Math.max(2, Math.floor(members.length / 2));
    const clusterKws = [...sharedKeywords.entries()]
      .filter(([, count]) => count >= threshold)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([kw]) => kw);

    for (const { item } of members) {
      assigned.add(item.id);
    }

    clusters.push({
      keywords: clusterKws.length > 0 ? clusterKws : [anchor],
      items: members.map(({ item }) => item),
    });
  }

  return clusters;
}

// ── Scoring ──

/** Velocity: average viral score of cluster members (0-100). */
function scoreVelocity(items: DiscoveredContent[]): number {
  if (items.length === 0) return 0;
  const sum = items.reduce((acc, item) => acc + getItemScore(item), 0);
  return sum / items.length;
}

/** Volume: item count, log-scaled to 0-100 (2 items → ~15, 10 → ~50, 50 → ~85, 100+ → ~100). */
function scoreVolume(count: number): number {
  if (count <= 1) return 0;
  // log2(count) / log2(100) * 100
  return clamp((Math.log2(count) / Math.log2(100)) * 100, 0, 100);
}

/** Recency: inverse of average content age. 0h → 100, 24h → 75, 72h → 50, 168h → 25, 336h+ → 0. */
function scoreRecency(items: DiscoveredContent[]): number {
  if (items.length === 0) return 0;
  const avgHours =
    items.reduce((acc, item) => acc + hoursElapsed(item.discovered_at), 0) / items.length;

  if (avgHours <= 0) return 100;
  if (avgHours >= 336) return 0;

  // Exponential decay
  return clamp(100 * Math.exp(-avgHours / 100), 0, 100);
}

/**
 * Growth: do newer items in the cluster outperform older ones?
 * Split items by median discovery time, compare avg scores.
 * Returns 0-100: 50 = flat, >50 = growing, <50 = declining.
 */
function scoreGrowth(items: DiscoveredContent[]): number {
  if (items.length < 2) return 50;

  const sorted = [...items].sort(
    (a, b) => new Date(a.discovered_at).getTime() - new Date(b.discovered_at).getTime()
  );

  const mid = Math.floor(sorted.length / 2);
  const older = sorted.slice(0, mid);
  const newer = sorted.slice(mid);

  const avgOlder = older.reduce((s, i) => s + getItemScore(i), 0) / older.length;
  const avgNewer = newer.reduce((s, i) => s + getItemScore(i), 0) / newer.length;

  if (avgOlder === 0 && avgNewer === 0) return 50;
  if (avgOlder === 0) return 100;

  // Ratio: newer/older performance. 1.0 = flat, >1 = growing
  const ratio = avgNewer / avgOlder;
  // Map ratio to 0-100: 0.5→25, 1.0→50, 1.5→75, 2.0+→100
  return clamp(ratio * 50, 0, 100);
}

function getTrendStatus(score: number): TrendStatus {
  if (score >= 80) return 'breakout';
  if (score >= 60) return 'rising';
  return 'emerging';
}

// ── Public API ──

/**
 * Detect trending topic clusters from discovered content.
 *
 * Algorithm:
 * 1. Extract keywords from titles, bodies, and tags
 * 2. Cluster items by shared keywords (min 2 items per cluster)
 * 3. Score each cluster: velocity (35%), volume (25%), recency (25%), growth (15%)
 * 4. Classify: Breakout 80+, Rising 60-79, Emerging 40-59
 *
 * @returns Clusters scoring 40+, sorted by score descending
 */
export function detectTrends(items: DiscoveredContent[]): TrendCluster[] {
  if (items.length < 2) return [];

  const clusters = clusterByKeywords(items);

  const scored: TrendCluster[] = clusters.map((cluster) => {
    const velocity = scoreVelocity(cluster.items);
    const volume = scoreVolume(cluster.items.length);
    const recency = scoreRecency(cluster.items);
    const growth = scoreGrowth(cluster.items);

    const score = clamp(
      Math.round(velocity * 0.35 + volume * 0.25 + recency * 0.25 + growth * 0.15),
      0,
      100
    );

    return {
      keywords: cluster.keywords,
      items: cluster.items,
      score,
      velocity: Math.round(velocity),
      volume: Math.round(volume),
      recency: Math.round(recency),
      growth: Math.round(growth),
      status: getTrendStatus(score),
    };
  });

  // Filter to 40+ (Emerging and above) and sort descending
  return scored
    .filter((c) => c.score >= 40)
    .sort((a, b) => b.score - a.score);
}
