/**
 * Instagram Posting - Graph API
 *
 * Implements photo/video/reel/carousel publishing via Instagram Graph API.
 * Requires a Facebook Page linked to an Instagram Professional account.
 *
 * Flow for single media:
 *   1. Create a media container (POST /{ig-user-id}/media)
 *   2. Publish the container  (POST /{ig-user-id}/media_publish)
 *
 * Flow for carousel:
 *   1. Create individual item containers
 *   2. Create carousel container referencing children
 *   3. Publish the carousel container
 *
 * Reference: https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/content-publishing
 */

import type { InstagramPostOptions, PlatformCredentials, PostResult } from './types';
import { Platform } from './types';
import { proxyFetch } from '../../utils/proxy-fetch';

const GRAPH_API_BASE = 'https://graph.facebook.com/v21.0';

interface IGMediaResponse {
  id: string;
}

interface IGPublishResponse {
  id: string;
}

interface IGErrorResponse {
  error: {
    message: string;
    type: string;
    code: number;
    fbtrace_id: string;
  };
}

interface IGStatusResponse {
  status_code: string;
}

/**
 * Post content to Instagram via the Graph API.
 */
export async function postToInstagram(
  options: InstagramPostOptions,
  credentials: PlatformCredentials
): Promise<PostResult> {
  const { accessToken, instagramAccountId } = credentials;

  if (!accessToken) {
    return {
      success: false,
      error: 'Missing Instagram access token',
      platform: Platform.INSTAGRAM,
    };
  }

  if (!instagramAccountId) {
    return {
      success: false,
      error: 'Missing Instagram business account ID',
      platform: Platform.INSTAGRAM,
    };
  }

  const mediaUrls = options.mediaUrls ?? [];
  const postType = options.postType || inferPostType(mediaUrls);

  try {
    if (postType === 'carousel' && mediaUrls.length > 1) {
      return await publishCarousel(accessToken, instagramAccountId, options, mediaUrls);
    }

    return await publishSingleMedia(accessToken, instagramAccountId, options, mediaUrls, postType);
  } catch (err) {
    return {
      success: false,
      error: `Instagram post failed: ${err instanceof Error ? err.message : String(err)}`,
      platform: Platform.INSTAGRAM,
    };
  }
}

/**
 * Publish a single photo, video, reel, or story.
 */
async function publishSingleMedia(
  accessToken: string,
  igUserId: string,
  options: InstagramPostOptions,
  mediaUrls: string[],
  postType: string
): Promise<PostResult> {
  const mediaUrl = mediaUrls[0];

  // Build container params
  const params: Record<string, string> = {
    access_token: accessToken,
    caption: buildCaption(options),
  };

  if (postType === 'reels' || isVideoUrl(mediaUrl)) {
    params.media_type = 'REELS';
    params.video_url = mediaUrl || '';
    if (options.coverUrl) {
      params.cover_url = options.coverUrl;
    }
    if (options.shareToFeed !== undefined) {
      params.share_to_feed = String(options.shareToFeed);
    }
  } else if (postType === 'stories') {
    params.media_type = 'STORIES';
    if (isVideoUrl(mediaUrl)) {
      params.video_url = mediaUrl || '';
    } else {
      params.image_url = mediaUrl || '';
    }
  } else {
    // Regular feed photo
    params.image_url = mediaUrl || '';
  }

  if (options.locationId) {
    params.location_id = options.locationId;
  }

  // Step 1: Create media container
  const containerResponse = await proxyFetch(`${GRAPH_API_BASE}/${igUserId}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  const containerData = (await containerResponse.json()) as IGMediaResponse | IGErrorResponse;

  if ('error' in containerData) {
    return {
      success: false,
      error: `Instagram container creation failed: ${containerData.error.message}`,
      platform: Platform.INSTAGRAM,
    };
  }

  const containerId = containerData.id;

  // For video/reels, wait for processing
  if (params.media_type === 'REELS' || params.media_type === 'STORIES') {
    await waitForProcessing(accessToken, containerId);
  }

  // Step 2: Publish the container
  return await publishContainer(accessToken, igUserId, containerId);
}

/**
 * Publish a carousel with multiple media items.
 */
async function publishCarousel(
  accessToken: string,
  igUserId: string,
  options: InstagramPostOptions,
  mediaUrls: string[]
): Promise<PostResult> {
  // Step 1: Create individual item containers (max 10)
  const childIds: string[] = [];

  for (const url of mediaUrls.slice(0, 10)) {
    const params: Record<string, string> = {
      access_token: accessToken,
      is_carousel_item: 'true',
    };

    if (isVideoUrl(url)) {
      params.media_type = 'VIDEO';
      params.video_url = url;
    } else {
      params.image_url = url;
    }

    const response = await proxyFetch(`${GRAPH_API_BASE}/${igUserId}/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });

    const data = (await response.json()) as IGMediaResponse | IGErrorResponse;

    if ('error' in data) {
      return {
        success: false,
        error: `Instagram carousel item failed: ${data.error.message}`,
        platform: Platform.INSTAGRAM,
      };
    }

    childIds.push(data.id);
  }

  // Wait for all video items to process
  for (const childId of childIds) {
    await waitForProcessing(accessToken, childId);
  }

  // Step 2: Create carousel container
  const carouselParams = {
    access_token: accessToken,
    media_type: 'CAROUSEL',
    caption: buildCaption(options),
    children: childIds.join(','),
    ...(options.locationId ? { location_id: options.locationId } : {}),
  };

  const carouselResponse = await proxyFetch(`${GRAPH_API_BASE}/${igUserId}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(carouselParams),
  });

  const carouselData = (await carouselResponse.json()) as IGMediaResponse | IGErrorResponse;

  if ('error' in carouselData) {
    return {
      success: false,
      error: `Instagram carousel creation failed: ${carouselData.error.message}`,
      platform: Platform.INSTAGRAM,
    };
  }

  // Step 3: Publish the carousel
  return await publishContainer(accessToken, igUserId, carouselData.id);
}

/**
 * Publish a media container.
 */
async function publishContainer(
  accessToken: string,
  igUserId: string,
  containerId: string
): Promise<PostResult> {
  const publishResponse = await proxyFetch(`${GRAPH_API_BASE}/${igUserId}/media_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      access_token: accessToken,
      creation_id: containerId,
    }),
  });

  const publishData = (await publishResponse.json()) as IGPublishResponse | IGErrorResponse;

  if ('error' in publishData) {
    return {
      success: false,
      error: `Instagram publish failed: ${publishData.error.message}`,
      platform: Platform.INSTAGRAM,
    };
  }

  return {
    success: true,
    postId: publishData.id,
    url: `https://www.instagram.com/p/${publishData.id}/`,
    platform: Platform.INSTAGRAM,
  };
}

/**
 * Wait for a media container to finish processing (videos/reels).
 */
async function waitForProcessing(
  accessToken: string,
  containerId: string,
  maxAttempts: number = 30,
  intervalMs: number = 5000
): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    const response = await proxyFetch(
      `${GRAPH_API_BASE}/${containerId}?fields=status_code&access_token=${accessToken}`
    );
    const data = (await response.json()) as IGStatusResponse;

    if (data.status_code === 'FINISHED') {
      return;
    }

    if (data.status_code === 'ERROR') {
      throw new Error('Instagram media processing failed');
    }

    await sleep(intervalMs);
  }

  throw new Error('Instagram media processing timed out');
}

/** Build caption with hashtags */
function buildCaption(options: InstagramPostOptions): string {
  let caption = options.text;
  if (options.tags?.length) {
    const hashtags = options.tags.map((t) => `#${t}`).join(' ');
    caption = `${caption}\n\n${hashtags}`;
  }
  return caption;
}

/** Infer post type from media URLs */
function inferPostType(mediaUrls: string[]): string {
  if (mediaUrls.length > 1) return 'carousel';
  if (mediaUrls.length === 1 && isVideoUrl(mediaUrls[0])) return 'reels';
  return 'feed';
}

/** Check if a URL looks like a video */
function isVideoUrl(url?: string): boolean {
  if (!url) return false;
  return /\.(mp4|mov|avi|wmv|webm)(\?|$)/i.test(url);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
