/**
 * YouTube Posting - Data API v3
 *
 * Implements video upload via YouTube Data API v3 resumable upload protocol.
 * Supports setting title, description, tags, category, privacy, and thumbnail.
 *
 * Reference: https://developers.google.com/youtube/v3/docs/videos/insert
 */

import fs from 'fs';
import path from 'path';

import type { YouTubePostOptions, PlatformCredentials, PostResult } from './types';
import { Platform } from './types';
import { proxyFetch } from '../../utils/proxy-fetch';

const YOUTUBE_UPLOAD_URL = 'https://www.googleapis.com/upload/youtube/v3/videos';
const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';

interface YouTubeVideoResource {
  id: string;
  snippet: {
    title: string;
    description: string;
    channelId: string;
  };
  status: {
    uploadStatus: string;
    privacyStatus: string;
  };
}

interface YouTubeErrorResponse {
  error: {
    code: number;
    message: string;
    errors: Array<{ message: string; domain: string; reason: string }>;
  };
}

/**
 * Upload a video to YouTube using the resumable upload protocol.
 */
export async function postToYouTube(
  options: YouTubePostOptions,
  credentials: PlatformCredentials
): Promise<PostResult> {
  const { accessToken } = credentials;

  if (!accessToken) {
    return { success: false, error: 'Missing YouTube access token', platform: Platform.YOUTUBE };
  }

  const videoFile = options.mediaFiles?.[0];
  if (!videoFile) {
    return { success: false, error: 'YouTube requires a video file', platform: Platform.YOUTUBE };
  }

  const resolvedPath = path.resolve(videoFile);
  if (!fs.existsSync(resolvedPath)) {
    return {
      success: false,
      error: `Video file not found: ${resolvedPath}`,
      platform: Platform.YOUTUBE,
    };
  }

  try {
    // Build the video resource metadata
    const description = options.description || options.text;
    const tags = options.tags ?? [];

    const videoResource = {
      snippet: {
        title: options.title,
        description,
        tags,
        categoryId: options.categoryId || '22', // People & Blogs
      },
      status: {
        privacyStatus: mapPrivacy(options.privacy),
        madeForKids: options.madeForKids ?? false,
        selfDeclaredMadeForKids: options.madeForKids ?? false,
      },
    };

    // Step 1: Initiate resumable upload
    const initResponse = await proxyFetch(
      `${YOUTUBE_UPLOAD_URL}?uploadType=resumable&part=snippet,status`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': getMimeType(resolvedPath),
          'X-Upload-Content-Length': String(fs.statSync(resolvedPath).size),
        },
        body: JSON.stringify(videoResource),
      }
    );

    if (!initResponse.ok) {
      const errBody = (await initResponse.json()) as YouTubeErrorResponse;
      return {
        success: false,
        error: `YouTube init failed: ${errBody.error?.message || initResponse.statusText}`,
        platform: Platform.YOUTUBE,
      };
    }

    const uploadUrl = initResponse.headers.get('location');
    if (!uploadUrl) {
      return {
        success: false,
        error: 'YouTube did not return a resumable upload URL',
        platform: Platform.YOUTUBE,
      };
    }

    // Step 2: Upload the video file
    const videoBuffer = fs.readFileSync(resolvedPath);
    const uploadResponse = await proxyFetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': getMimeType(resolvedPath),
        'Content-Length': String(videoBuffer.byteLength),
      },
      body: videoBuffer,
    });

    if (!uploadResponse.ok) {
      const errBody = (await uploadResponse.json()) as YouTubeErrorResponse;
      return {
        success: false,
        error: `YouTube upload failed: ${errBody.error?.message || uploadResponse.statusText}`,
        platform: Platform.YOUTUBE,
      };
    }

    const video = (await uploadResponse.json()) as YouTubeVideoResource;
    const videoId = video.id;

    // Step 3: Upload thumbnail if provided
    if (options.thumbnailPath) {
      await uploadThumbnail(accessToken, videoId, options.thumbnailPath);
    }

    // Step 4: Add to playlist if requested
    if (options.playlistId) {
      await addToPlaylist(accessToken, videoId, options.playlistId);
    }

    return {
      success: true,
      postId: videoId,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      platform: Platform.YOUTUBE,
    };
  } catch (err) {
    return {
      success: false,
      error: `YouTube post failed: ${err instanceof Error ? err.message : String(err)}`,
      platform: Platform.YOUTUBE,
    };
  }
}

/**
 * Upload a custom thumbnail for a video.
 */
async function uploadThumbnail(
  accessToken: string,
  videoId: string,
  thumbnailPath: string
): Promise<void> {
  const resolved = path.resolve(thumbnailPath);
  if (!fs.existsSync(resolved)) {
    console.warn(`[YouTube] Thumbnail not found: ${resolved}`);
    return;
  }

  const thumbBuffer = fs.readFileSync(resolved);
  const response = await proxyFetch(`${YOUTUBE_API_BASE}/thumbnails/set?videoId=${videoId}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': getMimeType(resolved),
      'Content-Length': String(thumbBuffer.byteLength),
    },
    body: thumbBuffer,
  });

  if (!response.ok) {
    console.warn(`[YouTube] Thumbnail upload failed: ${response.statusText}`);
  }
}

/**
 * Add a video to a playlist.
 */
async function addToPlaylist(
  accessToken: string,
  videoId: string,
  playlistId: string
): Promise<void> {
  const response = await proxyFetch(`${YOUTUBE_API_BASE}/playlistItems?part=snippet`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      snippet: {
        playlistId,
        resourceId: {
          kind: 'youtube#video',
          videoId,
        },
      },
    }),
  });

  if (!response.ok) {
    console.warn(`[YouTube] Playlist add failed: ${response.statusText}`);
  }
}

/** Map generic privacy to YouTube privacy status */
function mapPrivacy(privacy?: string): string {
  switch (privacy) {
    case 'public':
      return 'public';
    case 'private':
      return 'private';
    case 'unlisted':
      return 'unlisted';
    default:
      return 'private';
  }
}

/** Determine MIME type from file extension */
function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes: Record<string, string> = {
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.avi': 'video/x-msvideo',
    '.wmv': 'video/x-ms-wmv',
    '.flv': 'video/x-flv',
    '.webm': 'video/webm',
    '.mkv': 'video/x-matroska',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
  };
  return mimeTypes[ext] || 'application/octet-stream';
}
