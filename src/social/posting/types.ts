/**
 * Social Posting Types
 *
 * Shared types for cross-platform social media posting.
 */

/** Supported social media platforms */
export enum Platform {
  TIKTOK = 'tiktok',
  YOUTUBE = 'youtube',
  INSTAGRAM = 'instagram',
  X = 'x',
  LINKEDIN = 'linkedin',
}

/** Privacy / visibility level for a post */
export type PostPrivacy = 'public' | 'private' | 'unlisted' | 'friends' | 'connections';

/** Result returned after a post attempt */
export interface PostResult {
  success: boolean;
  /** Platform-specific post / video ID */
  postId?: string;
  /** Public URL of the published content */
  url?: string;
  /** Human-readable error message on failure */
  error?: string;
  /** The platform this result is for */
  platform: Platform;
}

/** OAuth token pair with optional expiry */
export interface TokenResult {
  accessToken: string;
  refreshToken?: string;
  /** ISO-8601 expiry timestamp */
  expiresAt?: string;
  /** Token type (e.g. "Bearer") */
  tokenType?: string;
  /** Granted scopes (space-separated) */
  scope?: string;
}

/** Common fields every platform post request can include */
export interface BasePostOptions {
  /** Text content / caption / description */
  text: string;
  /** Absolute paths to local media files (images / videos) */
  mediaFiles?: string[];
  /** Remote media URLs (if files are already hosted) */
  mediaUrls?: string[];
  /** Desired privacy level */
  privacy?: PostPrivacy;
  /** Hashtags (without leading #) */
  tags?: string[];
}

/** TikTok-specific posting options (Creator API v2) */
export interface TikTokPostOptions extends BasePostOptions {
  /** Whether to disable comments */
  disableComments?: boolean;
  /** Whether to disable duets */
  disableDuet?: boolean;
  /** Whether to disable stitches */
  disableStitch?: boolean;
  /** Brand content disclosure */
  brandContentToggle?: boolean;
  /** Brand content organic indicator */
  brandOrganicToggle?: boolean;
}

/** YouTube-specific posting options (Data API v3) */
export interface YouTubePostOptions extends BasePostOptions {
  /** Video title (required for YouTube) */
  title: string;
  /** Video description (overrides text) */
  description?: string;
  /** YouTube category ID (e.g. "22" for People & Blogs) */
  categoryId?: string;
  /** Whether the video is made for kids */
  madeForKids?: boolean;
  /** Playlist ID to add the video to after upload */
  playlistId?: string;
  /** Thumbnail file path */
  thumbnailPath?: string;
}

/** Instagram-specific posting options (Graph API) */
export interface InstagramPostOptions extends BasePostOptions {
  /** Post type */
  postType?: 'feed' | 'reels' | 'stories' | 'carousel';
  /** Cover image URL for reels */
  coverUrl?: string;
  /** Share to feed (for reels) */
  shareToFeed?: boolean;
  /** Location page ID */
  locationId?: string;
}

/** X/Twitter-specific posting options (API v2) */
export interface XPostOptions extends BasePostOptions {
  /** Quote tweet ID */
  quoteTweetId?: string;
  /** Reply to tweet ID */
  replyToId?: string;
  /** Poll options (2-4 choices) */
  poll?: {
    options: string[];
    durationMinutes: number;
  };
}

/** LinkedIn-specific posting options */
export interface LinkedInPostOptions extends BasePostOptions {
  /** LinkedIn author URN (e.g. "urn:li:person:xxx" or "urn:li:organization:xxx") */
  authorUrn?: string;
  /** Article link to share */
  articleUrl?: string;
  /** Article title (used with articleUrl) */
  articleTitle?: string;
  /** Article description (used with articleUrl) */
  articleDescription?: string;
}

/** Credentials needed for each platform (retrieved from SettingsManager / SocialAccounts) */
export interface PlatformCredentials {
  accessToken: string;
  refreshToken?: string;
  /** OAuth 1.0a consumer key (X/Twitter) */
  consumerKey?: string;
  /** OAuth 1.0a consumer secret (X/Twitter) */
  consumerSecret?: string;
  /** OAuth 1.0a access token secret (X/Twitter) */
  accessTokenSecret?: string;
  /** Client ID (TikTok, YouTube) */
  clientId?: string;
  /** Client secret (TikTok, YouTube) */
  clientSecret?: string;
  /** Instagram/Facebook page ID */
  pageId?: string;
  /** Instagram business account ID */
  instagramAccountId?: string;
}

/** Union of all platform-specific post options */
export type PlatformPostOptions =
  | ({ platform: Platform.TIKTOK } & TikTokPostOptions & { credentials: PlatformCredentials })
  | ({ platform: Platform.YOUTUBE } & YouTubePostOptions & { credentials: PlatformCredentials })
  | ({ platform: Platform.INSTAGRAM } & InstagramPostOptions & { credentials: PlatformCredentials })
  | ({ platform: Platform.X } & XPostOptions & { credentials: PlatformCredentials })
  | ({ platform: Platform.LINKEDIN } & LinkedInPostOptions & { credentials: PlatformCredentials });
