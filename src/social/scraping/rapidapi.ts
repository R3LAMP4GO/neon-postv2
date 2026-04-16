/**
 * RapidAPI Client - TikTok Content Scraping
 *
 * Uses TikTok Scraper 7 (tikwm) via RapidAPI proxy.
 * Requires user's RapidAPI key (stored in SettingsManager).
 */

import type { ContentResult } from './pocket-cli';
import { proxyFetch } from '../../utils/proxy-fetch';

const LOG_PREFIX = '[rapidapi]';
const RAPIDAPI_HOST = 'tiktok-scraper7.p.rapidapi.com';
const BASE_URL = `https://${RAPIDAPI_HOST}`;
const REQUEST_TIMEOUT_MS = 30_000;

// ── Types ──

interface TikWMResponse<T> {
  code: number;
  msg: string;
  processed_time: number;
  data: T;
}

interface TikWMVideo {
  video_id: string;
  region: string;
  title: string;
  duration: number;
  play_count: number;
  digg_count: number;
  comment_count: number;
  share_count: number;
  download_count: number;
  create_time: number;
  wmplay?: string;
  play?: string;
  author: {
    id: string;
    unique_id: string;
    nickname: string;
    avatar: string;
  };
  music_info?: {
    id: string;
    title: string;
    author: string;
    original: boolean;
    duration: number;
    album: string;
  };
}

interface TikWMSearchData {
  videos: TikWMVideo[];
  cursor: number;
  hasMore: boolean;
}

interface TikWMVideoDetail {
  id: string;
  region: string;
  title: string;
  duration: number;
  cover: string;
  origin_cover: string;
  play: string;
  wmplay: string;
  size: number;
  wm_size: number;
  music: string;
  music_info: {
    id: string;
    title: string;
    play: string;
    cover: string;
    author: string;
    original: boolean;
    duration: number;
    album: string;
  };
  play_count: number;
  digg_count: number;
  comment_count: number;
  share_count: number;
  download_count: number;
  create_time: number;
  author: {
    id: string;
    unique_id: string;
    nickname: string;
    avatar: string;
  };
}

interface TikWMComment {
  cid: string;
  text: string;
  create_time: number;
  digg_count: number;
  reply_comment_total: number;
  user: {
    uid: string;
    unique_id: string;
    nickname: string;
    avatar_thumb: { url_list: string[] };
  };
}

interface TikWMCommentData {
  comments: TikWMComment[];
  cursor: number;
  hasMore: boolean;
  total: number;
}

interface TikWMHashtag {
  id: number;
  cha_name: string;
  user_count: number;
  view_count: number;
}

interface TikWMHashtagSearchData {
  challenge_list: TikWMHashtag[];
  cursor: number;
  hasMore: boolean;
}

// ── Error class ──

export class RapidAPIError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly apiCode?: number
  ) {
    super(message);
    this.name = 'RapidAPIError';
  }
}

// ── Core request ──

async function rapidApiFetch<T>(
  path: string,
  params: Record<string, string | number>,
  apiKey: string
): Promise<T> {
  const url = new URL(path, BASE_URL);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') {
      url.searchParams.set(k, String(v));
    }
  }

  const res = await proxyFetch(url.toString(), {
    method: 'GET',
    headers: {
      'X-RapidAPI-Key': apiKey,
      'X-RapidAPI-Host': RAPIDAPI_HOST,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new RapidAPIError('Invalid or expired RapidAPI key.', res.status);
    }
    if (res.status === 429) {
      throw new RapidAPIError('RapidAPI rate limit exceeded. Try again later.', res.status);
    }
    throw new RapidAPIError(`RapidAPI HTTP ${res.status}: ${res.statusText}`, res.status);
  }

  const json = (await res.json()) as TikWMResponse<T>;
  if (json.code !== 0 && json.msg !== 'success') {
    throw new RapidAPIError(`TikWM API error: ${json.msg}`, undefined, json.code);
  }

  return json.data;
}

// ── Mappers ──

function mapVideoToContentResult(v: TikWMVideo): ContentResult {
  return {
    platform: 'tiktok',
    externalId: v.video_id,
    url:
      v.play ??
      v.wmplay ??
      `https://www.tiktok.com/@${v.author?.unique_id ?? 'unknown'}/video/${v.video_id}`,
    title: v.title || '',
    caption: v.title || '',
    views: v.play_count ?? 0,
    likes: v.digg_count ?? 0,
    comments: v.comment_count ?? 0,
    shares: v.share_count ?? 0,
    creatorUsername: v.author?.unique_id ?? '',
  };
}

// ── Public API ──

/**
 * Search TikTok videos by keyword.
 */
export async function searchTikTok(
  params: { query: string; limit?: number; cursor?: number },
  apiKey: string
): Promise<ContentResult[]> {
  console.log(`${LOG_PREFIX} searchTikTok: query="${params.query}" limit=${params.limit ?? 20}`);
  const data = await rapidApiFetch<TikWMSearchData>(
    '/api/feed/search',
    {
      keywords: params.query,
      count: params.limit ?? 20,
      cursor: params.cursor ?? 0,
    },
    apiKey
  );

  return (data.videos ?? []).map(mapVideoToContentResult);
}

/**
 * Get TikTok trending videos by region.
 */
export async function getTikTokTrending(
  params: { region?: string; count?: number },
  apiKey: string
): Promise<ContentResult[]> {
  console.log(
    `${LOG_PREFIX} getTikTokTrending: region=${params.region ?? 'US'} count=${params.count ?? 20}`
  );
  const data = await rapidApiFetch<TikWMVideo[]>(
    '/api/feed/list',
    {
      region: params.region ?? 'US',
      count: params.count ?? 20,
    },
    apiKey
  );

  return (data ?? []).map(mapVideoToContentResult);
}

/**
 * Get TikTok user videos.
 */
export async function getTikTokUserVideos(
  params: { uniqueId: string; count?: number; cursor?: number },
  apiKey: string
): Promise<ContentResult[]> {
  console.log(`${LOG_PREFIX} getTikTokUserVideos: user=${params.uniqueId}`);
  const data = await rapidApiFetch<{ videos: TikWMVideo[] }>(
    '/api/user/posts',
    {
      unique_id: params.uniqueId,
      count: params.count ?? 20,
      cursor: params.cursor ?? 0,
    },
    apiKey
  );

  return (data.videos ?? []).map(mapVideoToContentResult);
}

/**
 * Get TikTok video details + no-watermark download URL.
 */
export async function getTikTokVideoDetail(
  videoUrl: string,
  apiKey: string
): Promise<TikWMVideoDetail> {
  console.log(`${LOG_PREFIX} getTikTokVideoDetail: url=${videoUrl}`);
  return rapidApiFetch<TikWMVideoDetail>(
    '/api',
    {
      url: videoUrl,
      hd: 1,
    },
    apiKey
  );
}

/**
 * Get TikTok video comments.
 */
export async function getTikTokComments(
  params: { videoUrl: string; count?: number; cursor?: number },
  apiKey: string
): Promise<TikWMCommentData> {
  console.log(`${LOG_PREFIX} getTikTokComments: url=${params.videoUrl}`);
  return rapidApiFetch<TikWMCommentData>(
    '/api/comment/list',
    {
      url: params.videoUrl,
      count: params.count ?? 20,
      cursor: params.cursor ?? 0,
    },
    apiKey
  );
}

/**
 * Search TikTok hashtags by keyword.
 */
export async function searchTikTokHashtags(
  params: { keywords: string; count?: number; cursor?: number },
  apiKey: string
): Promise<TikWMHashtag[]> {
  console.log(`${LOG_PREFIX} searchTikTokHashtags: keywords="${params.keywords}"`);
  const data = await rapidApiFetch<TikWMHashtagSearchData>(
    '/api/challenge/search',
    {
      keywords: params.keywords,
      count: params.count ?? 20,
      cursor: params.cursor ?? 0,
    },
    apiKey
  );

  return data.challenge_list ?? [];
}

/**
 * Get videos by hashtag/challenge ID.
 */
export async function getTikTokHashtagVideos(
  params: { challengeId: number; count?: number; cursor?: number },
  apiKey: string
): Promise<ContentResult[]> {
  console.log(`${LOG_PREFIX} getTikTokHashtagVideos: challengeId=${params.challengeId}`);
  const data = await rapidApiFetch<{ videos: TikWMVideo[] }>(
    '/api/challenge/posts',
    {
      challenge_id: params.challengeId,
      count: params.count ?? 20,
      cursor: params.cursor ?? 0,
    },
    apiKey
  );

  return (data.videos ?? []).map(mapVideoToContentResult);
}

/**
 * Test RapidAPI key validity by fetching one trending video.
 */
export async function testRapidAPIKey(apiKey: string): Promise<boolean> {
  try {
    await rapidApiFetch<TikWMVideo[]>('/api/feed/list', { region: 'US', count: 1 }, apiKey);
    return true;
  } catch {
    return false;
  }
}
