/**
 * Engagement Reply
 *
 * Posts replies to comments on social media platforms.
 * Uses the posting infrastructure (API credentials) to send replies
 * and logs each action via the engagement log store.
 */

import { Platform } from '../posting/types';
import type { PlatformCredentials, PostResult } from '../posting/types';
import type { PlatformComment } from './monitor';

// ── Types ──

/** Options for replying to a comment */
export interface ReplyOptions {
  /** The platform to reply on */
  platform: Platform | string;
  /** The comment being replied to */
  comment: PlatformComment;
  /** The reply text to post */
  replyText: string;
  /** Platform credentials for authentication */
  credentials: PlatformCredentials;
  /** Optional: the external post/video ID the comment belongs to */
  postExternalId?: string;
}

/** Result of a reply attempt */
export interface ReplyResult {
  /** Whether the reply was successfully posted */
  success: boolean;
  /** Platform-specific reply/comment ID */
  replyId?: string;
  /** The platform this reply was sent to */
  platform: Platform | string;
  /** The comment that was replied to */
  commentId: string;
  /** Human-readable error on failure */
  error?: string;
}

// ── Constants ──

const LOG_PREFIX = '[engagement-reply]';
const X_API_BASE = 'https://api.x.com/2';
const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';

// ── Platform-specific reply implementations ──

/**
 * Reply to a tweet on X/Twitter using API v2.
 * Uses the existing posting infrastructure's OAuth 1.0a signing.
 */
async function replyOnX(
  commentId: string,
  replyText: string,
  credentials: PlatformCredentials
): Promise<ReplyResult> {
  const { accessToken } = credentials;

  if (!accessToken) {
    return {
      success: false,
      platform: Platform.X,
      commentId,
      error: 'Missing X/Twitter access token',
    };
  }

  try {
    const url = `${X_API_BASE}/tweets`;
    const body = {
      text: replyText.slice(0, 280),
      reply: { in_reply_to_tweet_id: commentId },
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errData = (await response.json()) as { detail?: string };
      return {
        success: false,
        platform: Platform.X,
        commentId,
        error: errData.detail ?? `HTTP ${response.status}`,
      };
    }

    const data = (await response.json()) as { data: { id: string } };
    return {
      success: true,
      replyId: data.data.id,
      platform: Platform.X,
      commentId,
    };
  } catch (err) {
    return {
      success: false,
      platform: Platform.X,
      commentId,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Reply to a YouTube comment using the YouTube Data API v3.
 */
async function replyOnYouTube(
  commentId: string,
  replyText: string,
  credentials: PlatformCredentials
): Promise<ReplyResult> {
  const { accessToken } = credentials;

  if (!accessToken) {
    return {
      success: false,
      platform: Platform.YOUTUBE,
      commentId,
      error: 'Missing YouTube access token',
    };
  }

  try {
    const url = `${YOUTUBE_API_BASE}/comments?part=snippet`;
    const body = {
      snippet: {
        parentId: commentId,
        textOriginal: replyText,
      },
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errData = (await response.json()) as {
        error?: { message?: string };
      };
      return {
        success: false,
        platform: Platform.YOUTUBE,
        commentId,
        error: errData.error?.message ?? `HTTP ${response.status}`,
      };
    }

    const data = (await response.json()) as { id: string };
    return {
      success: true,
      replyId: data.id,
      platform: Platform.YOUTUBE,
      commentId,
    };
  } catch (err) {
    return {
      success: false,
      platform: Platform.YOUTUBE,
      commentId,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ── Public API ──

/**
 * Post a reply to a comment on any supported platform.
 *
 * Currently supports X/Twitter and YouTube. Instagram and TikTok
 * reply APIs require additional integration work.
 */
export async function postReply(options: ReplyOptions): Promise<ReplyResult> {
  const { platform, comment, replyText, credentials } = options;

  console.log(`${LOG_PREFIX} postReply: platform=${platform} commentId=${comment.externalId}`);

  if (!replyText.trim()) {
    return {
      success: false,
      platform,
      commentId: comment.externalId,
      error: 'Reply text cannot be empty',
    };
  }

  switch (platform) {
    case Platform.X:
    case 'x':
    case 'twitter':
      return replyOnX(comment.externalId, replyText, credentials);

    case Platform.YOUTUBE:
    case 'youtube':
      return replyOnYouTube(comment.externalId, replyText, credentials);

    case Platform.TIKTOK:
    case 'tiktok':
      return {
        success: false,
        platform,
        commentId: comment.externalId,
        error: 'TikTok comment reply is not yet supported via API. Use the TikTok app directly.',
      };

    case Platform.INSTAGRAM:
    case 'instagram':
      return {
        success: false,
        platform,
        commentId: comment.externalId,
        error: 'Instagram comment reply requires Graph API integration. Not yet implemented.',
      };

    case Platform.LINKEDIN:
    case 'linkedin':
      return {
        success: false,
        platform,
        commentId: comment.externalId,
        error: 'LinkedIn comment reply is not yet supported.',
      };

    default:
      return {
        success: false,
        platform,
        commentId: comment.externalId,
        error: `Unsupported platform for replies: ${platform}`,
      };
  }
}

/**
 * Post replies to multiple comments in sequence.
 *
 * Uses sequential execution to respect API rate limits.
 * Returns an array of results in the same order as input.
 */
export async function postReplies(replies: ReplyOptions[]): Promise<ReplyResult[]> {
  const results: ReplyResult[] = [];

  for (const reply of replies) {
    const result = await postReply(reply);
    results.push(result);

    // Small delay between replies to avoid rate limiting
    if (results.length < replies.length) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  return results;
}

/**
 * Build a reply from a PostResult for logging purposes.
 *
 * Convenience helper that converts a ReplyResult into the shape
 * expected by the engagement log store.
 */
export function buildEngagementLogEntry(
  result: ReplyResult,
  replyText: string,
  targetUser?: string,
  targetUrl?: string
): {
  platform: string;
  action: 'reply';
  target_user: string | null;
  target_url: string | null;
  content: string;
  external_id: string | null;
  success: boolean;
  error: string | null;
} {
  return {
    platform: typeof result.platform === 'string' ? result.platform : result.platform,
    action: 'reply' as const,
    target_user: targetUser ?? null,
    target_url: targetUrl ?? null,
    content: replyText,
    external_id: result.replyId ?? null,
    success: result.success,
    error: result.error ?? null,
  };
}

/**
 * Utility type guard to convert PostResult to ReplyResult shape
 */
export function postResultToReplyResult(postResult: PostResult, commentId: string): ReplyResult {
  return {
    success: postResult.success,
    replyId: postResult.postId,
    platform: postResult.platform,
    commentId,
    error: postResult.error,
  };
}
