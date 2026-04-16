/**
 * Social Posting - Unified Router
 *
 * Dispatches content to the correct platform posting module based
 * on the platform field. Retrieves credentials from the social
 * accounts store in MemoryManager.
 */

export { Platform, type PostResult, type TokenResult, type PlatformCredentials } from './types';
export type {
  BasePostOptions,
  TikTokPostOptions,
  YouTubePostOptions,
  InstagramPostOptions,
  XPostOptions,
  LinkedInPostOptions,
  PlatformPostOptions,
  PostPrivacy,
} from './types';

export { postToTikTok } from './tiktok';
export { postToYouTube } from './youtube';
export { postToInstagram } from './instagram';
export { postToX } from './x';
export { postToLinkedIn } from './linkedin';

import { Platform } from './types';
import type { PlatformPostOptions, PostResult, PlatformCredentials } from './types';
import { postToTikTok } from './tiktok';
import { postToYouTube } from './youtube';
import { postToInstagram } from './instagram';
import { postToX } from './x';
import { postToLinkedIn } from './linkedin';

/**
 * Post content to any supported platform.
 *
 * Dispatches to the platform-specific module based on `options.platform`.
 *
 * @example
 * ```ts
 * const result = await postContent({
 *   platform: Platform.X,
 *   text: 'Hello from neon-post!',
 *   credentials: { accessToken: '...', consumerKey: '...', ... },
 * });
 * ```
 */
export async function postContent(options: PlatformPostOptions): Promise<PostResult> {
  const { platform, credentials, ...rest } = options;

  switch (platform) {
    case Platform.TIKTOK:
      return postToTikTok(rest as Parameters<typeof postToTikTok>[0], credentials);

    case Platform.YOUTUBE:
      return postToYouTube(rest as Parameters<typeof postToYouTube>[0], credentials);

    case Platform.INSTAGRAM:
      return postToInstagram(rest as Parameters<typeof postToInstagram>[0], credentials);

    case Platform.X:
      return postToX(rest as Parameters<typeof postToX>[0], credentials);

    case Platform.LINKEDIN:
      return postToLinkedIn(rest as Parameters<typeof postToLinkedIn>[0], credentials);

    default: {
      const exhaustive: never = platform;
      return {
        success: false,
        error: `Unsupported platform: ${exhaustive as string}`,
        platform: platform as Platform,
      };
    }
  }
}

/**
 * Post content to multiple platforms in parallel.
 *
 * Returns an array of results, one per platform, in the same order
 * as the input. Failures on one platform do not prevent others from
 * posting.
 */
export async function postToMultiplePlatforms(posts: PlatformPostOptions[]): Promise<PostResult[]> {
  return Promise.all(posts.map((opts) => postContent(opts)));
}

/**
 * Build a PlatformCredentials object from a social account record.
 *
 * Convenience helper that maps the flat social_accounts fields
 * to the PlatformCredentials interface. The `metadata` JSON field
 * is parsed to extract platform-specific secrets (e.g. OAuth 1.0a
 * consumer keys for X).
 */
export function buildCredentialsFromAccount(account: {
  access_token: string | null;
  refresh_token: string | null;
  metadata: string | null;
}): PlatformCredentials {
  const creds: PlatformCredentials = {
    accessToken: account.access_token ?? '',
    refreshToken: account.refresh_token ?? undefined,
  };

  // Parse metadata for platform-specific fields
  if (account.metadata) {
    try {
      const meta = JSON.parse(account.metadata) as Record<string, string>;
      if (meta.consumerKey) creds.consumerKey = meta.consumerKey;
      if (meta.consumerSecret) creds.consumerSecret = meta.consumerSecret;
      if (meta.accessTokenSecret) creds.accessTokenSecret = meta.accessTokenSecret;
      if (meta.clientId) creds.clientId = meta.clientId;
      if (meta.clientSecret) creds.clientSecret = meta.clientSecret;
      if (meta.pageId) creds.pageId = meta.pageId;
      if (meta.instagramAccountId) creds.instagramAccountId = meta.instagramAccountId;
    } catch {
      // Invalid JSON in metadata — ignore
    }
  }

  return creds;
}
