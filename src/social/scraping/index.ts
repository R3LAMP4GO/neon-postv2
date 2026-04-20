/**
 * Social Scraping - Unified Search Router
 *
 * Routes to pocket-cli, Apify, or RapidAPI based on platform and user preference.
 * Priority: Apify (TikTok/Instagram/Twitter) > RapidAPI (TikTok fallback) > pocket-cli (YouTube/Twitter/Reddit).
 *
 * API keys are read from SettingsManager.
 */

import fs from 'node:fs';
import path from 'node:path';

import { proxyFetch } from '../../utils/proxy-fetch';
import { SettingsManager } from '../../settings';

import {
  searchYouTube as pocketSearchYouTube,
  searchReddit as pocketSearchReddit,
  getTwitterTimeline,
  downloadVideo as pocketDownloadVideo,
  getYouTubeChannelVideos as pocketGetYouTubeChannelVideos,
} from './pocket-cli';
import {
  searchTikTok as apifySearchTikTok,
  searchInstagram as apifySearchInstagram,
  searchTwitter as apifySearchTwitter,
  scrapeTwitterProfile as apifyScrapeTwitterProfile,
  getTwitterTrending as apifyGetTwitterTrending,
} from './apify';
import {
  searchTikTok as rapidapiSearchTikTok,
  getTikTokTrending as rapidapiGetTrending,
  getTikTokUserVideos as rapidapiGetTikTokUserVideos,
} from './rapidapi';

// Re-export types from pocket-cli (canonical ContentResult)
export type { ContentResult } from './pocket-cli';
import type { ContentResult } from './pocket-cli';

// Re-export all sub-module functions for direct access
export {
  searchYouTube as pocketSearchYouTube,
  searchReddit as pocketSearchReddit,
  getTwitterTimeline,
  getYouTubeVideo,
  getYouTubeChannel,
  getYouTubeChannelVideos,
  getYouTubeTrending,
  getYouTubeComments,
  getRedditSubreddit,
  getRedditComments,
  getTwitterProfile,
  downloadVideo as pocketDownloadVideo,
} from './pocket-cli';
export type {
  YouTubeVideo,
  YouTubeChannel,
  YouTubeComment,
  RedditPost,
  RedditComment,
  TwitterProfile,
  TweetResult,
} from './pocket-cli';

export {
  searchTikTok as apifySearchTikTok,
  searchInstagram as apifySearchInstagram,
  searchTwitter as apifySearchTwitter,
  scrapeTwitterProfile as apifyScrapeTwitterProfile,
  getTwitterTrending as apifyGetTwitterTrending,
  ApifyError,
} from './apify';
export type { TwitterTrendResult } from './apify';

export {
  scrapeArticle,
  scrapeSource,
  detectSourceType,
  ArticleScrapeError,
} from './article';
export type { ArticleResult, SourceType, ScrapeSourceOptions, ScrapeSourceResult } from './article';

export {
  searchTikTok as rapidapiSearchTikTok,
  getTikTokTrending as rapidapiGetTrending,
  getTikTokUserVideos as rapidapiGetTikTokUserVideos,
  getTikTokVideoDetail,
  getTikTokComments,
  searchTikTokHashtags,
  getTikTokHashtagVideos,
  testRapidAPIKey,
  RapidAPIError,
} from './rapidapi';

// ── Constants ──

const LOG_PREFIX = '[scraping]';

export type ScrapingPlatform = 'youtube' | 'tiktok' | 'instagram' | 'twitter' | 'reddit';
export type ScrapingMethod = 'pocket-cli' | 'apify' | 'rapidapi';

interface SearchOptions {
  limit?: number;
  method?: ScrapingMethod;
}

// ── Key retrieval ──

function getApifyKey(): string | null {
  const key = SettingsManager.get('apify.apiKey');
  return key || null;
}

function getRapidAPIKey(): string | null {
  const key = SettingsManager.get('rapidapi.apiKey');
  return key || null;
}

// ── Method selection ──

/**
 * Pick the default scraping method for a platform.
 * For TikTok: prefer Apify if key exists, then RapidAPI fallback, then error.
 * For Instagram: Apify only.
 * For YouTube/Twitter/Reddit: pocket-cli.
 */
function defaultMethod(platform: ScrapingPlatform): ScrapingMethod {
  switch (platform) {
    case 'youtube':
    case 'reddit':
      return 'pocket-cli';
    case 'twitter': {
      if (getApifyKey()) return 'apify';
      return 'pocket-cli';
    }
    case 'tiktok': {
      if (getApifyKey()) return 'apify';
      if (getRapidAPIKey()) return 'rapidapi';
      return 'apify'; // will error with "key not configured" message
    }
    case 'instagram':
      return 'apify';
  }
}

// ── Unified search ──

/**
 * Search content across platforms.
 * Picks the right backend based on platform and method preference.
 */
export async function searchContent(
  platform: ScrapingPlatform,
  query: string,
  options?: SearchOptions
): Promise<ContentResult[]> {
  const limit = Math.min(Math.max(options?.limit ?? 5, 1), 10);
  const method = options?.method ?? defaultMethod(platform);

  console.log(
    `${LOG_PREFIX} searchContent: platform=${platform} method=${method} query="${query}" limit=${limit}`
  );

  if (method === 'rapidapi') {
    const apiKey = getRapidAPIKey();
    if (!apiKey) {
      throw new Error(
        'RapidAPI key not configured. Add your RapidAPI key in Settings to search TikTok.'
      );
    }

    switch (platform) {
      case 'tiktok':
        return rapidapiSearchTikTok({ query, limit }, apiKey);
      default:
        throw new Error(
          `RapidAPI method only supports TikTok. Use pocket-cli or apify for ${platform}.`
        );
    }
  }

  if (method === 'apify') {
    const apiKey = getApifyKey();
    if (!apiKey) {
      throw new Error(
        'Apify API key not configured. Add your Apify API key in Settings to search ' +
          `${platform === 'tiktok' ? 'TikTok' : platform === 'instagram' ? 'Instagram' : platform}.`
      );
    }

    switch (platform) {
      case 'tiktok':
        return apifySearchTikTok({ query, limit }, apiKey);
      case 'instagram':
        return apifySearchInstagram({ hashtags: query ? [query] : undefined, limit }, apiKey);
      case 'twitter':
        return apifySearchTwitter({ searchTerms: [query], limit }, apiKey);
      case 'youtube':
      case 'reddit':
        throw new Error(`Apify method is not available for ${platform}. Use pocket-cli instead.`);
    }
  }

  // pocket-cli method
  switch (platform) {
    case 'youtube':
      return pocketSearchYouTube(query, limit);
    case 'twitter':
      return getTwitterTimeline(limit);
    case 'reddit':
      return pocketSearchReddit(query, { limit });
    case 'tiktok':
    case 'instagram':
      throw new Error(
        `pocket-cli does not support ${platform} search. ` +
          'Add your RapidAPI key or Apify API key in Settings.'
      );
  }
}

// ── Trending ──

/**
 * Get trending TikTok content. Uses RapidAPI if available, falls back to Apify.
 */
export async function getTrendingTikTok(region?: string, count?: number): Promise<ContentResult[]> {
  const rapidKey = getRapidAPIKey();
  if (rapidKey) {
    return rapidapiGetTrending({ region, count }, rapidKey);
  }

  // Apify doesn't have a dedicated trending endpoint, fall through to search
  const apifyKey = getApifyKey();
  if (apifyKey) {
    return apifySearchTikTok({ query: 'trending', limit: count ?? 20 }, apifyKey);
  }

  throw new Error('No API key configured for TikTok. Add RapidAPI or Apify key in Settings.');
}

/**
 * Get trending topics on Twitter/X. Requires Apify key.
 */
export async function getTwitterTrending(location?: string) {
  const apifyKey = getApifyKey();
  if (!apifyKey) {
    throw new Error('Apify API key not configured. Add your Apify API key in Settings to get Twitter trends.');
  }
  return apifyGetTwitterTrending({ location }, apifyKey);
}

// ── Profile scraping ──

/**
 * Scrape a specific user's profile for their recent posts.
 * Routes to the appropriate backend based on platform.
 */
export async function scrapeProfile(
  platform: ScrapingPlatform,
  username: string,
  options?: { limit?: number }
): Promise<ContentResult[]> {
  const limit = Math.min(Math.max(options?.limit ?? 5, 1), 10);
  const clean = username.replace(/^@/, '');

  console.log(
    `${LOG_PREFIX} scrapeProfile: platform=${platform} username="${clean}" limit=${limit}`
  );

  switch (platform) {
    case 'tiktok': {
      const rapidKey = getRapidAPIKey();
      if (rapidKey) {
        return rapidapiGetTikTokUserVideos({ uniqueId: clean, count: limit }, rapidKey);
      }
      const apifyKey = getApifyKey();
      if (apifyKey) {
        return apifySearchTikTok({ query: `@${clean}`, limit }, apifyKey);
      }
      throw new Error(
        'No API key configured for TikTok profile scraping. Add RapidAPI or Apify key in Settings.'
      );
    }
    case 'instagram': {
      const apifyKey = getApifyKey();
      if (!apifyKey) {
        throw new Error(
          'Apify API key not configured. Add your Apify API key in Settings to scrape Instagram profiles.'
        );
      }
      return apifySearchInstagram({ username: clean, limit }, apifyKey);
    }
    case 'youtube':
      return pocketGetYouTubeChannelVideos(clean, limit);
    case 'twitter': {
      const apifyKey = getApifyKey();
      if (apifyKey) {
        return apifyScrapeTwitterProfile({ handles: [clean], limit }, apifyKey);
      }
      throw new Error(
        'Apify API key not configured. Add your Apify API key in Settings to scrape Twitter profiles.'
      );
    }
    case 'reddit':
      throw new Error('Profile scraping is not supported for Reddit. Use search instead.');
  }
}

// ── Video download ──

/**
 * Download a video from a URL to the specified output directory.
 * Tries yt-dlp first, then direct HTTP, then pocket-cli as last resort.
 */
export async function downloadVideo(url: string, outputDir: string): Promise<string> {
  fs.mkdirSync(outputDir, { recursive: true });

  // Try yt-dlp first (handles TikTok, YouTube, Instagram, etc.)
  try {
    const { execFile } = await import('node:child_process');
    const outTemplate = path.join(outputDir, '%(id)s.%(ext)s');
    const dlpArgs = ['--no-playlist', '-o', outTemplate, '--print', 'after_move:filepath', url];

    // On Windows, yt-dlp is typically installed as a Python module
    const isWin = process.platform === 'win32';
    const cmd = isWin ? 'python' : 'yt-dlp';
    const args = isWin ? ['-m', 'yt_dlp', ...dlpArgs] : dlpArgs;

    const filePath = await new Promise<string>((resolve, reject) => {
      execFile(
        cmd,
        args,
        { timeout: 120_000 },
        (error, stdout, stderr) => {
          if (error) {
            reject(new Error(`yt-dlp failed: ${stderr?.slice(0, 200) ?? error.message}`));
            return;
          }
          const output = stdout.trim().split('\n').pop() ?? '';
          if (output) {
            resolve(output);
          } else {
            reject(new Error('yt-dlp produced no output path'));
          }
        }
      );
    });
    console.log(`${LOG_PREFIX} Downloaded via yt-dlp: ${filePath}`);
    return filePath;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`${LOG_PREFIX} yt-dlp not available or failed: ${msg}`);
  }

  // Fallback: direct HTTP download (works for direct video URLs from Apify results)
  try {
    console.log(`${LOG_PREFIX} Trying direct HTTP download: ${url}`);
    const response = await proxyFetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      redirect: 'follow',
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const contentType = response.headers.get('content-type') ?? '';
    const ext = contentType.includes('mp4') ? 'mp4' : contentType.includes('webm') ? 'webm' : 'mp4';
    const filename = `video_${Date.now()}.${ext}`;
    const filePath = path.join(outputDir, filename);

    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(filePath, buffer);
    console.log(`${LOG_PREFIX} Downloaded via HTTP: ${filePath} (${buffer.length} bytes)`);
    return filePath;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${LOG_PREFIX} Direct HTTP download failed: ${msg}`);
  }

  // Last resort: try pocket-cli
  return pocketDownloadVideo(url, outputDir);
}
