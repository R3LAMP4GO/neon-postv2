/**
 * Engagement Monitor
 *
 * Fetches comments and engagement metrics for posts across platforms.
 * Uses existing scraping infrastructure (pocket-cli, RapidAPI) to pull
 * comments for posts tracked in the social_posts table.
 */

import { Platform } from '../posting/types';
import { SettingsManager } from '../../settings';
import { getYouTubeComments, getTikTokComments, getRedditComments } from '../scraping';
import type { YouTubeComment, RedditComment } from '../scraping';

// ── Types ──

/** A normalized comment from any platform */
export interface PlatformComment {
  /** Platform-specific comment ID */
  externalId: string;
  /** The platform this comment came from */
  platform: Platform | string;
  /** Comment text content */
  text: string;
  /** Author username / display name */
  authorUsername: string;
  /** Author's platform-specific ID (if available) */
  authorId?: string;
  /** Number of likes / up-votes on the comment */
  likeCount: number;
  /** Number of replies to this comment */
  replyCount: number;
  /** ISO-8601 timestamp when the comment was posted */
  publishedAt: string;
  /** URL of the parent post this comment belongs to */
  postUrl?: string;
  /** Platform-specific post / video ID */
  postExternalId?: string;
}

/** Options for fetching comments on a specific post */
export interface FetchCommentsOptions {
  /** The platform to fetch comments from */
  platform: Platform | string;
  /** The platform-specific post / video ID */
  externalPostId: string;
  /** Post URL (used for TikTok comment fetching) */
  postUrl?: string;
  /** Maximum number of comments to retrieve */
  limit?: number;
}

/** Result of a comment fetch operation */
export interface FetchCommentsResult {
  /** Whether the fetch succeeded */
  success: boolean;
  /** Normalized comments from the platform */
  comments: PlatformComment[];
  /** Total comment count reported by the platform (may exceed returned comments) */
  totalCount?: number;
  /** Human-readable error if the fetch failed */
  error?: string;
}

// ── Helpers ──

const LOG_PREFIX = '[engagement-monitor]';

function normalizeYouTubeComment(comment: YouTubeComment, postExternalId: string): PlatformComment {
  return {
    externalId: comment.id,
    platform: Platform.YOUTUBE,
    text: comment.text,
    authorUsername: comment.authorName,
    authorId: comment.authorChannelId,
    likeCount: comment.likeCount,
    replyCount: comment.replyCount,
    publishedAt: comment.publishedAt,
    postExternalId,
  };
}

function normalizeRedditComment(comment: RedditComment, postExternalId: string): PlatformComment {
  return {
    externalId: comment.id,
    platform: 'reddit',
    text: comment.body,
    authorUsername: comment.author,
    likeCount: Math.max(comment.score, 0),
    replyCount: 0, // Reddit doesn't expose reply count directly
    publishedAt: new Date(comment.createdUtc * 1000).toISOString(),
    postExternalId,
  };
}

// ── Public API ──

/**
 * Fetch comments for a post on a specific platform.
 *
 * Routes to the correct scraping backend and normalizes results
 * into a common `PlatformComment` shape.
 */
export async function fetchComments(options: FetchCommentsOptions): Promise<FetchCommentsResult> {
  const { platform, externalPostId, postUrl, limit = 20 } = options;

  console.log(
    `${LOG_PREFIX} fetchComments: platform=${platform} id=${externalPostId} limit=${limit}`
  );

  try {
    switch (platform) {
      case Platform.YOUTUBE:
      case 'youtube': {
        const ytComments = await getYouTubeComments(externalPostId, limit);
        return {
          success: true,
          comments: ytComments.map((c) => normalizeYouTubeComment(c, externalPostId)),
          totalCount: ytComments.length,
        };
      }

      case Platform.TIKTOK:
      case 'tiktok': {
        const rapidApiKey = SettingsManager.get('rapidapi.apiKey');
        if (!rapidApiKey) {
          return {
            success: false,
            comments: [],
            error:
              'RapidAPI key not configured. Add your RapidAPI key in Settings to fetch TikTok comments.',
          };
        }
        const videoUrl = postUrl ?? `https://www.tiktok.com/@user/video/${externalPostId}`;
        const ttData = await getTikTokComments({ videoUrl, count: limit }, rapidApiKey);
        const comments: PlatformComment[] = (ttData.comments ?? []).map((c) => ({
          externalId: c.cid,
          platform: Platform.TIKTOK,
          text: c.text,
          authorUsername: c.user.unique_id || c.user.nickname,
          authorId: c.user.uid,
          likeCount: c.digg_count,
          replyCount: c.reply_comment_total,
          publishedAt: new Date(c.create_time * 1000).toISOString(),
          postUrl: videoUrl,
          postExternalId: externalPostId,
        }));
        return {
          success: true,
          comments,
          totalCount: ttData.total ?? comments.length,
        };
      }

      case 'reddit': {
        const redditComments = await getRedditComments(externalPostId);
        const limited = redditComments.slice(0, limit);
        return {
          success: true,
          comments: limited.map((c) => normalizeRedditComment(c, externalPostId)),
          totalCount: redditComments.length,
        };
      }

      case Platform.INSTAGRAM:
      case 'instagram':
        // Instagram comments require Graph API access — not yet supported in scraping layer
        return {
          success: false,
          comments: [],
          error:
            'Instagram comment fetching is not yet supported. Use the Instagram Graph API directly.',
        };

      case Platform.X:
      case 'x':
      case 'twitter':
        // X/Twitter comments (replies) require authenticated API access
        return {
          success: false,
          comments: [],
          error:
            'X/Twitter reply fetching is not yet supported via scraping. Use the X API v2 search endpoint.',
        };

      case Platform.LINKEDIN:
      case 'linkedin':
        return {
          success: false,
          comments: [],
          error: 'LinkedIn comment fetching is not yet supported.',
        };

      default:
        return {
          success: false,
          comments: [],
          error: `Unsupported platform for comment fetching: ${platform}`,
        };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${LOG_PREFIX} fetchComments failed: ${msg}`);
    return {
      success: false,
      comments: [],
      error: msg,
    };
  }
}

/**
 * Fetch comments for multiple posts in parallel.
 *
 * Returns a map of externalPostId → FetchCommentsResult.
 */
export async function fetchCommentsForPosts(
  posts: FetchCommentsOptions[]
): Promise<Map<string, FetchCommentsResult>> {
  const results = new Map<string, FetchCommentsResult>();
  const settled = await Promise.allSettled(
    posts.map(async (post) => {
      const result = await fetchComments(post);
      return { id: post.externalPostId, result };
    })
  );

  for (const outcome of settled) {
    if (outcome.status === 'fulfilled') {
      results.set(outcome.value.id, outcome.value.result);
    } else {
      // Should not happen since fetchComments catches internally,
      // but handle for safety
      console.error(`${LOG_PREFIX} Unexpected rejection:`, outcome.reason);
    }
  }

  return results;
}

/**
 * Filter comments that may warrant a reply.
 *
 * Heuristic: comments with questions, high engagement, or direct mentions
 * are prioritized. Returns comments sorted by relevance score (descending).
 */
export function prioritizeComments(
  comments: PlatformComment[],
  options?: {
    /** Minimum like count to consider "high engagement" */
    minLikes?: number;
    /** Keywords that signal a question or important comment */
    keywords?: string[];
  }
): PlatformComment[] {
  const minLikes = options?.minLikes ?? 5;
  const keywords = options?.keywords ?? [
    '?',
    'how',
    'why',
    'what',
    'when',
    'where',
    'help',
    'please',
  ];

  const scored = comments.map((comment) => {
    let score = 0;
    const textLower = comment.text.toLowerCase();

    // Questions are high priority
    if (textLower.includes('?')) score += 10;

    // Keyword matches
    for (const kw of keywords) {
      if (textLower.includes(kw.toLowerCase())) {
        score += 2;
      }
    }

    // High-engagement comments
    if (comment.likeCount >= minLikes) score += 5;

    // Comments with replies might already be addressed
    if (comment.replyCount > 0) score -= 2;

    // Longer comments tend to be more substantive
    if (comment.text.length > 100) score += 3;
    if (comment.text.length > 250) score += 2;

    return { comment, score };
  });

  return scored.sort((a, b) => b.score - a.score).map((s) => s.comment);
}
