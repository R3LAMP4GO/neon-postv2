/**
 * Scraper Cache - Cache-before-scrape layer
 *
 * Checks the discovered_content table for cached results before hitting APIs.
 * Stores all scraper results with query_hash and TTL for future lookups.
 */

import crypto from 'crypto';
import type { MemoryManager } from '../../memory';
import type { ContentResult } from './pocket-cli';

// ── TTL constants (milliseconds) ──

const TTL_TRENDING = 2 * 60 * 60 * 1000; // 2 hours
const TTL_SEARCH = 24 * 60 * 60 * 1000; // 24 hours
const TTL_PROFILE = 48 * 60 * 60 * 1000; // 48 hours

export type CacheType = 'trending' | 'search' | 'profile';

// ── Helpers ──

export function computeQueryHash(platform: string, query: string): string {
  return crypto.createHash('sha256').update(`${platform}:${query}`).digest('hex');
}

export function getCacheTTL(type: CacheType): number {
  switch (type) {
    case 'trending':
      return TTL_TRENDING;
    case 'search':
      return TTL_SEARCH;
    case 'profile':
      return TTL_PROFILE;
  }
}

// ── Cache lookup ──

/**
 * Check cache for results matching the query hash.
 * Returns null on miss (no cached results at all), or the cached slice at the given offset.
 */
export function checkCache(
  memory: MemoryManager,
  platform: string,
  query: string,
  limit: number,
  offset: number,
  _type: CacheType
): ContentResult[] | null {
  const hash = computeQueryHash(platform, query);
  const totalCached = memory.discoveredContent.countCached(hash);

  if (totalCached === 0) {
    return null;
  }

  // If offset exceeds cached count, signal a miss so caller re-scrapes
  if (offset >= totalCached) {
    return null;
  }

  const rows = memory.discoveredContent.findCached(hash, limit, offset);
  if (rows.length === 0) {
    return null;
  }

  // Convert DiscoveredContent rows back to ContentResult
  return rows.map((row) => ({
    platform: row.platform,
    externalId: row.external_id ?? '',
    url: row.source_url ?? '',
    title: row.title ?? '',
    caption: row.body ?? '',
    views: row.views,
    likes: row.likes,
    comments: row.comments,
    shares: row.shares,
    creatorUsername: row.source_author ?? '',
    createdAt: row.discovered_at,
    tags: row.tags ? JSON.parse(row.tags) : undefined,
    contentType: row.content_type,
  }));
}

// ── Cache store ──

/**
 * Store scraper results in the cache with query_hash and TTL.
 * Deduplicates by external_id before inserting.
 */
export function storeInCache(
  memory: MemoryManager,
  results: ContentResult[],
  platform: string,
  query: string,
  type: CacheType
): void {
  const hash = computeQueryHash(platform, query);
  const ttlMs = getCacheTTL(type);
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();

  for (const r of results) {
    // Skip items without an external ID (can't dedup)
    if (!r.externalId) continue;

    // Deduplicate: skip if this exact item already exists
    const existing = memory.discoveredContent.findByExternalId(platform, r.externalId);
    if (existing) continue;

    memory.discoveredContent.create({
      platform,
      source_url: r.url || null,
      source_author: r.creatorUsername || null,
      content_type: r.contentType ?? 'post',
      title: r.title || null,
      body: r.caption || null,
      likes: r.likes ?? 0,
      comments: r.comments ?? 0,
      shares: r.shares ?? 0,
      views: r.views ?? 0,
      external_id: r.externalId,
      query_hash: hash,
      cache_expires_at: expiresAt,
      tags: r.tags ? JSON.stringify(r.tags) : null,
      media_urls: r.mediaUrls ? JSON.stringify(r.mediaUrls) : null,
    });
  }
}
