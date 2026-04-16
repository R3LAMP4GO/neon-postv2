/**
 * Social tools for the agent
 *
 * 20 tools for social media operations:
 * - search_content: Search content across platforms
 * - scrape_profile: Scrape a user's profile posts
 * - get_trending: Get trending content
 * - download_video: Download video from URL
 * - post_content: Post content to a platform
 * - schedule_post: Schedule a post for later
 * - list_social_accounts: List connected social accounts
 * - list_social_posts: List tracked social posts
 * - process_video: Process/edit a video file
 * - transcribe_video: Transcribe audio/video to text
 * - generate_content: Generate social media content (captions, hooks, etc.)
 * - save_content: Save discovered or generated content to the database
 * - reply_to_comment: Reply to a comment on social media
 * - flag_comment: Flag a comment for review
 * - generate_image: Generate images via Kie.ai (text-to-image / image-to-image)
 * - upload_reference_image: Upload a local image for use as reference in image generation
 * - repurpose_content: Repurpose content across platforms with transcription support
 * - analyze_trends: Detect trending topics from discovered content
 * - upload_video_draft: Attach a video file to an existing draft
 * - create_from_video: Full pipeline: upload → transcribe → generate copy → create draft
 */

import { existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join, extname } from 'node:path';
import { MemoryManager } from '../memory';
import { searchContent, scrapeProfile, getTrendingTikTok, getTwitterTrending, downloadVideo } from '../social/scraping';
import type { ScrapingPlatform } from '../social/scraping';
import type { TwitterTrendResult } from '../social/scraping';
import { checkCache, storeInCache, computeQueryHash } from '../social/scraping/cache';
import { postContent, buildCredentialsFromAccount } from '../social/posting';
import { Platform } from '../social/posting/types';
import type { PlatformPostOptions } from '../social/posting/types';
import { processVideo } from '../social/video/pipeline';

import { fetchComments, prioritizeComments } from '../social/engagement/monitor';
import { postReply } from '../social/engagement/reply';
import { captionPrompt, hookPrompt, threadPrompt, scriptPrompt, repurposePrompt } from '../social/content/prompts';
import type {
  ContentPromptContext,
  HookPromptContext,
  ThreadPromptContext,
  ScriptPromptContext,
  RepurposePromptContext,
} from '../social/content/prompts';
import { transcribeContent } from '../social/transcription/assemblyai';
import { finalizeDraft } from '../social/content/finalize';
import { calculateViralScore } from '../social/scoring/viral-score';
import type { ScoringPlatform } from '../social/scoring/viral-score';
import { detectTrends } from '../social/scoring/trend-detect';
import { app } from 'electron';
import { KieClient, resolveModelId } from '../image';
import type { ImageJobTracker } from '../image';
import { SettingsManager } from '../settings';
import { EventEmitter } from 'node:events';
import { getCurrentSessionId } from './session-context';

let memoryManager: MemoryManager | null = null;
let imageTracker: ImageJobTracker | null = null;

/** Emits events that the main process can forward to the renderer */
export const socialToolEvents = new EventEmitter();

// ── Search rate limiting ──
const SEARCH_LIMIT_PER_SESSION = 5;
const SEARCH_DEFAULT_RESULTS = 5;
const SEARCH_MAX_RESULTS = 10;
const searchCountBySession = new Map<string, number>();

// ── Per-session cache offset tracking ──
// Key: `${sessionId}:${queryHash}`, Value: current offset into cached results
const cacheOffsetByQuery = new Map<string, number>();

export function setSocialMemoryManager(memory: MemoryManager): void {
  memoryManager = memory;
}

export function setImageJobTracker(tracker: ImageJobTracker): void {
  imageTracker = tracker;
}

// ── Tool Definitions ──

function getSearchContentDefinition() {
  return {
    name: 'search_content',
    description:
      'Search social media content across platforms (YouTube, TikTok, Instagram, Twitter, Reddit). Returns matching posts/videos with metadata. Results are automatically displayed as cards in the chat and pushed to the Discover tab.',
    input_schema: {
      type: 'object' as const,
      properties: {
        platform: {
          type: 'string',
          description: 'Platform to search: youtube, tiktok, instagram, twitter, reddit',
        },
        query: {
          type: 'string',
          description: 'Search query',
        },
        limit: {
          type: 'number',
          description: `Max results to return (1-${SEARCH_MAX_RESULTS}, default ${SEARCH_DEFAULT_RESULTS})`,
        },
        content_type: {
          type: 'string',
          enum: ['video', 'image', 'carousel', 'text'],
          description:
            'Filter results by content type. Optional — omit to return all types.',
        },
      },
      required: ['platform', 'query'],
    },
  };
}

// ── Content type distribution priors (fraction, 0-1) ──
const CONTENT_TYPE_PRIORS: Record<string, Record<string, number>> = {
  tiktok: { video: 0.97, image: 0.01, carousel: 0.0, text: 0.0 },
  instagram: { video: 0.4, image: 0.3, carousel: 0.3, text: 0.0 },
  twitter: { video: 0.25, image: 0.35, carousel: 0.0, text: 0.4 },
  linkedin: { video: 0.15, image: 0.2, carousel: 0.2, text: 0.45 },
  youtube: { video: 1.0, image: 0.0, carousel: 0.0, text: 0.0 },
  reddit: { video: 0.1, image: 0.2, carousel: 0.0, text: 0.7 },
};

const OVERFETCH_CAP = 50;

function getOverfetchMultiplier(platform: string, contentType: string): number {
  const priors = CONTENT_TYPE_PRIORS[platform];
  if (!priors) return 1;
  const freq = priors[contentType] ?? 0;
  if (freq <= 0) return OVERFETCH_CAP;
  return Math.min(Math.ceil(1 / freq), OVERFETCH_CAP);
}

async function handleSearchContent(input: unknown): Promise<string> {
  const { platform, query, limit, content_type } = input as {
    platform: string;
    query: string;
    limit?: number;
    content_type?: 'video' | 'image' | 'carousel' | 'text';
  };

  if (!platform || !query) {
    return JSON.stringify({ error: 'Missing required fields: platform, query' });
  }

  // ── Rate limit check ──
  const sessionId = getCurrentSessionId() || '__default';
  const used = searchCountBySession.get(sessionId) || 0;
  if (used >= SEARCH_LIMIT_PER_SESSION) {
    // Notify the UI with a toast (avoids wasting agent tokens on a long explanation)
    socialToolEvents.emit('search:limitReached', {
      used,
      limit: SEARCH_LIMIT_PER_SESSION,
      sessionId,
    });
    // Short message to the agent so it stops retrying
    return JSON.stringify({ error: 'Search limit reached for this session. Do not retry.' });
  }

  // Emit started event so the UI can show a placeholder
  socialToolEvents.emit('search:started', { platform, query });

  try {
    const requestedLimit = Math.min(Math.max(limit ?? SEARCH_DEFAULT_RESULTS, 1), SEARCH_MAX_RESULTS);

    // Over-fetch when filtering for a rare content type on the platform
    const overfetchMultiplier = content_type ? getOverfetchMultiplier(platform, content_type) : 1;
    const fetchLimit = Math.min(requestedLimit * overfetchMultiplier, OVERFETCH_CAP);

    const queryHash = computeQueryHash(platform, query);
    const offsetKey = `${sessionId}:${queryHash}`;

    let results;
    let fromCache = false;

    // ── Cache-before-scrape ──
    if (memoryManager) {
      const currentOffset = cacheOffsetByQuery.get(offsetKey) ?? 0;
      const cached = checkCache(memoryManager, platform, query, fetchLimit, currentOffset, 'search');
      if (cached) {
        results = cached;
        fromCache = true;
        cacheOffsetByQuery.set(offsetKey, currentOffset + fetchLimit);
        console.log(`[SearchContent] Cache HIT for "${query}" on ${platform} (offset=${currentOffset})`);
      }
    }

    if (!results) {
      results = await searchContent(platform as ScrapingPlatform, query, { limit: fetchLimit });
      console.log(`[SearchContent] Found ${results.length} results for "${query}" on ${platform}`);

      // Store all results in cache for future lookups
      if (memoryManager && results.length > 0) {
        storeInCache(memoryManager, results, platform, query, 'search');
      }

      // Reset offset for this query since we got fresh results
      cacheOffsetByQuery.set(offsetKey, fetchLimit);
    }

    // Only count against rate limit when we actually hit the API
    if (!fromCache) {
      searchCountBySession.set(sessionId, used + 1);
    }

    // ── Content type filtering ──
    const totalBeforeFilter = results.length;
    if (content_type) {
      results = results.filter(
        (r) => r.contentType?.toLowerCase() === content_type.toLowerCase()
      );
    }
    // Slice to the originally requested limit
    results = results.slice(0, requestedLimit);

    // Attach ephemeral viral scores to each result
    const scoringPlatforms: string[] = ['tiktok', 'youtube', 'instagram', 'twitter', 'linkedin'];
    const scoredResults = results.map((r) => {
      if (scoringPlatforms.includes(platform)) {
        const breakdown = calculateViralScore(
          platform as ScoringPlatform,
          { likes: r.likes, comments: r.comments, shares: r.shares, views: r.views },
          r.createdAt
        );
        return { ...r, viral_score: breakdown.score, viral_tier: breakdown.tier };
      }
      return r;
    });

    // Push results to the Social panel's Discover tab
    if (scoredResults.length > 0) {
      socialToolEvents.emit('search:results', { query, platform, results: scoredResults });
    }

    // Build response — include a note when filtering returned fewer than requested
    const response: Record<string, unknown> = {
      success: true,
      count: scoredResults.length,
      results: scoredResults,
      cached: fromCache,
    };
    if (content_type && scoredResults.length < requestedLimit) {
      response.note = `Found ${scoredResults.length} ${content_type} posts out of ${totalBeforeFilter} total. ${content_type} content is rare on ${platform}.`;
    }

    return JSON.stringify(response);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return JSON.stringify({ error: msg });
  }
}

function getScrapeProfileDefinition() {
  return {
    name: 'scrape_profile',
    description:
      "Scrape a user's social media profile for their recent posts. Supports TikTok, Instagram, YouTube, and X/Twitter.",
    input_schema: {
      type: 'object' as const,
      properties: {
        platform: {
          type: 'string',
          description: 'Platform: youtube, tiktok, instagram, twitter',
        },
        username: {
          type: 'string',
          description: 'Username or channel name to scrape (with or without @)',
        },
        limit: {
          type: 'number',
          description: 'Max posts to return (1-10, default 5)',
        },
      },
      required: ['platform', 'username'],
    },
  };
}

async function handleScrapeProfile(input: unknown): Promise<string> {
  const { platform, username, limit } = input as {
    platform: string;
    username: string;
    limit?: number;
  };

  if (!platform || !username) {
    return JSON.stringify({ error: 'Missing required fields: platform, username' });
  }

  const sessionId = getCurrentSessionId() || '__default';
  const clean = username.replace(/^@/, '');
  const profileQuery = `profile:${clean}`;
  const queryHash = computeQueryHash(platform, profileQuery);
  const offsetKey = `${sessionId}:${queryHash}`;
  const clampedLimit = Math.min(Math.max(limit ?? 5, 1), 10);

  // Emit started event so the UI can show a placeholder
  socialToolEvents.emit('profile:started', { platform, username });

  try {
    let results;
    let fromCache = false;

    // ── Cache-before-scrape ──
    if (memoryManager) {
      const currentOffset = cacheOffsetByQuery.get(offsetKey) ?? 0;
      const cached = checkCache(memoryManager, platform, profileQuery, clampedLimit, currentOffset, 'profile');
      if (cached) {
        results = cached;
        fromCache = true;
        cacheOffsetByQuery.set(offsetKey, currentOffset + clampedLimit);
        console.log(`[ScrapeProfile] Cache HIT for @${clean} on ${platform} (offset=${currentOffset})`);
      }
    }

    if (!results) {
      results = await scrapeProfile(platform as ScrapingPlatform, username, { limit });
      console.log(`[ScrapeProfile] Found ${results.length} posts for @${clean} on ${platform}`);

      // Store results in cache
      if (memoryManager && results.length > 0) {
        storeInCache(memoryManager, results, platform, profileQuery, 'profile');
      }

      cacheOffsetByQuery.set(offsetKey, clampedLimit);
    }

    // Push profile results to the renderer
    if (results.length > 0) {
      socialToolEvents.emit('profile:results', { platform, username, results });
    }

    return JSON.stringify({ success: true, count: results.length, results, cached: fromCache });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return JSON.stringify({ error: msg });
  }
}

function getGetTrendingDefinition() {
  return {
    name: 'get_trending',
    description:
      'Get trending content on social media platforms. Supports TikTok trending videos, Twitter/X trending topics, and Instagram trending hashtags.',
    input_schema: {
      type: 'object' as const,
      properties: {
        platform: {
          type: 'string',
          description: 'Platform: tiktok, twitter, instagram',
        },
        region: {
          type: 'string',
          description:
            'Region filter. For TikTok: country code (e.g. "US", "GB"). For Twitter: country name (e.g. "United States", "United Kingdom"). Ignored for Instagram.',
        },
        count: {
          type: 'number',
          description: 'Number of trending items to return (default 20)',
        },
      },
      required: ['platform'],
    },
  };
}

async function handleGetTrending(input: unknown): Promise<string> {
  const { platform, region, count } = input as {
    platform: string;
    region?: string;
    count?: number;
  };

  if (!platform) {
    return JSON.stringify({ error: 'Missing required field: platform' });
  }

  try {
    switch (platform) {
      case 'tiktok': {
        const results = await getTrendingTikTok(region, count);
        console.log(`[GetTrending] Found ${results.length} trending items on TikTok`);

        socialToolEvents.emit('trending:results', { platform, results });
        return JSON.stringify({ success: true, count: results.length, results });
      }
      case 'twitter': {
        const trends = await getTwitterTrending(region);
        console.log(`[GetTrending] Found ${trends.length} trending topics on Twitter`);

        socialToolEvents.emit('trending:results', { platform, results: trends });
        return JSON.stringify({ success: true, count: trends.length, results: trends });
      }
      case 'instagram': {
        // Instagram has no dedicated trending API — use hashtag search as proxy
        const results = await searchContent('instagram' as ScrapingPlatform, '#trending', {
          limit: count ?? 20,
        });
        console.log(`[GetTrending] Found ${results.length} trending items on Instagram`);

        socialToolEvents.emit('trending:results', { platform, results });
        return JSON.stringify({ success: true, count: results.length, results });
      }
      default:
        return JSON.stringify({
          error: `Trending is supported for tiktok, twitter, and instagram. Got: ${platform}`,
        });
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return JSON.stringify({ error: msg });
  }
}

function getDownloadVideoDefinition() {
  return {
    name: 'download_video',
    description:
      'Download a video from a URL (YouTube, TikTok, Instagram, etc.). Uses yt-dlp with HTTP fallback. Downloads to the Neon-post workspace by default.',
    input_schema: {
      type: 'object' as const,
      properties: {
        url: {
          type: 'string',
          description: 'URL of the video to download',
        },
        output_dir: {
          type: 'string',
          description: 'Optional directory override. Defaults to Documents/Neon-post/downloads.',
        },
      },
      required: ['url'],
    },
  };
}

function getDefaultDownloadDir(): string {
  return join(homedir(), 'Documents', 'Neon-post', 'downloads');
}

async function handleDownloadVideo(input: unknown): Promise<string> {
  const { url, output_dir } = input as {
    url: string;
    output_dir?: string;
  };

  if (!url) {
    return JSON.stringify({ error: 'Missing required field: url' });
  }

  const dir = output_dir || getDefaultDownloadDir();

  try {
    const filePath = await downloadVideo(url, dir);
    console.log(`[DownloadVideo] Downloaded: ${filePath}`);
    return JSON.stringify({ success: true, filePath });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return JSON.stringify({ error: msg });
  }
}

function getPostContentDefinition() {
  return {
    name: 'post_content',
    description:
      'Post content to a social media platform. Requires a connected account with valid credentials. Supports TikTok, YouTube, Instagram, X/Twitter, and LinkedIn.',
    input_schema: {
      type: 'object' as const,
      properties: {
        platform: {
          type: 'string',
          description: 'Platform: tiktok, youtube, instagram, x, linkedin',
        },
        account_id: {
          type: 'string',
          description: 'Social account ID to post from (from list_social_accounts)',
        },
        text: {
          type: 'string',
          description: 'Post text/caption content',
        },
        media_files: {
          type: 'string',
          description: 'Comma-separated local file paths for media attachments',
        },
        title: {
          type: 'string',
          description: 'Title (required for YouTube)',
        },
        privacy: {
          type: 'string',
          description: 'Visibility: public, private, unlisted',
        },
        tags: {
          type: 'string',
          description: 'Comma-separated hashtags (without #)',
        },
      },
      required: ['platform', 'account_id', 'text'],
    },
  };
}

async function handlePostContent(input: unknown): Promise<string> {
  if (!memoryManager) {
    return JSON.stringify({ error: 'Memory not initialized' });
  }

  const { platform, account_id, text, media_files, title, privacy, tags } = input as {
    platform: string;
    account_id: string;
    text: string;
    media_files?: string;
    title?: string;
    privacy?: string;
    tags?: string;
  };

  if (!platform || !account_id || !text) {
    return JSON.stringify({ error: 'Missing required fields: platform, account_id, text' });
  }

  const account = memoryManager.socialAccounts.getById(account_id);
  if (!account) {
    return JSON.stringify({ error: `Social account not found: ${account_id}` });
  }

  const credentials = buildCredentialsFromAccount(account);
  const platformEnum = platform.toLowerCase() as Platform;

  const postOptions: PlatformPostOptions = {
    platform: platformEnum as Platform,
    text,
    credentials,
    mediaFiles: media_files ? media_files.split(',').map((f) => f.trim()) : undefined,
    title: title ?? text.slice(0, 100),
    privacy: (privacy as 'public' | 'private' | 'unlisted') ?? 'public',
    tags: tags ? tags.split(',').map((t) => t.trim()) : undefined,
  } as PlatformPostOptions;

  try {
    const result = await postContent(postOptions);
    console.log(`[PostContent] ${result.success ? 'Posted' : 'Failed'} on ${platform}`);

    // Track the post in the database
    if (result.success) {
      const post = memoryManager.socialPosts.create({
        social_account_id: account_id,
        platform,
        status: 'posted',
        content: text,
      });

      socialToolEvents.emit('post:published', { platform, postId: post.id, content: text });
    }

    return JSON.stringify(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return JSON.stringify({ error: msg });
  }
}

function getSchedulePostDefinition() {
  return {
    name: 'schedule_post',
    description:
      'Schedule a post for later publishing. Creates a draft/scheduled post entry in the database. ' +
      'For carousel posts, pass all image file paths from render_carousel\'s file_paths result as comma-separated media_urls.',
    input_schema: {
      type: 'object' as const,
      properties: {
        platform: {
          type: 'string',
          description: 'Platform: tiktok, youtube, instagram, x, linkedin',
        },
        account_id: {
          type: 'string',
          description: 'Social account ID (from list_social_accounts)',
        },
        content: {
          type: 'string',
          description: 'Post content/caption',
        },
        scheduled_at: {
          type: 'string',
          description: 'ISO-8601 datetime for when to publish (e.g. "2024-03-15T14:00:00Z")',
        },
        media_urls: {
          type: 'string',
          description:
            'Comma-separated media file paths or URLs. For carousels: pass the file_paths from render_carousel ' +
            '(e.g. "C:\\path\\post-abc.png,C:\\path\\post-def.png"). For single images: pass the file_path from render_post_image.',
        },
      },
      required: ['platform', 'content', 'scheduled_at'],
    },
  };
}

async function handleSchedulePost(input: unknown): Promise<string> {
  if (!memoryManager) {
    return JSON.stringify({ error: 'Memory not initialized' });
  }

  const { platform, account_id, content, scheduled_at, media_urls } = input as {
    platform: string;
    account_id?: string;
    content: string;
    scheduled_at: string;
    media_urls?: string;
  };

  if (!platform || !content || !scheduled_at) {
    return JSON.stringify({ error: 'Missing required fields: platform, content, scheduled_at' });
  }

  try {
    const post = memoryManager.socialPosts.create({
      social_account_id: account_id ?? null,
      platform,
      status: 'scheduled',
      content,
      scheduled_at,
      media_urls: media_urls ?? null,
    });

    console.log(`[SchedulePost] Scheduled post ${post.id} for ${scheduled_at} on ${platform}`);

    socialToolEvents.emit('schedule:created', { platform, postId: post.id, scheduled_at, content });

    return JSON.stringify({
      success: true,
      message: `Post scheduled for ${scheduled_at}`,
      post_id: post.id,
      platform,
      scheduled_at,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return JSON.stringify({ error: msg });
  }
}

function getListSocialAccountsDefinition() {
  return {
    name: 'list_social_accounts',
    description:
      'List all connected social media accounts. Shows platform, username, and active status.',
    input_schema: {
      type: 'object' as const,
      properties: {
        platform: {
          type: 'string',
          description: 'Optional: filter by platform (tiktok, youtube, instagram, x, linkedin)',
        },
        active_only: {
          type: 'string',
          description: 'If "true", show only active accounts (default: all)',
        },
      },
      required: [],
    },
  };
}

async function handleListSocialAccounts(input: unknown): Promise<string> {
  if (!memoryManager) {
    return JSON.stringify({ error: 'Memory not initialized' });
  }

  const { platform, active_only } = input as {
    platform?: string;
    active_only?: string;
  };

  try {
    let accounts;
    if (active_only === 'true') {
      accounts = memoryManager.socialAccounts.getActive();
    } else if (platform) {
      accounts = memoryManager.socialAccounts.getByPlatform(platform);
    } else {
      accounts = memoryManager.socialAccounts.getAll();
    }

    // Filter by platform if both platform and active_only are set
    if (platform && active_only === 'true') {
      accounts = accounts.filter((a) => a.platform === platform);
    }

    return JSON.stringify({
      success: true,
      count: accounts.length,
      accounts: accounts.map((a) => ({
        id: a.id,
        platform: a.platform,
        account_name: a.account_name,
        display_name: a.display_name,
        active: a.active,
        created_at: a.created_at,
      })),
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return JSON.stringify({ error: msg });
  }
}

function getListSocialPostsDefinition() {
  return {
    name: 'list_social_posts',
    description: 'List tracked social media posts. Filter by platform, status, or account.',
    input_schema: {
      type: 'object' as const,
      properties: {
        platform: {
          type: 'string',
          description: 'Filter by platform',
        },
        status: {
          type: 'string',
          description: 'Filter by status: draft, scheduled, posting, posted, failed',
        },
        account_id: {
          type: 'string',
          description: 'Filter by social account ID',
        },
        limit: {
          type: 'number',
          description: 'Max posts to return (default: all)',
        },
      },
      required: [],
    },
  };
}

async function handleListSocialPosts(input: unknown): Promise<string> {
  if (!memoryManager) {
    return JSON.stringify({ error: 'Memory not initialized' });
  }

  const { platform, status, account_id, limit } = input as {
    platform?: string;
    status?: string;
    account_id?: string;
    limit?: number;
  };

  try {
    let posts;
    if (status) {
      posts = memoryManager.socialPosts.getByStatus(
        status as 'draft' | 'scheduled' | 'posting' | 'posted' | 'failed'
      );
    } else if (platform) {
      posts = memoryManager.socialPosts.getByPlatform(platform);
    } else if (account_id) {
      posts = memoryManager.socialPosts.getByAccount(account_id);
    } else {
      posts = memoryManager.socialPosts.getAll();
    }

    if (limit && limit > 0) {
      posts = posts.slice(0, limit);
    }

    return JSON.stringify({
      success: true,
      count: posts.length,
      posts: posts.map((p) => ({
        id: p.id,
        platform: p.platform,
        status: p.status,
        content: p.content.slice(0, 200) + (p.content.length > 200 ? '...' : ''),
        scheduled_at: p.scheduled_at,
        posted_at: p.posted_at,
        external_url: p.external_url,
        likes: p.likes,
        comments: p.comments,
        shares: p.shares,
        views: p.views,
      })),
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return JSON.stringify({ error: msg });
  }
}

function getProcessVideoDefinition() {
  return {
    name: 'process_video',
    description:
      'Process/edit a video file. Supports trimming, resolution changes, effects, and caption overlays. Requires the video engine (effect_engine).',
    input_schema: {
      type: 'object' as const,
      properties: {
        input_path: {
          type: 'string',
          description: 'Absolute path to the input video file',
        },
        output_path: {
          type: 'string',
          description: 'Absolute path for the output video file',
        },
        resolution: {
          type: 'string',
          description:
            'Target resolution (e.g. "1080x1920" for vertical, "1920x1080" for landscape)',
        },
        trim_start: {
          type: 'number',
          description: 'Trim start time in seconds',
        },
        trim_end: {
          type: 'number',
          description: 'Trim end time in seconds',
        },
      },
      required: ['input_path', 'output_path'],
    },
  };
}

async function handleProcessVideo(input: unknown): Promise<string> {
  const { input_path, output_path, resolution, trim_start, trim_end } = input as {
    input_path: string;
    output_path: string;
    resolution?: string;
    trim_start?: number;
    trim_end?: number;
  };

  if (!input_path || !output_path) {
    return JSON.stringify({ error: 'Missing required fields: input_path, output_path' });
  }

  try {
    const result = await processVideo({
      inputPath: input_path,
      outputPath: output_path,
      resolution,
      trimStart: trim_start,
      trimEnd: trim_end,
    });

    console.log(
      `[ProcessVideo] ${result.success ? 'Processed' : 'Failed'}: ${input_path} → ${output_path}`
    );
    return JSON.stringify(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return JSON.stringify({ error: msg });
  }
}

function getTranscribeVideoDefinition() {
  return {
    name: 'transcribe_video',
    description:
      'Transcribe audio/video to text with timestamps. Primary: AssemblyAI (Universal v3). Fallback: local Whisper engine. Returns full transcript with timed segments.',
    input_schema: {
      type: 'object' as const,
      properties: {
        input_path: {
          type: 'string',
          description: 'Absolute path to the audio/video file, or a public URL',
        },
      },
      required: ['input_path'],
    },
  };
}

async function handleTranscribeVideo(input: unknown): Promise<string> {
  const { input_path } = input as { input_path: string };

  if (!input_path) {
    return JSON.stringify({ error: 'Missing required field: input_path' });
  }

  console.log(`[TranscribeVideo] Starting transcription: ${input_path}`);

  let filePath = input_path;

  if (input_path.startsWith('http')) {
    // Page URLs (TikTok, YouTube, Instagram) need to be downloaded first —
    // AssemblyAI only accepts direct media file URLs, not page URLs.
    try {
      console.log(`[TranscribeVideo] Downloading video from URL: ${input_path}`);
      const videoDir = join(app.getPath('userData'), 'videos', 'transcribe');
      filePath = await downloadVideo(input_path, videoDir);
      console.log(`[TranscribeVideo] Downloaded to: ${filePath}`);
    } catch (dlErr) {
      const dlMsg = dlErr instanceof Error ? dlErr.message : String(dlErr);
      console.error(`[TranscribeVideo] Download failed: ${dlMsg}`);
      return JSON.stringify({ error: `Failed to download video: ${dlMsg}` });
    }
  } else {
    // Verify file exists if it's a local path
    try {
      const fs = await import('node:fs');
      if (!fs.existsSync(input_path)) {
        console.error(`[TranscribeVideo] File not found: ${input_path}`);
        return JSON.stringify({ error: `File not found: ${input_path}` });
      }
      const stats = fs.statSync(input_path);
      console.log(`[TranscribeVideo] File exists, size: ${(stats.size / 1024 / 1024).toFixed(1)}MB`);
    } catch (fsErr) {
      console.error(`[TranscribeVideo] Cannot access file: ${fsErr}`);
    }
  }

  try {
    // Primary: AssemblyAI (CLI script → HTTP fallback → Whisper API fallback)
    const result = await transcribeContent(filePath);

    console.log(`[TranscribeVideo] Success: ${result.text.length} chars, ${result.segments.length} segments`);
    return JSON.stringify({
      success: true,
      transcription: result,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[TranscribeVideo] All transcription methods failed: ${msg}`);
    return JSON.stringify({ error: `Transcription failed: ${msg}` });
  }
}

function getGenerateContentDefinition() {
  return {
    name: 'generate_content',
    description:
      'Generate social media content: captions, hooks, threads, or scripts. Returns a prompt ready for content generation. Use with a follow-up LLM call.',
    input_schema: {
      type: 'object' as const,
      properties: {
        content_type: {
          type: 'string',
          description: 'Type of content: caption, hook, thread, script',
        },
        platform: {
          type: 'string',
          description: 'Target platform: tiktok, youtube, instagram, x, linkedin',
        },
        topic: {
          type: 'string',
          description: 'Topic or subject for the content',
        },
        brand_voice: {
          type: 'string',
          description: 'Brand voice description (optional)',
        },
        brand_tone: {
          type: 'string',
          description: 'Brand tone (e.g. casual, professional)',
        },
        count: {
          type: 'number',
          description: 'Number of variations (for hooks, default 5)',
        },
        thread_length: {
          type: 'number',
          description: 'Number of posts in thread (default 7)',
        },
        duration_seconds: {
          type: 'number',
          description: 'Target video duration for scripts (default 60)',
        },
      },
      required: ['content_type', 'platform', 'topic'],
    },
  };
}

async function handleGenerateContent(input: unknown): Promise<string> {
  const {
    content_type,
    platform,
    topic,
    brand_voice,
    brand_tone,
    count,
    thread_length,
    duration_seconds,
  } = input as {
    content_type: string;
    platform: string;
    topic: string;
    brand_voice?: string;
    brand_tone?: string;
    count?: number;
    thread_length?: number;
    duration_seconds?: number;
  };

  if (!content_type || !platform || !topic) {
    return JSON.stringify({
      error: 'Missing required fields: content_type, platform, topic',
    });
  }

  const baseCtx: ContentPromptContext = {
    platform,
    topic,
    brandVoice: brand_voice,
    brandTone: brand_tone,
  };

  try {
    let prompt: string;

    switch (content_type) {
      case 'caption':
        prompt = captionPrompt(baseCtx);
        break;
      case 'hook':
        prompt = hookPrompt({ ...baseCtx, count } as HookPromptContext);
        break;
      case 'thread':
        prompt = threadPrompt({ ...baseCtx, threadLength: thread_length } as ThreadPromptContext);
        break;
      case 'script':
        prompt = scriptPrompt({
          ...baseCtx,
          durationSeconds: duration_seconds,
        } as ScriptPromptContext);
        break;
      default:
        return JSON.stringify({ error: `Unsupported content type: ${content_type}` });
    }

    console.log(`[GenerateContent] Generated ${content_type} prompt for ${platform}: "${topic}"`);
    return JSON.stringify({
      success: true,
      content_type,
      platform,
      topic,
      prompt,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return JSON.stringify({ error: msg });
  }
}

function getSaveContentDefinition() {
  return {
    name: 'save_content',
    description:
      'Save discovered or generated content to the database for later use. Use for bookmarking interesting content or storing generated drafts.',
    input_schema: {
      type: 'object' as const,
      properties: {
        type: {
          type: 'string',
          description: 'Content type: discovered or generated',
        },
        platform: {
          type: 'string',
          description: 'Source platform',
        },
        title: {
          type: 'string',
          description: 'Content title',
        },
        body: {
          type: 'string',
          description: 'Content body/text',
        },
        source_url: {
          type: 'string',
          description: 'URL of the source content (for discovered)',
        },
        source_author: {
          type: 'string',
          description: 'Author of the source content (for discovered)',
        },
        content_type: {
          type: 'string',
          description: 'Subtype: caption, hook, thread, script, video, post (for generated)',
        },
        tags: {
          type: 'string',
          description: 'Comma-separated tags',
        },
      },
      required: ['type', 'platform', 'body'],
    },
  };
}

async function handleSaveContent(input: unknown): Promise<string> {
  if (!memoryManager) {
    return JSON.stringify({ error: 'Memory not initialized' });
  }

  const { type, platform, title, body, source_url, source_author, content_type, tags } = input as {
    type: string;
    platform: string;
    title?: string;
    body: string;
    source_url?: string;
    source_author?: string;
    content_type?: string;
    tags?: string;
  };

  if (!type || !platform || !body) {
    return JSON.stringify({ error: 'Missing required fields: type, platform, body' });
  }

  try {
    if (type === 'discovered') {
      const saved = memoryManager.discoveredContent.create({
        platform,
        content_type: content_type ?? 'post',
        title: title ?? null,
        body,
        source_url: source_url ?? null,
        source_author: source_author ?? null,
        tags: tags ?? null,
      });
      // Compute and persist viral score
      const scoringPlatforms: string[] = ['tiktok', 'youtube', 'instagram', 'twitter', 'linkedin'];
      if (scoringPlatforms.includes(platform)) {
        const breakdown = calculateViralScore(
          platform as ScoringPlatform,
          { likes: saved.likes, comments: saved.comments, shares: saved.shares, views: saved.views },
          saved.discovered_at
        );
        memoryManager.discoveredContent.updateViralScore(saved.id, breakdown.score, breakdown.tier);
        console.log(`[SaveContent] Saved discovered content: ${saved.id} (viral_score=${breakdown.score}, tier=${breakdown.tier})`);
        socialToolEvents.emit('content:saved', { contentType: 'discovered', id: saved.id, platform });
        return JSON.stringify({ success: true, id: saved.id, type: 'discovered', viral_score: breakdown.score, viral_tier: breakdown.tier });
      }

      console.log(`[SaveContent] Saved discovered content: ${saved.id}`);
      socialToolEvents.emit('content:saved', { contentType: 'discovered', id: saved.id, platform });
      return JSON.stringify({ success: true, id: saved.id, type: 'discovered' });
    } else if (type === 'generated') {
      const saved = memoryManager.generatedContent.create({
        content_type: (content_type ?? 'caption') as
          | 'caption'
          | 'hook'
          | 'thread'
          | 'script'
          | 'image_prompt'
          | 'image'
          | 'carousel'
          | 'story',
        platform,
        output: body,
        prompt_used: title ?? null,
      });
      console.log(`[SaveContent] Saved generated content: ${saved.id}`);
      socialToolEvents.emit('content:saved', { contentType: 'generated', id: saved.id, platform });
      return JSON.stringify({ success: true, id: saved.id, type: 'generated' });
    } else {
      return JSON.stringify({
        error: `Unknown content type: ${type}. Use "discovered" or "generated".`,
      });
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return JSON.stringify({ error: msg });
  }
}

function getReplyToCommentDefinition() {
  return {
    name: 'reply_to_comment',
    description:
      'Reply to a comment on social media. Fetches comments for a post and posts a reply. Supports X/Twitter and YouTube.',
    input_schema: {
      type: 'object' as const,
      properties: {
        platform: {
          type: 'string',
          description: 'Platform: youtube, x, tiktok, instagram, linkedin',
        },
        post_external_id: {
          type: 'string',
          description: 'External post/video ID to fetch comments from',
        },
        comment_id: {
          type: 'string',
          description: 'ID of the specific comment to reply to',
        },
        reply_text: {
          type: 'string',
          description: 'Reply text to post',
        },
        account_id: {
          type: 'string',
          description: 'Social account ID for credentials',
        },
      },
      required: ['platform', 'comment_id', 'reply_text', 'account_id'],
    },
  };
}

async function handleReplyToComment(input: unknown): Promise<string> {
  if (!memoryManager) {
    return JSON.stringify({ error: 'Memory not initialized' });
  }

  const { platform, comment_id, reply_text, account_id } = input as {
    platform: string;
    post_external_id?: string;
    comment_id: string;
    reply_text: string;
    account_id: string;
  };

  if (!platform || !comment_id || !reply_text || !account_id) {
    return JSON.stringify({
      error: 'Missing required fields: platform, comment_id, reply_text, account_id',
    });
  }

  const account = memoryManager.socialAccounts.getById(account_id);
  if (!account) {
    return JSON.stringify({ error: `Social account not found: ${account_id}` });
  }

  const credentials = buildCredentialsFromAccount(account);

  try {
    const result = await postReply({
      platform,
      comment: {
        externalId: comment_id,
        platform,
        text: '',
        authorUsername: '',
        likeCount: 0,
        replyCount: 0,
        publishedAt: new Date().toISOString(),
      },
      replyText: reply_text,
      credentials,
    });

    console.log(
      `[ReplyToComment] ${result.success ? 'Replied' : 'Failed'} on ${platform} to ${comment_id}`
    );

    // Log engagement
    if (result.success) {
      memoryManager.engagementLog.create({
        social_account_id: account_id,
        platform,
        action: 'reply',
        target_url: comment_id,
        content: reply_text,
        external_id: result.replyId ?? null,
        success: true,
      });
    }

    return JSON.stringify(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return JSON.stringify({ error: msg });
  }
}

function getFlagCommentDefinition() {
  return {
    name: 'flag_comment',
    description:
      'Flag a comment for review. Fetches comments for a post and prioritizes which ones need attention (questions, high engagement, negative sentiment).',
    input_schema: {
      type: 'object' as const,
      properties: {
        platform: {
          type: 'string',
          description: 'Platform: youtube, tiktok, reddit',
        },
        post_external_id: {
          type: 'string',
          description: 'External post/video ID',
        },
        post_url: {
          type: 'string',
          description: 'Post URL (needed for TikTok)',
        },
        limit: {
          type: 'number',
          description: 'Number of comments to fetch (default 20)',
        },
        min_likes: {
          type: 'number',
          description: 'Minimum likes to consider "high engagement" (default 5)',
        },
      },
      required: ['platform', 'post_external_id'],
    },
  };
}

async function handleFlagComment(input: unknown): Promise<string> {
  const { platform, post_external_id, post_url, limit, min_likes } = input as {
    platform: string;
    post_external_id: string;
    post_url?: string;
    limit?: number;
    min_likes?: number;
  };

  if (!platform || !post_external_id) {
    return JSON.stringify({ error: 'Missing required fields: platform, post_external_id' });
  }

  try {
    const result = await fetchComments({
      platform,
      externalPostId: post_external_id,
      postUrl: post_url,
      limit,
    });

    if (!result.success) {
      return JSON.stringify({ success: false, error: result.error });
    }

    const prioritized = prioritizeComments(result.comments, { minLikes: min_likes });

    console.log(
      `[FlagComment] Fetched ${result.comments.length} comments, prioritized ${prioritized.length} for ${platform}/${post_external_id}`
    );

    return JSON.stringify({
      success: true,
      total_comments: result.totalCount ?? result.comments.length,
      flagged_count: prioritized.length,
      flagged_comments: prioritized.slice(0, 10).map((c) => ({
        id: c.externalId,
        author: c.authorUsername,
        text: c.text,
        likes: c.likeCount,
        replies: c.replyCount,
        published_at: c.publishedAt,
      })),
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return JSON.stringify({ error: msg });
  }
}

// ── Image generation tools ──

function getGenerateImageDefinition() {
  return {
    name: 'generate_image',
    description:
      'Generate an image using Kie.ai. Supports text-to-image and image-to-image (with reference images). ' +
      'Submits the job and immediately returns a prediction ID. The image is polled in the background — ' +
      'when it completes, it is automatically saved to the gallery and a desktop notification is shown. ' +
      'There is no need to poll or wait.',
    input_schema: {
      type: 'object' as const,
      properties: {
        prompt: {
          type: 'string',
          description: 'Text prompt describing the image to generate',
        },
        model: {
          type: 'string',
          description:
            'Model to use. MUST be one of these exact IDs: "nano-banana-2" (fast text-to-image, accepts reference images via image_input), "google/nano-banana-edit" (image editing/image-to-image with nano banana), "seedream/5-lite-text-to-image" (high quality text-to-image), "seedream/5-lite-image-to-image" (high quality image-to-image). Shorthand aliases also work: "seedream" → seedream/5-lite-text-to-image, "banana" → nano-banana-2, "seedream-edit" → seedream/5-lite-image-to-image, "nano-banana-edit" → google/nano-banana-edit. Default: nano-banana-2',
        },
        aspect_ratio: {
          type: 'string',
          description: 'Aspect ratio: "1:1", "16:9", "9:16", "4:3", "3:4", "auto". Default: "1:1"',
        },
        quality: {
          type: 'string',
          description:
            'Quality level: "1K", "2K", "4K" for nano-banana-2; "basic", "high" for seedream models. Default: "1K" / "basic"',
        },
        reference_images: {
          type: 'string',
          description:
            'Comma-separated URLs of reference images (for image-to-image generation). Use upload_reference_image first to get URLs for local files.',
        },
        output_format: {
          type: 'string',
          description: 'Output format: "png" or "jpg" (nano-banana-2 only). Default: "jpg"',
        },
        platform: {
          type: 'string',
          description:
            'Target platform for saving to generated_content (e.g. "instagram", "tiktok")',
        },
      },
      required: ['prompt'],
    },
  };
}

async function handleGenerateImage(input: unknown): Promise<string> {
  const { prompt, model, aspect_ratio, quality, reference_images, output_format, platform } =
    input as {
      prompt: string;
      model?: string;
      aspect_ratio?: string;
      quality?: string;
      reference_images?: string;
      output_format?: string;
      platform?: string;
    };

  if (!prompt) {
    return JSON.stringify({ error: 'Missing required field: prompt' });
  }

  const apiKey = SettingsManager.get('kie.apiKey');
  if (!apiKey) {
    return JSON.stringify({
      error: 'Kie.ai API key not configured. Set it in Settings → API Keys.',
    });
  }

  const client = new KieClient(apiKey);
  let modelId;
  try {
    modelId = resolveModelId(model || 'nano-banana-2');
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
  }
  const refImages = reference_images ? reference_images.split(',').map((u) => u.trim()) : undefined;

  try {
    const { predictionId } = await client.generate({
      prompt,
      model: modelId,
      aspectRatio: aspect_ratio || '1:1',
      quality: quality || (modelId === 'nano-banana-2' ? '1K' : 'basic'),
      referenceImages: refImages,
      outputFormat: output_format,
    });

    console.log(`[GenerateImage] Task created: ${predictionId} (model=${modelId})`);

    // Hand off to the centralised image job tracker for background polling
    if (imageTracker) {
      console.log(`[GenerateImage] Handing off to ImageJobTracker for background polling`);
      imageTracker.track({
        predictionId,
        prompt,
        model: modelId,
        aspectRatio: aspect_ratio,
        quality,
        platform,
        sessionId: getCurrentSessionId(),
      });
    } else {
      console.error('[GenerateImage] imageTracker is NULL — background polling will NOT happen! Call setImageJobTracker() first.');
    }

    return JSON.stringify({
      success: true,
      prediction_id: predictionId,
      model: modelId,
      status: 'generating',
      message:
        'Image generation submitted! It will be saved to your gallery and you\'ll get a ' +
        'notification when it\'s ready. Seedream models typically take 1–3 minutes.',
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return JSON.stringify({ error: msg });
  }
}

function getUploadReferenceImageDefinition() {
  return {
    name: 'upload_reference_image',
    description:
      "Upload a local image file to Kie.ai's CDN so it can be used as a reference image for image-to-image generation. Returns a hosted URL that can be passed to generate_image's reference_images parameter.",
    input_schema: {
      type: 'object' as const,
      properties: {
        file_path: {
          type: 'string',
          description: 'Absolute path to the local image file to upload',
        },
      },
      required: ['file_path'],
    },
  };
}

async function handleUploadReferenceImage(input: unknown): Promise<string> {
  const { file_path } = input as { file_path: string };

  if (!file_path) {
    return JSON.stringify({ error: 'Missing required field: file_path' });
  }

  const apiKey = SettingsManager.get('kie.apiKey');
  if (!apiKey) {
    return JSON.stringify({
      error: 'Kie.ai API key not configured. Set it in Settings → API Keys.',
    });
  }

  const client = new KieClient(apiKey);

  try {
    const url = await client.uploadImage(file_path);
    console.log(`[UploadReferenceImage] Uploaded: ${file_path} → ${url}`);
    return JSON.stringify({ success: true, url, file_path });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return JSON.stringify({ error: msg });
  }
}

// ── Repurpose content tool ──

function getRepurposeContentDefinition() {
  return {
    name: 'repurpose_content',
    description:
      'Repurpose existing content for different platforms. Takes a source content ID (from discovered_content DB) or a raw URL, and generates platform-specific drafts. ' +
      'If the source is a video without a transcript, it will be transcribed automatically. ' +
      'Returns a structured prompt + source summary for the agent to use in its response.',
    input_schema: {
      type: 'object' as const,
      properties: {
        source_content_id: {
          type: 'string',
          description: 'ID from the discovered_content database',
        },
        source_url: {
          type: 'string',
          description: 'Alternative: raw URL to look up content by source_url',
        },
        target_platforms: {
          type: 'string',
          description:
            'Comma-separated target platforms: twitter, instagram, tiktok, linkedin, youtube',
        },
        tone: {
          type: 'string',
          description: 'Optional tone override (e.g. casual, professional, edgy)',
        },
        additional_instructions: {
          type: 'string',
          description: 'Optional extra instructions for the repurposing prompt',
        },
      },
      required: ['target_platforms'],
    },
  };
}

function resolveSourceContent(
  memory: MemoryManager,
  id?: string,
  url?: string
): import('../memory/discovered-content').DiscoveredContent | string {
  if (id) {
    const found = memory.discoveredContent.getById(id);
    if (!found) return JSON.stringify({ error: `Content not found: ${id}` });
    return found;
  }
  if (url) {
    const recent = memory.discoveredContent.getRecent(200);
    const found = recent.find((c) => c.source_url === url);
    if (!found)
      return JSON.stringify({
        error: `No content found for URL: ${url}. Use search_content or save_content first.`,
      });
    return found;
  }
  return JSON.stringify({ error: 'Provide either source_content_id or source_url' });
}

async function handleRepurposeContent(input: unknown): Promise<string> {
  if (!memoryManager) {
    return JSON.stringify({ error: 'Memory not initialized' });
  }

  const { source_content_id, source_url, target_platforms, tone, additional_instructions } =
    input as {
      source_content_id?: string;
      source_url?: string;
      target_platforms: string;
      tone?: string;
      additional_instructions?: string;
    };

  if (!target_platforms) {
    return JSON.stringify({ error: 'Missing required field: target_platforms' });
  }

  const platforms = target_platforms.split(',').map((p) => p.trim().toLowerCase());

  // Emit started event so the UI can show a placeholder
  socialToolEvents.emit('repurpose:started', { platforms, source_content_id, source_url });

  // Step 1: Resolve source content
  const content = resolveSourceContent(memoryManager, source_content_id, source_url);
  if (typeof content === 'string') {
    return content; // Error JSON
  }

  // Step 2: If video content without transcript, attempt transcription
  let transcript: string | undefined;
  const metadata = content.metadata ? JSON.parse(content.metadata) : {};

  if (metadata.transcript) {
    transcript = metadata.transcript;
  } else if (content.source_url) {
    // Detect video content by content_type OR by media_urls containing video files
    const mediaUrls: string[] = content.media_urls ? (() => { try { return JSON.parse(content.media_urls!) as string[]; } catch { return []; } })() : [];
    const videoTypes = ['video', 'reel', 'slideshow'];
    const isVideoType = videoTypes.includes((content.content_type ?? '').toLowerCase());
    const hasVideoUrl = mediaUrls.some((u) => /\.(mp4|webm|m3u8|mov)/i.test(u)) ||
      /tiktok\.com|youtube\.com|youtu\.be|instagram\.com\/reel/i.test(content.source_url);

    if (isVideoType || hasVideoUrl) {
      try {
        socialToolEvents.emit('repurpose:progress', { stage: 'Downloading video...' });

        // Download the video first — page URLs can't be passed directly to AssemblyAI
        let localPath: string | undefined;
        const cdnUrl = mediaUrls.find((u) => /\.(mp4|webm|m3u8|mov)/i.test(u)) ?? (isVideoType ? mediaUrls[0] : undefined);
        const videoDir = join(app.getPath('userData'), 'videos', 'repurpose');

        if (cdnUrl) {
          try {
            localPath = await downloadVideo(cdnUrl, videoDir);
          } catch {
            console.warn(`[RepurposeContent] CDN download failed, trying page URL`);
          }
        }
        if (!localPath) {
          localPath = await downloadVideo(content.source_url, videoDir);
        }

        socialToolEvents.emit('repurpose:progress', { stage: 'Transcribing video...' });
        const result = await transcribeContent(localPath);
        transcript = result.text;
        // Store transcript in metadata for future use
        metadata.transcript = transcript;
        memoryManager.discoveredContent.update(content.id, {
          metadata: JSON.stringify(metadata),
        });
        console.log(`[RepurposeContent] Transcribed video content: ${content.id}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[RepurposeContent] Transcription failed: ${msg}`);
        // Continue without transcript — not fatal
      }
    }
  }

  // Step 3: Build RepurposePromptContext
  const sourceText = content.body || content.title || '';
  const hasMedia = !!content.media_urls;

  const ctx: RepurposePromptContext = {
    platform: content.platform,
    topic: content.title || sourceText.slice(0, 100),
    sourceContent: sourceText,
    sourcePlatform: content.platform,
    sourceStats:
      content.likes || content.comments || content.shares || content.views
        ? {
            likes: content.likes,
            comments: content.comments,
            shares: content.shares,
            views: content.views,
          }
        : undefined,
    sourceTranscript: transcript,
    targetPlatforms: platforms,
    brandTone: tone,
    additionalInstructions: additional_instructions,
  };

  // Step 4: Handle image strategy for visual platforms
  const visualPlatforms = ['instagram', 'tiktok'];
  const targetsVisual = platforms.some((p) => visualPlatforms.includes(p));
  const needsVisual = targetsVisual && !hasMedia;

  // Parse source media URLs for reference
  let sourceMediaUrls: string[] = [];
  if (content.media_urls) {
    try {
      const parsed = JSON.parse(content.media_urls);
      sourceMediaUrls = Array.isArray(parsed) ? parsed : [content.media_urls];
    } catch {
      sourceMediaUrls = content.media_urls.split(',').map((u: string) => u.trim()).filter(Boolean);
    }
  }

  if (needsVisual) {
    ctx.additionalInstructions = [
      ctx.additionalInstructions || '',
      'The source content has no media. For visual platforms (Instagram, TikTok), include an IMAGE PROMPT section describing an image that should be generated to accompany the post. The agent can pass this prompt to the generate_image tool.',
    ]
      .filter(Boolean)
      .join('\n\n');
  } else if (targetsVisual && sourceMediaUrls.length > 0) {
    ctx.additionalInstructions = [
      ctx.additionalInstructions || '',
      `The source content has ${sourceMediaUrls.length} media file(s). For visual platforms, the agent should use the source images as reference_images with the generate_image tool (image-to-image) to create adapted visuals — or use the original URLs directly if they suit the target platform.`,
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  // Step 5: Generate prompt
  socialToolEvents.emit('repurpose:progress', { stage: 'Generating drafts...' });
  const prompt = repurposePrompt(ctx);

  console.log(
    `[RepurposeContent] Generated repurpose prompt for ${platforms.join(', ')} from ${content.platform} content: ${content.id}`
  );

  // Step 6: Persist draft social_posts for each target platform
  const drafts: Array<{ id: string; platform: string; content: string }> = [];
  for (const p of platforms) {
    const post = memoryManager.socialPosts.create({
      platform: p,
      status: 'draft',
      content: sourceText,
      source_content_id: String(content.id),
      metadata: JSON.stringify({ repurpose_source: content.platform, awaiting_refinement: true }),
    });
    drafts.push({ id: post.id, platform: p, content: sourceText });
  }

  // Step 7: Emit event for panel + chat comparison UI (include persisted drafts)
  socialToolEvents.emit('repurpose:completed', {
    source_content_id: content.id,
    platforms,
    source_platform: content.platform,
    source_title: content.title,
    source_body: sourceText.slice(0, 500),
    source_transcript: transcript?.slice(0, 500),
    source_stats: ctx.sourceStats,
    source_media_urls: sourceMediaUrls.length > 0 ? sourceMediaUrls : undefined,
    has_transcript: !!transcript,
    drafts,
  });

  // Step 8: Return prompt + source summary
  return JSON.stringify({
    success: true,
    source: {
      id: content.id,
      platform: content.platform,
      content_type: content.content_type,
      title: content.title,
      body_preview: sourceText.slice(0, 300),
      has_media: hasMedia,
      has_transcript: !!transcript,
      stats: ctx.sourceStats,
      media_urls: sourceMediaUrls.length > 0 ? sourceMediaUrls : undefined,
    },
    target_platforms: platforms,
    needs_image_generation: needsVisual,
    use_source_images_as_reference: targetsVisual && sourceMediaUrls.length > 0,
    draft_ids: Object.fromEntries(drafts.map((d) => [d.platform, d.id])),
    prompt,
  });
}

// ── Export all tools ──

/**
 * Get all social media tools
 */
function getAnalyzeTrendsDefinition() {
  return {
    name: 'analyze_trends',
    description:
      'Analyze trends from two sources: (1) real platform trending data via Apify (Twitter/TikTok), and (2) pattern detection on saved content library. Results are tagged with source: "platform" or "library".',
    input_schema: {
      type: 'object' as const,
      properties: {
        platform: {
          type: 'string',
          description:
            'Optional platform filter: youtube, tiktok, instagram, twitter, reddit. Omit for all platforms.',
        },
        min_score: {
          type: 'number',
          description: 'Minimum trend score threshold (0-100, default 40). Only applies to library trends.',
        },
      },
      required: [],
    },
  };
}

async function handleAnalyzeTrends(input: unknown): Promise<string> {
  const { platform, min_score } = (input ?? {}) as {
    platform?: string;
    min_score?: number;
  };

  if (!memoryManager) {
    return JSON.stringify({ error: 'Memory manager not initialized' });
  }

  try {
    const combined: Array<Record<string, unknown>> = [];

    // ── (1) Fetch real platform trends if Apify key is configured ──
    const apifyKey = SettingsManager.get('apify.apiKey') as string | undefined;
    if (apifyKey) {
      const platformTrends = await fetchPlatformTrends(platform);
      combined.push(...platformTrends);
    }

    // ── (2) Run library trend detection on saved content ──
    let items = memoryManager.discoveredContent.getRecent(100);
    if (platform) {
      items = items.filter((item) => item.platform === platform);
    }

    if (items.length >= 2) {
      let trends = detectTrends(items);

      const threshold = min_score ?? 40;
      if (threshold > 40) {
        trends = trends.filter((t) => t.score >= threshold);
      }

      const libraryTrends = trends.slice(0, 10).map((t) => ({
        source: 'library' as const,
        keywords: t.keywords,
        score: t.score,
        status: t.status,
        velocity: t.velocity,
        volume: t.volume,
        recency: t.recency,
        growth: t.growth,
        item_count: t.items.length,
        sample_content: t.items.slice(0, 3).map((item) => ({
          title: item.title,
          url: item.source_url,
          platform: item.platform,
          viral_score: item.viral_score,
        })),
      }));

      combined.push(...libraryTrends);

      // Persist library trends to the database
      for (const trend of libraryTrends) {
        memoryManager.trends.upsert({
          keyword: trend.keywords.join(', '),
          platform: platform ?? null,
          score: trend.score,
          status: trend.status === 'breakout' || trend.status === 'rising' || trend.status === 'emerging'
            ? trend.status
            : 'emerging',
          sample_content_ids: trend.sample_content.map((s) => s.url).filter((u): u is string => u != null),
        });
      }
    }

    // Emit event for chat cards
    socialToolEvents.emit('trending:results', combined);

    return JSON.stringify({ success: true, count: combined.length, trends: combined });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return JSON.stringify({ error: msg });
  }
}

/** Fetch real trending data from platform APIs via Apify. */
async function fetchPlatformTrends(
  platform?: string
): Promise<Array<Record<string, unknown>>> {
  const results: Array<Record<string, unknown>> = [];

  const shouldFetchTwitter = !platform || platform === 'twitter';
  const shouldFetchTikTok = !platform || platform === 'tiktok';

  // Twitter trends
  if (shouldFetchTwitter) {
    try {
      const twitterTrends: TwitterTrendResult[] = await getTwitterTrending();
      for (const t of twitterTrends) {
        results.push({
          source: 'platform',
          platform: 'twitter',
          keywords: [t.name],
          score: null,
          status: 'trending',
          rank: t.rank,
          tweet_volume: t.tweetVolume,
        });
      }
    } catch (err) {
      console.warn('[social-tools] Failed to fetch Twitter trends:', err instanceof Error ? err.message : err);
    }
  }

  // TikTok trends
  if (shouldFetchTikTok) {
    try {
      const tiktokTrends = await getTrendingTikTok(undefined, 20);
      for (const t of tiktokTrends) {
        results.push({
          source: 'platform',
          platform: 'tiktok',
          keywords: [t.title || t.creatorUsername || 'unknown'],
          score: null,
          status: 'trending',
          url: t.url,
          engagement: { views: t.views, likes: t.likes, comments: t.comments },
        });
      }
    } catch (err) {
      console.warn('[social-tools] Failed to fetch TikTok trends:', err instanceof Error ? err.message : err);
    }
  }

  return results;
}

// ── Upload Video Draft ──

function getUploadVideoDraftDefinition() {
  return {
    name: 'upload_video_draft',
    description:
      'Attach a local video file to an existing social media draft. Copies the video to app storage and links it to the draft.',
    input_schema: {
      type: 'object' as const,
      properties: {
        draft_id: {
          type: 'string',
          description: 'The ID of the draft to attach the video to',
        },
        file_path: {
          type: 'string',
          description: 'Absolute path to the video file on disk',
        },
      },
      required: ['draft_id', 'file_path'],
    },
  };
}

async function handleUploadVideoDraft(input: unknown): Promise<string> {
  if (!memoryManager) {
    return JSON.stringify({ error: 'Memory not initialized' });
  }

  const { draft_id, file_path } = input as { draft_id: string; file_path: string };

  if (!draft_id || !file_path) {
    return JSON.stringify({ error: 'Missing required fields: draft_id, file_path' });
  }

  const post = memoryManager.socialPosts.getById(draft_id);
  if (!post) return JSON.stringify({ error: 'Draft not found' });

  if (!existsSync(file_path)) {
    return JSON.stringify({ error: 'File not found' });
  }

  socialToolEvents.emit('video:uploadStarted', { draftId: draft_id, filePath: file_path });

  try {
    const ext = extname(file_path);
    const dateDir = new Date().toISOString().slice(0, 10);
    const videoDir = join(app.getPath('userData'), 'videos', dateDir);
    mkdirSync(videoDir, { recursive: true });

    const destName = `${randomUUID()}${ext}`;
    const destPath = join(videoDir, destName);
    copyFileSync(file_path, destPath);

    const updated = memoryManager.socialPosts.update(draft_id, { video_path: destPath });

    socialToolEvents.emit('video:uploadCompleted', {
      draftId: draft_id,
      videoPath: destPath,
      platform: post.platform,
    });

    return JSON.stringify({ success: true, data: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    socialToolEvents.emit('video:uploadCompleted', { draftId: draft_id, error: message });
    return JSON.stringify({ error: message });
  }
}

// ── Create From Video ──

function getCreateFromVideoDefinition() {
  return {
    name: 'create_from_video',
    description:
      'Full video-to-draft pipeline: copies the video to app storage, transcribes audio, generates platform-optimized copy/hashtags/captions via AI, and creates a ready-to-post draft. Shows progress in the chat.',
    input_schema: {
      type: 'object' as const,
      properties: {
        file_path: {
          type: 'string',
          description: 'Absolute path to the video file on disk',
        },
        platform: {
          type: 'string',
          description: 'Target platform: tiktok, instagram, x, linkedin, youtube',
        },
      },
      required: ['file_path', 'platform'],
    },
  };
}

async function handleCreateFromVideo(input: unknown): Promise<string> {
  if (!memoryManager) {
    return JSON.stringify({ error: 'Memory not initialized' });
  }

  const { file_path, platform } = input as { file_path: string; platform: string };

  if (!file_path || !platform) {
    return JSON.stringify({ error: 'Missing required fields: file_path, platform' });
  }

  if (!existsSync(file_path)) {
    return JSON.stringify({ error: 'File not found' });
  }

  socialToolEvents.emit('video:processing', {
    stage: 'Uploading video...',
    platform,
    filePath: file_path,
  });

  try {
    // 1. Copy video to app storage
    const ext = extname(file_path);
    const dateDir = new Date().toISOString().slice(0, 10);
    const videoDir = join(app.getPath('userData'), 'videos', dateDir);
    mkdirSync(videoDir, { recursive: true });

    const destName = `${randomUUID()}${ext}`;
    const destPath = join(videoDir, destName);
    copyFileSync(file_path, destPath);

    // 2. Transcribe
    socialToolEvents.emit('video:processing', {
      stage: 'Transcribing audio...',
      platform,
      filePath: file_path,
    });
    const transcription = await transcribeContent(destPath);

    // 3. Finalize — generate copy/hashtags/captions via Claude
    socialToolEvents.emit('video:processing', {
      stage: 'Generating copy...',
      platform,
      filePath: file_path,
    });
    const brand = memoryManager.brandConfig.getActive();
    const finalized = await finalizeDraft(transcription.text, platform, brand);

    // 4. Build content with hashtags
    const hashtagStr = finalized.hashtags.length
      ? '\n\n' + finalized.hashtags.map((h) => (h.startsWith('#') ? h : `#${h}`)).join(' ')
      : '';
    const content = finalized.copy + hashtagStr;

    // 5. Create draft
    const post = memoryManager.socialPosts.create({
      platform,
      status: 'draft',
      content,
      video_path: destPath,
      transcript: transcription.text,
      metadata: JSON.stringify({
        captions: finalized.captions,
        hashtags: finalized.hashtags,
        duration: transcription.duration,
        language: transcription.language,
      }),
    });

    socialToolEvents.emit('video:processing', {
      stage: 'Done!',
      platform,
      filePath: file_path,
      draftId: post.id,
    });

    // Notify UI about the new draft
    socialToolEvents.emit('post:published', {
      action: 'created',
      postId: post.id,
      platform,
    });

    return JSON.stringify({ success: true, data: post });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    socialToolEvents.emit('video:processing', {
      stage: `Error: ${message}`,
      platform,
      filePath: file_path,
      error: true,
    });
    return JSON.stringify({ error: message });
  }
}

export function getSocialTools() {
  return [
    {
      ...getSearchContentDefinition(),
      handler: handleSearchContent,
    },
    {
      ...getScrapeProfileDefinition(),
      handler: handleScrapeProfile,
    },
    {
      ...getGetTrendingDefinition(),
      handler: handleGetTrending,
    },
    {
      ...getDownloadVideoDefinition(),
      handler: handleDownloadVideo,
    },
    {
      ...getPostContentDefinition(),
      handler: handlePostContent,
    },
    {
      ...getSchedulePostDefinition(),
      handler: handleSchedulePost,
    },
    {
      ...getListSocialAccountsDefinition(),
      handler: handleListSocialAccounts,
    },
    {
      ...getListSocialPostsDefinition(),
      handler: handleListSocialPosts,
    },
    {
      ...getProcessVideoDefinition(),
      handler: handleProcessVideo,
    },
    {
      ...getTranscribeVideoDefinition(),
      handler: handleTranscribeVideo,
    },
    {
      ...getGenerateContentDefinition(),
      handler: handleGenerateContent,
    },
    {
      ...getSaveContentDefinition(),
      handler: handleSaveContent,
    },
    {
      ...getReplyToCommentDefinition(),
      handler: handleReplyToComment,
    },
    {
      ...getFlagCommentDefinition(),
      handler: handleFlagComment,
    },
    {
      ...getGenerateImageDefinition(),
      handler: handleGenerateImage,
    },
    {
      ...getUploadReferenceImageDefinition(),
      handler: handleUploadReferenceImage,
    },
    {
      ...getRepurposeContentDefinition(),
      handler: handleRepurposeContent,
    },
    {
      ...getAnalyzeTrendsDefinition(),
      handler: handleAnalyzeTrends,
    },
    {
      ...getUploadVideoDraftDefinition(),
      handler: handleUploadVideoDraft,
    },
    {
      ...getCreateFromVideoDefinition(),
      handler: handleCreateFromVideo,
    },
  ];
}
