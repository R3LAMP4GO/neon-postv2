/**
 * TikTok Posting - Creator API v2
 *
 * Implements direct video upload via TikTok's Creator API v2 endpoints.
 * Flow: init upload → upload video chunks → publish.
 *
 * Reference: https://developers.tiktok.com/doc/content-posting-api-get-started
 */

import fs from 'fs';
import path from 'path';

import type { TikTokPostOptions, PlatformCredentials, PostResult } from './types';
import { Platform } from './types';
import { proxyFetch } from '../../utils/proxy-fetch';

const TIKTOK_API_BASE = 'https://open.tiktokapis.com/v2';

interface TikTokInitResponse {
  data: {
    publish_id: string;
    upload_url: string;
  };
  error: {
    code: string;
    message: string;
    log_id: string;
  };
}

interface TikTokStatusResponse {
  data: {
    status: string;
    publicaly_available_post_id?: string[];
  };
  error: {
    code: string;
    message: string;
    log_id: string;
  };
}

/**
 * Post a video to TikTok using Creator API v2 (direct post).
 *
 * The flow is:
 * 1. Initialize the upload to get an upload_url
 * 2. Upload the video file via PUT to upload_url
 * 3. Poll publish status until done
 */
export async function postToTikTok(
  options: TikTokPostOptions,
  credentials: PlatformCredentials
): Promise<PostResult> {
  const { accessToken } = credentials;

  if (!accessToken) {
    return { success: false, error: 'Missing TikTok access token', platform: Platform.TIKTOK };
  }

  // Resolve the video file
  const videoFile = options.mediaFiles?.[0];
  if (!videoFile) {
    return { success: false, error: 'TikTok requires a video file', platform: Platform.TIKTOK };
  }

  const resolvedPath = path.resolve(videoFile);
  if (!fs.existsSync(resolvedPath)) {
    return {
      success: false,
      error: `Video file not found: ${resolvedPath}`,
      platform: Platform.TIKTOK,
    };
  }

  const fileSize = fs.statSync(resolvedPath).size;

  try {
    // Step 1: Initialize the upload
    const initBody = {
      post_info: {
        title: options.text.slice(0, 150), // TikTok title limit
        privacy_level: mapPrivacy(options.privacy),
        disable_comment: options.disableComments ?? false,
        disable_duet: options.disableDuet ?? false,
        disable_stitch: options.disableStitch ?? false,
        brand_content_toggle: options.brandContentToggle ?? false,
        brand_organic_toggle: options.brandOrganicToggle ?? false,
      },
      source_info: {
        source: 'FILE_UPLOAD' as const,
        video_size: fileSize,
        chunk_size: fileSize, // Single chunk upload for simplicity
        total_chunk_count: 1,
      },
    };

    const initResponse = await proxyFetch(`${TIKTOK_API_BASE}/post/publish/inbox/video/init/`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
      },
      body: JSON.stringify(initBody),
    });

    const initData = (await initResponse.json()) as TikTokInitResponse;

    if (initData.error?.code !== 'ok' && initData.error?.code) {
      return {
        success: false,
        error: `TikTok init failed: ${initData.error.message} (${initData.error.code})`,
        platform: Platform.TIKTOK,
      };
    }

    const { publish_id, upload_url } = initData.data;

    // Step 2: Upload the video file
    const videoBuffer = fs.readFileSync(resolvedPath);
    const uploadResponse = await proxyFetch(upload_url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Range': `bytes 0-${fileSize - 1}/${fileSize}`,
        'Content-Length': String(fileSize),
      },
      body: videoBuffer,
    });

    if (!uploadResponse.ok) {
      return {
        success: false,
        error: `TikTok upload failed: HTTP ${uploadResponse.status}`,
        platform: Platform.TIKTOK,
      };
    }

    // Step 3: Poll for publish status
    const postId = await pollPublishStatus(accessToken, publish_id);

    return {
      success: true,
      postId: postId ?? publish_id,
      url: postId ? `https://www.tiktok.com/@/video/${postId}` : undefined,
      platform: Platform.TIKTOK,
    };
  } catch (err) {
    return {
      success: false,
      error: `TikTok post failed: ${err instanceof Error ? err.message : String(err)}`,
      platform: Platform.TIKTOK,
    };
  }
}

/**
 * Poll TikTok's publish status endpoint until the video is processed.
 * Returns the public post ID if available.
 */
async function pollPublishStatus(
  accessToken: string,
  publishId: string,
  maxAttempts: number = 15,
  intervalMs: number = 5000
): Promise<string | null> {
  for (let i = 0; i < maxAttempts; i++) {
    await sleep(intervalMs);

    const statusResponse = await proxyFetch(`${TIKTOK_API_BASE}/post/publish/status/fetch/`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ publish_id: publishId }),
    });

    const statusData = (await statusResponse.json()) as TikTokStatusResponse;

    if (statusData.data?.status === 'PUBLISH_COMPLETE') {
      return statusData.data.publicaly_available_post_id?.[0] ?? null;
    }

    if (statusData.data?.status === 'FAILED') {
      throw new Error(statusData.error?.message || 'Publish failed');
    }
  }

  // Timed out but upload was accepted
  return null;
}

/** Map our generic privacy to TikTok's privacy levels */
function mapPrivacy(privacy?: string): string {
  switch (privacy) {
    case 'public':
      return 'PUBLIC_TO_EVERYONE';
    case 'friends':
      return 'MUTUAL_FOLLOW_FRIENDS';
    case 'private':
      return 'SELF_ONLY';
    default:
      return 'PUBLIC_TO_EVERYONE';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
