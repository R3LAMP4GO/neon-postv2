/**
 * Social Scheduler Jobs
 *
 * Two recurring jobs that integrate with the existing CronScheduler:
 *
 * 1. **Post Scheduler** — runs every minute, queries social_posts where
 *    status='scheduled' AND scheduled_at <= now, executes posting via the
 *    posting API layer, and updates status to 'posted' or 'failed'.
 *
 * 2. **Engagement Sweep** — runs every 15 minutes (configurable), fetches
 *    new comments on recent posts via the engagement monitor, and logs
 *    them to engagement_log.
 */

import { MemoryManager } from '../memory';
import { SettingsManager } from '../settings';
import { postContent, buildCredentialsFromAccount } from '../social/posting';
import { Platform } from '../social/posting/types';
import type { PlatformPostOptions } from '../social/posting/types';
import type { SocialPost } from '../memory/social-posts';
import { fetchCommentsForPosts } from '../social/engagement/monitor';
import type { FetchCommentsOptions } from '../social/engagement/monitor';

const LOG_PREFIX = '[social-scheduler]';

/** Default engagement sweep interval in milliseconds (15 minutes). */
const DEFAULT_SWEEP_INTERVAL_MS = 15 * 60 * 1000;

/** How far back to look for recent posts when sweeping engagement (7 days). */
const RECENT_POSTS_DAYS = 7;

// ── Post Scheduler ──

/**
 * Process all social posts that are due for publishing.
 *
 * Queries `social_posts` where status = 'scheduled' and `scheduled_at <= now`,
 * posts each via the unified posting router, and updates status to 'posted'
 * or 'failed'.
 *
 * Designed to be called on a ~1 minute interval by the scheduler.
 */
export async function runPostScheduler(memory: MemoryManager): Promise<number> {
  const duePosts = memory.socialPosts.getDueForPosting();

  if (duePosts.length === 0) {
    return 0;
  }

  console.log(`${LOG_PREFIX} Found ${duePosts.length} post(s) due for publishing`);

  let successCount = 0;

  for (const post of duePosts) {
    try {
      // Mark as "posting" to prevent duplicate processing
      memory.socialPosts.update(post.id, { status: 'posting' });

      // Look up credentials from the linked social account
      const credentials = resolveCredentials(memory, post);

      const platform = post.platform as Platform;

      // Parse media_urls if present
      const mediaFiles = post.media_urls ? parseJsonArray(post.media_urls) : undefined;

      // Parse metadata JSON to extract privacy, tags, and platform-specific options
      const meta = parseMetadata(post.metadata);

      // Cast required because PlatformPostOptions is a discriminated union keyed
      // on literal Platform values; at runtime the platform string is validated
      // inside postContent's switch statement.
      const result = await postContent({
        platform,
        text: post.content,
        mediaFiles,
        credentials,
        ...meta,
      } as PlatformPostOptions);

      if (result.success) {
        memory.socialPosts.update(post.id, {
          status: 'posted',
          posted_at: new Date().toISOString(),
          external_post_id: result.postId ?? null,
          external_url: result.url ?? null,
          error: null,
        });
        console.log(
          `${LOG_PREFIX} Posted successfully: ${post.id} → ${result.postId ?? '(no id)'}`
        );
        successCount++;
      } else {
        memory.socialPosts.update(post.id, {
          status: 'failed',
          error: result.error ?? 'Unknown posting error',
        });
        console.error(`${LOG_PREFIX} Post failed: ${post.id} — ${result.error}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      memory.socialPosts.update(post.id, {
        status: 'failed',
        error: msg,
      });
      console.error(`${LOG_PREFIX} Post exception: ${post.id} — ${msg}`);
    }
  }

  console.log(
    `${LOG_PREFIX} Post scheduler complete: ${successCount}/${duePosts.length} succeeded`
  );
  return successCount;
}

// ── Engagement Sweep ──

/**
 * Sweep recent posts for new comments and log them to engagement_log.
 *
 * Fetches comments for all posts with status = 'posted' that were posted
 * within the last `RECENT_POSTS_DAYS`. New comments (not already in
 * engagement_log) are inserted.
 *
 * Designed to be called on a ~15 minute interval by the scheduler.
 */
export async function runEngagementSweep(memory: MemoryManager): Promise<number> {
  const recentPosts = getRecentPostedPosts(memory);

  if (recentPosts.length === 0) {
    return 0;
  }

  console.log(`${LOG_PREFIX} Sweeping engagement for ${recentPosts.length} recent post(s)`);

  // Build fetch options for each post that has an external ID
  const fetchOptions: FetchCommentsOptions[] = [];
  const postMap = new Map<string, SocialPost>();

  for (const post of recentPosts) {
    if (!post.external_post_id) continue;

    fetchOptions.push({
      platform: post.platform,
      externalPostId: post.external_post_id,
      postUrl: post.external_url ?? undefined,
      limit: 50,
    });
    postMap.set(post.external_post_id, post);
  }

  if (fetchOptions.length === 0) {
    console.log(`${LOG_PREFIX} No posts with external IDs to sweep`);
    return 0;
  }

  const resultsMap = await fetchCommentsForPosts(fetchOptions);

  let newCommentCount = 0;

  for (const [externalPostId, result] of resultsMap) {
    if (!result.success || result.comments.length === 0) continue;

    const post = postMap.get(externalPostId);
    if (!post) continue;

    // Get existing engagement logs for this post to avoid duplicates
    const existingLogs = memory.engagementLog.getByPost(post.id);
    const existingExternalIds = new Set(existingLogs.map((l) => l.external_id).filter(Boolean));

    for (const comment of result.comments) {
      // Skip if we've already logged this comment
      if (existingExternalIds.has(comment.externalId)) continue;

      memory.engagementLog.create({
        social_account_id: post.social_account_id,
        social_post_id: post.id,
        platform: post.platform,
        action: 'reply',
        target_user: comment.authorUsername,
        target_url: comment.postUrl ?? null,
        content: comment.text,
        external_id: comment.externalId,
        success: true,
        metadata: JSON.stringify({
          likeCount: comment.likeCount,
          replyCount: comment.replyCount,
          publishedAt: comment.publishedAt,
          authorId: comment.authorId,
        }),
      });
      newCommentCount++;
    }

    // Update the post's comment count if the platform reported a total
    if (result.totalCount !== undefined) {
      memory.socialPosts.update(post.id, {
        comments: result.totalCount,
      });
    }
  }

  console.log(`${LOG_PREFIX} Engagement sweep complete: ${newCommentCount} new comment(s) logged`);
  return newCommentCount;
}

// ── Registration ──

/**
 * Get the configured engagement sweep interval in milliseconds.
 *
 * Reads `social.engagementSweepMinutes` from settings, falling back
 * to 15 minutes.
 */
export function getEngagementSweepIntervalMs(): number {
  const minutes = SettingsManager.getNumber('social.engagementSweepMinutes');
  return minutes > 0 ? minutes * 60 * 1000 : DEFAULT_SWEEP_INTERVAL_MS;
}

/**
 * Register the social scheduler jobs.
 *
 * Sets up two recurring intervals:
 * - Post scheduler: every 60 seconds
 * - Engagement sweep: every 15 minutes (configurable)
 *
 * Returns a cleanup function that clears the intervals.
 */
export function registerSocialSchedulerJobs(memory: MemoryManager): () => void {
  // Post scheduler — every 60 seconds
  const postInterval = setInterval(() => {
    runPostScheduler(memory).catch((err) => {
      console.error(`${LOG_PREFIX} Post scheduler error:`, err);
    });
  }, 60_000);

  // Engagement sweep — configurable interval (default 15 min)
  const sweepIntervalMs = getEngagementSweepIntervalMs();
  const sweepInterval = setInterval(() => {
    runEngagementSweep(memory).catch((err) => {
      console.error(`${LOG_PREFIX} Engagement sweep error:`, err);
    });
  }, sweepIntervalMs);

  console.log(
    `${LOG_PREFIX} Registered social scheduler jobs ` +
      `(post: 60s, engagement: ${Math.round(sweepIntervalMs / 60_000)}min)`
  );

  // Run both immediately on registration
  runPostScheduler(memory).catch((err) => {
    console.error(`${LOG_PREFIX} Initial post scheduler error:`, err);
  });
  runEngagementSweep(memory).catch((err) => {
    console.error(`${LOG_PREFIX} Initial engagement sweep error:`, err);
  });

  return () => {
    clearInterval(postInterval);
    clearInterval(sweepInterval);
    console.log(`${LOG_PREFIX} Social scheduler jobs stopped`);
  };
}

// ── Helpers ──

/**
 * Resolve platform credentials for a social post.
 *
 * Looks up the linked social_account and builds a PlatformCredentials
 * object. Falls back to empty credentials if no account is linked.
 */
function resolveCredentials(
  memory: MemoryManager,
  post: SocialPost
): ReturnType<typeof buildCredentialsFromAccount> {
  if (post.social_account_id) {
    const account = memory.socialAccounts.getById(post.social_account_id);
    if (account) {
      return buildCredentialsFromAccount(account);
    }
  }

  // No account linked — return empty credentials (posting will likely fail
  // but the error will be captured and saved to the post)
  return buildCredentialsFromAccount({
    access_token: null,
    refresh_token: null,
    metadata: null,
  });
}

/**
 * Get posts with status 'posted' from the last N days.
 */
function getRecentPostedPosts(memory: MemoryManager): SocialPost[] {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RECENT_POSTS_DAYS);
  const cutoffIso = cutoff.toISOString();

  return memory.socialPosts
    .getByStatus('posted')
    .filter((p) => (p.posted_at ?? p.created_at) >= cutoffIso);
}

/**
 * Parse post metadata JSON and extract fields that postContent() accepts:
 * privacy, tags, and any platform-specific options (e.g. disableComments,
 * title, postType, quoteTweetId, authorUrn, etc.).
 *
 * Returns a partial options object to spread into the postContent() call.
 */
function parseMetadata(json: string | null): Record<string, unknown> {
  if (!json) return {};
  try {
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Safely parse a JSON string as a string array, returning undefined on failure.
 */
function parseJsonArray(json: string): string[] | undefined {
  try {
    const parsed: unknown = JSON.parse(json);
    if (Array.isArray(parsed) && parsed.every((v) => typeof v === 'string')) {
      return parsed as string[];
    }
  } catch {
    // Invalid JSON — ignore
  }
  return undefined;
}
