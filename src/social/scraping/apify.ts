/**
 * Apify API Client - Content Scraping
 *
 * Calls Apify actor REST API to scrape TikTok, Instagram, and Twitter/X.
 * Requires user's Apify API key (stored in SettingsManager).
 */

import type { ContentResult } from './pocket-cli';
import { proxyFetch } from '../../utils/proxy-fetch';

const LOG_PREFIX = '[apify]';
const APIFY_BASE = 'https://api.apify.com/v2';
const POLL_INTERVAL_MS = 3_000;
const MAX_POLL_ATTEMPTS = 60; // 3 minutes max

// ── Types ──

interface ApifyRunResponse {
  data: {
    id: string;
    status: string;
    defaultDatasetId: string;
  };
}

type ApifyItem = Record<string, unknown>;

// ── Error class ──

export class ApifyError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number
  ) {
    super(message);
    this.name = 'ApifyError';
  }
}

// ── Internals ──

function assertApiKey(apiKey: string): void {
  if (!apiKey || apiKey.trim().length === 0) {
    throw new ApifyError('Apify API key is not set. Add your key in Settings.');
  }
}

async function apifyFetch<T>(url: string, apiKey: string, options?: RequestInit): Promise<T> {
  // Use query-param auth (?token=) — more reliable than Bearer header with Apify
  const separator = url.includes('?') ? '&' : '?';
  const authedUrl = `${url}${separator}token=${encodeURIComponent(apiKey)}`;
  const response = await proxyFetch(authedUrl, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (response.status === 401 || response.status === 403) {
    throw new ApifyError('Invalid Apify API key. Check your key in Settings.', response.status);
  }

  if (response.status === 429) {
    throw new ApifyError('Apify rate limit exceeded. Try again later.', 429);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new ApifyError(
      `Apify API error (HTTP ${response.status}): ${body.slice(0, 200)}`,
      response.status
    );
  }

  return response.json() as Promise<T>;
}

/**
 * Start an Apify actor run, poll until completion, and return dataset items.
 */
async function runActorAndCollect(
  actorId: string,
  input: Record<string, unknown>,
  apiKey: string
): Promise<ApifyItem[]> {
  console.log(`${LOG_PREFIX} Starting actor ${actorId}`);

  // Start the run
  const runUrl = `${APIFY_BASE}/acts/${actorId}/runs`;
  const runResponse = await apifyFetch<ApifyRunResponse>(runUrl, apiKey, {
    method: 'POST',
    body: JSON.stringify(input),
  });

  const runId = runResponse.data.id;
  const datasetId = runResponse.data.defaultDatasetId;
  console.log(`${LOG_PREFIX} Run started: ${runId}, dataset: ${datasetId}`);

  // Poll for completion
  const pollUrl = `${APIFY_BASE}/actor-runs/${runId}`;
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

    const status = await apifyFetch<ApifyRunResponse>(pollUrl, apiKey);
    const runStatus = status.data.status;

    if (runStatus === 'SUCCEEDED') {
      console.log(`${LOG_PREFIX} Run ${runId} succeeded`);
      break;
    }

    if (runStatus === 'FAILED' || runStatus === 'ABORTED' || runStatus === 'TIMED-OUT') {
      throw new ApifyError(`Actor run ${runId} ended with status: ${runStatus}`);
    }

    // Still running (READY, RUNNING) — continue polling
  }

  // Fetch dataset items (cap download to the limit requested in input to avoid excess transfer)
  const reqLimit = typeof input.maxItems === 'number' ? input.maxItems
    : typeof input.resultsPerPage === 'number' ? input.resultsPerPage
    : typeof input.resultsLimit === 'number' ? input.resultsLimit
    : 0;
  const limitParam = reqLimit > 0 ? `&limit=${reqLimit}` : '';
  const datasetUrl = `${APIFY_BASE}/datasets/${datasetId}/items?format=json${limitParam}`;
  const dataset = await apifyFetch<ApifyItem[]>(datasetUrl, apiKey);

  // The items endpoint returns the array directly (not wrapped in data)
  const items = Array.isArray(dataset) ? dataset : [];
  console.log(`${LOG_PREFIX} Collected ${items.length} items from dataset ${datasetId}`);
  return items;
}

// ── Mappers ──

function mapTikTokItem(item: ApifyItem): ContentResult {
  const authorMeta = (item.authorMeta ?? {}) as Record<string, unknown>;
  const hashtagsRaw = Array.isArray(item.hashtags) ? item.hashtags : [];
  const tags = hashtagsRaw
    .map((h: Record<string, unknown>) => String(h.name ?? ''))
    .filter((t: string) => t.length > 0);
  const hasImages =
    Array.isArray(item.imagePost) && (item.imagePost as unknown[]).length > 0;

  // Extract media URLs — TikTok has videoUrl, or image URLs for slideshows
  const mediaUrls: string[] = [];
  if (item.videoUrl) mediaUrls.push(String(item.videoUrl));
  if (hasImages) {
    for (const img of item.imagePost as Record<string, unknown>[]) {
      const imgUrl = img.imageURL ?? img.imageUrl ?? img.url;
      if (imgUrl) mediaUrls.push(String(imgUrl));
    }
  }
  if (!mediaUrls.length && item.musicMeta) {
    const cover = (item.musicMeta as Record<string, unknown>).coverLarge;
    if (cover) mediaUrls.push(String(cover));
  }

  return {
    platform: 'tiktok',
    externalId: String(item.id ?? ''),
    url: String(item.webVideoUrl ?? item.url ?? ''),
    title: String(item.text ?? '').slice(0, 100),
    caption: String(item.text ?? ''),
    views: Number(item.playCount ?? 0),
    likes: Number(item.diggCount ?? 0),
    comments: Number(item.commentCount ?? 0),
    shares: Number(item.shareCount ?? 0),
    creatorUsername: String(authorMeta.name ?? ''),
    createdAt: item.createTimeISO ? String(item.createTimeISO) : undefined,
    tags: tags.length > 0 ? tags : undefined,
    contentType: hasImages ? 'slideshow' : 'video',
    mediaUrls: mediaUrls.length > 0 ? mediaUrls : undefined,
  };
}

function mapInstagramItem(item: ApifyItem): ContentResult {
  const hashtags = Array.isArray(item.hashtags) ? (item.hashtags as string[]) : undefined;

  // Extract media URLs — Instagram has displayUrl (single), videoUrl (reel), or images[] (carousel)
  const mediaUrls: string[] = [];
  if (item.displayUrl) mediaUrls.push(String(item.displayUrl));
  if (item.videoUrl) mediaUrls.push(String(item.videoUrl));
  if (Array.isArray(item.images)) {
    for (const img of item.images as string[]) {
      if (img && !mediaUrls.includes(img)) mediaUrls.push(img);
    }
  }
  if (Array.isArray(item.childPosts)) {
    for (const child of item.childPosts as Record<string, unknown>[]) {
      const childUrl = child.displayUrl ?? child.videoUrl;
      if (childUrl) mediaUrls.push(String(childUrl));
    }
  }

  return {
    platform: 'instagram',
    externalId: String(item.shortCode ?? ''),
    url: String(item.url ?? ''),
    title: String(item.caption ?? '').slice(0, 100),
    caption: String(item.caption ?? ''),
    views: Number(item.videoViewCount ?? 0),
    likes: Number(item.likesCount ?? 0),
    comments: Number(item.commentsCount ?? 0),
    shares: 0,
    creatorUsername: String(item.ownerUsername ?? ''),
    createdAt: item.timestamp ? String(item.timestamp) : undefined,
    contentType: item.type ? String(item.type) : undefined,
    tags: hashtags && hashtags.length > 0 ? hashtags : undefined,
    mediaUrls: mediaUrls.length > 0 ? mediaUrls : undefined,
  };
}

function mapTwitterItem(item: ApifyItem): ContentResult {
  const author = (item.author ?? {}) as Record<string, unknown>;
  const entities = (item.entities ?? {}) as Record<string, unknown>;
  const hashtagsRaw = Array.isArray(entities.hashtags) ? entities.hashtags : [];
  const tags = hashtagsRaw
    .map((h: Record<string, unknown>) => String(h.text ?? h.tag ?? ''))
    .filter((t: string) => t.length > 0);
  // Extract media URLs — Twitter has media[] array with image/video URLs
  const mediaUrls: string[] = [];
  const media = (entities.media ?? item.media) as Record<string, unknown>[] | undefined;
  if (Array.isArray(media)) {
    for (const m of media) {
      const mUrl = m.media_url_https ?? m.url ?? m.preview_image_url;
      if (mUrl) mediaUrls.push(String(mUrl));
    }
  }
  // Also check extendedEntities (higher-res media)
  const extEntities = (item.extendedEntities ?? {}) as Record<string, unknown>;
  const extMedia = extEntities.media as Record<string, unknown>[] | undefined;
  if (Array.isArray(extMedia)) {
    for (const m of extMedia) {
      const mUrl = m.media_url_https ?? m.url;
      if (mUrl && !mediaUrls.includes(String(mUrl))) mediaUrls.push(String(mUrl));
    }
  }

  return {
    platform: 'twitter',
    externalId: String(item.id ?? ''),
    url: String(item.twitterUrl ?? item.url ?? ''),
    title: String(item.text ?? '').slice(0, 100),
    caption: String(item.text ?? ''),
    views: Number(item.viewCount ?? 0),
    likes: Number(item.likeCount ?? 0),
    comments: Number(item.replyCount ?? 0),
    shares: Number(item.retweetCount ?? 0),
    creatorUsername: String(author.userName ?? ''),
    createdAt: item.createdAt ? String(item.createdAt) : undefined,
    tags: tags.length > 0 ? tags : undefined,
    mediaUrls: mediaUrls.length > 0 ? mediaUrls : undefined,
  };
}

export interface TwitterTrendResult {
  name: string;
  tweetVolume: number | null;
  rank: number;
}

function mapTwitterTrendItem(item: ApifyItem, index: number): TwitterTrendResult {
  const rawVolume = String(item.volume ?? '').replace(/[^0-9]/g, '');
  return {
    name: String(item.trend ?? item.name ?? item.title ?? ''),
    tweetVolume: rawVolume ? parseInt(rawVolume, 10) || null : null,
    rank: index + 1,
  };
}

// ── Public API ──

/**
 * Search TikTok via the clockworks~tiktok-scraper actor.
 *
 * Auto-detects intent from the query:
 *   #hashtag  → hashtags input
 *   @username → profiles input
 *   keyword   → searchQueries input
 *
 * Callers can also pass explicit `hashtags` array for hashtag mode.
 */
export async function searchTikTok(
  params: { hashtags?: string[]; query?: string; limit?: number },
  apiKey: string
): Promise<ContentResult[]> {
  assertApiKey(apiKey);

  const ACTOR_ID = 'clockworks~tiktok-scraper';
  const limit = params.limit ?? 10;
  const query = (params.query ?? '').trim();

  // ── Explicit hashtags array ──
  if (params.hashtags && params.hashtags.length > 0) {
    const tags = params.hashtags.map((h) => h.replace(/^#/, '').toLowerCase());
    const input = { hashtags: tags, resultsPerPage: limit };
    console.log(`${LOG_PREFIX} TikTok hashtag search (explicit): ${params.hashtags.join(', ')}`);
    const items = await runActorAndCollect(ACTOR_ID, input, apiKey);
    return items.slice(0, limit).map(mapTikTokItem);
  }

  // ── @username → profiles ──
  if (query.startsWith('@')) {
    const input = { profiles: [query], resultsPerPage: limit };
    console.log(`${LOG_PREFIX} TikTok profile scrape: ${query}`);
    const items = await runActorAndCollect(ACTOR_ID, input, apiKey);
    return items.slice(0, limit).map(mapTikTokItem);
  }

  // ── #hashtag query ──
  if (query.startsWith('#')) {
    const tag = query.replace(/^#/, '').toLowerCase();
    const input = { hashtags: [tag], resultsPerPage: limit };
    console.log(`${LOG_PREFIX} TikTok hashtag search: #${tag}`);
    const items = await runActorAndCollect(ACTOR_ID, input, apiKey);
    return items.slice(0, limit).map(mapTikTokItem);
  }

  // ── Keyword → searchQueries ──
  const input = { searchQueries: [query], resultsPerPage: limit };
  console.log(`${LOG_PREFIX} TikTok keyword search: "${query}"`);
  const items = await runActorAndCollect(ACTOR_ID, input, apiKey);
  return items.slice(0, limit).map(mapTikTokItem);
}

/**
 * Search Instagram via apify~instagram-scraper actor.
 *
 * Everything goes through startUrls:
 *   Profile → https://www.instagram.com/username/
 *   Hashtag → https://www.instagram.com/explore/tags/tagname
 *
 * Actual actor fields (from build schema):
 *   startUrls, maxItems, until, customMapFunction
 */
export async function searchInstagram(
  params: { hashtags?: string[]; username?: string; limit?: number },
  apiKey: string
): Promise<ContentResult[]> {
  assertApiKey(apiKey);

  const ACTOR_ID = 'apify~instagram-scraper';
  const limit = params.limit ?? 20;

  const directUrls: string[] = [];

  if (params.hashtags && params.hashtags.length > 0) {
    for (const h of params.hashtags) {
      const tag = h.replace(/^#/, '').toLowerCase();
      directUrls.push(`https://www.instagram.com/explore/tags/${tag}/`);
    }
  }

  if (params.username) {
    const username = params.username.replace(/^@/, '');
    directUrls.push(`https://www.instagram.com/${username}/`);
  }

  const input = { directUrls, resultsType: 'posts', resultsLimit: limit };
  console.log(`${LOG_PREFIX} Instagram scrape: ${directUrls.join(', ')}`);
  const items = await runActorAndCollect(ACTOR_ID, input, apiKey);
  return items.slice(0, limit).map(mapInstagramItem);
}

/**
 * Search Twitter/X via the kaitoeasyapi pay-per-result actor.
 *
 * Input: single `twitterContent` string, `maxItems`, `queryType`.
 * No minimum item requirement — pay only for what you get.
 */
export async function searchTwitter(
  params: { searchTerms: string[]; limit?: number },
  apiKey: string
): Promise<ContentResult[]> {
  assertApiKey(apiKey);

  const ACTOR_ID = 'kaitoeasyapi~twitter-x-data-tweet-scraper-pay-per-result-cheapest';
  const limit = params.limit ?? 10;

  const input = {
    twitterContent: params.searchTerms.join(' OR '),
    maxItems: limit,
    queryType: 'Latest',
  };

  console.log(`${LOG_PREFIX} Twitter search: ${input.twitterContent}`);
  const items = await runActorAndCollect(ACTOR_ID, input, apiKey);
  return items.slice(0, limit).map(mapTwitterItem);
}

/**
 * Scrape a Twitter/X user's profile for their recent tweets.
 *
 * Uses "from:handle" search syntax with the kaitoeasyapi actor.
 */
export async function scrapeTwitterProfile(
  params: { handles: string[]; limit?: number },
  apiKey: string
): Promise<ContentResult[]> {
  assertApiKey(apiKey);

  const ACTOR_ID = 'kaitoeasyapi~twitter-x-data-tweet-scraper-pay-per-result-cheapest';
  const limit = params.limit ?? 5;

  const queries = params.handles.map((h) => `from:${h.replace(/^@/, '')}`);
  const input = {
    twitterContent: queries.join(' OR '),
    maxItems: limit,
    queryType: 'Latest',
  };

  console.log(`${LOG_PREFIX} Twitter profile scrape: ${input.twitterContent}`);
  const items = await runActorAndCollect(ACTOR_ID, input, apiKey);
  return items.slice(0, limit).map(mapTwitterItem);
}

/**
 * Get trending topics on Twitter/X via the karamelo~twitter-trends-scraper actor.
 *
 * Actual actor field (from build schema): `country`
 */
export async function getTwitterTrending(
  params: { location?: string },
  apiKey: string
): Promise<TwitterTrendResult[]> {
  assertApiKey(apiKey);

  const ACTOR_ID = 'karamelo~twitter-trends-scraper';
  const input: Record<string, unknown> = {
    country: params.location ?? 'United States',
    live: true,
  };

  console.log(`${LOG_PREFIX} Twitter trending: country=${input.country}`);
  const items = await runActorAndCollect(ACTOR_ID, input, apiKey);
  return items.map(mapTwitterTrendItem);
}
