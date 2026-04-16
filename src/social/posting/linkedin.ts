/**
 * LinkedIn Posting - API v2
 *
 * Implements text posts, image/video shares, and article shares
 * via LinkedIn's Marketing API (Community Management).
 *
 * Flow for media posts:
 *   1. Register upload (POST /assets?action=registerUpload)
 *   2. Upload binary to the provided URL
 *   3. Create post referencing the asset URN
 *
 * Reference: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares
 */

import fs from 'fs';
import path from 'path';

import type { LinkedInPostOptions, PlatformCredentials, PostResult } from './types';
import { Platform } from './types';
import { proxyFetch } from '../../utils/proxy-fetch';

const LINKEDIN_API_BASE = 'https://api.linkedin.com/v2';
const LINKEDIN_REST_BASE = 'https://api.linkedin.com/rest';

interface LinkedInPostResponse {
  id: string;
}

interface LinkedInErrorResponse {
  message: string;
  status: number;
  serviceErrorCode?: number;
}

interface LinkedInRegisterUploadResponse {
  value: {
    uploadMechanism: {
      'com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest': {
        uploadUrl: string;
        headers: Record<string, string>;
      };
    };
    asset: string; // URN like "urn:li:digitalmediaAsset:xxx"
  };
}

/**
 * Post content to LinkedIn.
 */
export async function postToLinkedIn(
  options: LinkedInPostOptions,
  credentials: PlatformCredentials
): Promise<PostResult> {
  const { accessToken } = credentials;

  if (!accessToken) {
    return {
      success: false,
      error: 'Missing LinkedIn access token',
      platform: Platform.LINKEDIN,
    };
  }

  try {
    // Determine the author URN
    const authorUrn = options.authorUrn || (await getProfileUrn(accessToken));
    if (!authorUrn) {
      return {
        success: false,
        error: 'Could not determine LinkedIn author URN',
        platform: Platform.LINKEDIN,
      };
    }

    // Decide which type of post to create
    if (options.articleUrl) {
      return await postArticleShare(accessToken, authorUrn, options);
    }

    const mediaFiles = options.mediaFiles ?? [];
    if (mediaFiles.length > 0) {
      return await postWithMedia(accessToken, authorUrn, options, mediaFiles);
    }

    // Text-only post
    return await postTextOnly(accessToken, authorUrn, options);
  } catch (err) {
    return {
      success: false,
      error: `LinkedIn post failed: ${err instanceof Error ? err.message : String(err)}`,
      platform: Platform.LINKEDIN,
    };
  }
}

/**
 * Create a text-only post (no media, no article).
 */
async function postTextOnly(
  accessToken: string,
  authorUrn: string,
  options: LinkedInPostOptions
): Promise<PostResult> {
  const body = {
    author: authorUrn,
    lifecycleState: 'PUBLISHED',
    specificContent: {
      'com.linkedin.ugc.ShareContent': {
        shareCommentary: {
          text: buildText(options),
        },
        shareMediaCategory: 'NONE',
      },
    },
    visibility: {
      'com.linkedin.ugc.MemberNetworkVisibility': mapVisibility(options.privacy),
    },
  };

  return await createUgcPost(accessToken, body);
}

/**
 * Create a post with media (image or video).
 */
async function postWithMedia(
  accessToken: string,
  authorUrn: string,
  options: LinkedInPostOptions,
  mediaFiles: string[]
): Promise<PostResult> {
  const mediaAssets: Array<{ asset: string; title: string }> = [];

  for (const file of mediaFiles) {
    const resolved = path.resolve(file);
    if (!fs.existsSync(resolved)) {
      console.warn(`[LinkedIn] File not found: ${resolved}`);
      continue;
    }

    const isVideo = isVideoFile(resolved);

    // Register the upload
    const registerBody = {
      registerUploadRequest: {
        recipes: [
          isVideo
            ? 'urn:li:digitalmediaRecipe:feedshare-video'
            : 'urn:li:digitalmediaRecipe:feedshare-image',
        ],
        owner: authorUrn,
        serviceRelationships: [
          {
            relationshipType: 'OWNER',
            identifier: 'urn:li:userGeneratedContent',
          },
        ],
      },
    };

    const registerResponse = await proxyFetch(`${LINKEDIN_API_BASE}/assets?action=registerUpload`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'X-Restli-Protocol-Version': '2.0.0',
      },
      body: JSON.stringify(registerBody),
    });

    if (!registerResponse.ok) {
      const err = (await registerResponse.json()) as LinkedInErrorResponse;
      return {
        success: false,
        error: `LinkedIn upload register failed: ${err.message}`,
        platform: Platform.LINKEDIN,
      };
    }

    const registerData = (await registerResponse.json()) as LinkedInRegisterUploadResponse;
    const uploadInfo =
      registerData.value.uploadMechanism[
        'com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest'
      ];

    // Upload the file
    const fileBuffer = fs.readFileSync(resolved);
    const uploadResponse = await proxyFetch(uploadInfo.uploadUrl, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...uploadInfo.headers,
        'Content-Type': getMimeType(resolved),
      },
      body: fileBuffer,
    });

    if (!uploadResponse.ok) {
      return {
        success: false,
        error: `LinkedIn file upload failed: HTTP ${uploadResponse.status}`,
        platform: Platform.LINKEDIN,
      };
    }

    mediaAssets.push({
      asset: registerData.value.asset,
      title: path.basename(resolved),
    });
  }

  if (mediaAssets.length === 0) {
    // Fall back to text-only
    return await postTextOnly(accessToken, authorUrn, options);
  }

  const body = {
    author: authorUrn,
    lifecycleState: 'PUBLISHED',
    specificContent: {
      'com.linkedin.ugc.ShareContent': {
        shareCommentary: {
          text: buildText(options),
        },
        shareMediaCategory:
          mediaAssets.length > 0 && isVideoFile(options.mediaFiles?.[0] ?? '') ? 'VIDEO' : 'IMAGE',
        media: mediaAssets.map((m) => ({
          status: 'READY',
          media: m.asset,
          title: { text: m.title },
        })),
      },
    },
    visibility: {
      'com.linkedin.ugc.MemberNetworkVisibility': mapVisibility(options.privacy),
    },
  };

  return await createUgcPost(accessToken, body);
}

/**
 * Create an article share post.
 */
async function postArticleShare(
  accessToken: string,
  authorUrn: string,
  options: LinkedInPostOptions
): Promise<PostResult> {
  const body = {
    author: authorUrn,
    lifecycleState: 'PUBLISHED',
    specificContent: {
      'com.linkedin.ugc.ShareContent': {
        shareCommentary: {
          text: buildText(options),
        },
        shareMediaCategory: 'ARTICLE',
        media: [
          {
            status: 'READY',
            originalUrl: options.articleUrl,
            title: options.articleTitle ? { text: options.articleTitle } : undefined,
            description: options.articleDescription
              ? { text: options.articleDescription }
              : undefined,
          },
        ],
      },
    },
    visibility: {
      'com.linkedin.ugc.MemberNetworkVisibility': mapVisibility(options.privacy),
    },
  };

  return await createUgcPost(accessToken, body);
}

/**
 * Execute the UGC post creation request.
 */
async function createUgcPost(
  accessToken: string,
  body: Record<string, unknown>
): Promise<PostResult> {
  const response = await proxyFetch(`${LINKEDIN_API_BASE}/ugcPosts`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'X-Restli-Protocol-Version': '2.0.0',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errData = (await response.json()) as LinkedInErrorResponse;
    return {
      success: false,
      error: `LinkedIn post failed: ${errData.message || response.statusText}`,
      platform: Platform.LINKEDIN,
    };
  }

  const postData = (await response.json()) as LinkedInPostResponse;
  const postId = postData.id;

  // LinkedIn post IDs look like "urn:li:share:1234567" or "urn:li:ugcPost:1234567"
  // Extract the numeric part for URL
  const numericId = postId.split(':').pop();

  return {
    success: true,
    postId,
    url: numericId ? `https://www.linkedin.com/feed/update/${postId}/` : undefined,
    platform: Platform.LINKEDIN,
  };
}

/**
 * Get the authenticated user's LinkedIn profile URN.
 */
async function getProfileUrn(accessToken: string): Promise<string | null> {
  try {
    // Try the newer userinfo endpoint first
    const response = await proxyFetch(`${LINKEDIN_REST_BASE}/userinfo`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'LinkedIn-Version': '202401',
      },
    });

    if (response.ok) {
      const data = (await response.json()) as { sub: string };
      if (data.sub) {
        return `urn:li:person:${data.sub}`;
      }
    }

    // Fallback to v2 /me endpoint
    const meResponse = await proxyFetch(`${LINKEDIN_API_BASE}/me`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (meResponse.ok) {
      const meData = (await meResponse.json()) as { id: string };
      return `urn:li:person:${meData.id}`;
    }

    return null;
  } catch {
    return null;
  }
}

/** Build text with hashtags */
function buildText(options: LinkedInPostOptions): string {
  let text = options.text;
  if (options.tags?.length) {
    const hashtags = options.tags.map((t) => `#${t}`).join(' ');
    text = `${text}\n\n${hashtags}`;
  }
  return text;
}

/** Map generic privacy to LinkedIn visibility */
function mapVisibility(privacy?: string): string {
  switch (privacy) {
    case 'public':
      return 'PUBLIC';
    case 'connections':
      return 'CONNECTIONS';
    case 'private':
      return 'LOGGED_IN'; // LinkedIn doesn't have truly private posts
    default:
      return 'PUBLIC';
  }
}

/** Check if file is a video */
function isVideoFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return ['.mp4', '.mov', '.avi', '.wmv', '.webm', '.mkv'].includes(ext);
}

/** Determine MIME type from extension */
function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes: Record<string, string> = {
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.avi': 'video/x-msvideo',
    '.wmv': 'video/x-ms-wmv',
    '.webm': 'video/webm',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
  };
  return mimeTypes[ext] || 'application/octet-stream';
}
