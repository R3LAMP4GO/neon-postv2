/**
 * X/Twitter Posting - API v2 + OAuth 1.0a
 *
 * Implements tweet creation, media upload, polls, and reply threads
 * via X API v2 with OAuth 1.0a HMAC-SHA1 signing.
 *
 * Reference: https://developer.x.com/en/docs/x-api/tweets/manage-tweets/api-reference/post-tweets
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import type { XPostOptions, PlatformCredentials, PostResult } from './types';
import { Platform } from './types';
import { proxyFetch } from '../../utils/proxy-fetch';

const X_API_BASE = 'https://api.x.com/2';
const X_UPLOAD_BASE = 'https://upload.x.com/1.1';

interface XTweetResponse {
  data: {
    id: string;
    text: string;
  };
}

interface XErrorResponse {
  detail?: string;
  title?: string;
  errors?: Array<{ message: string }>;
}

interface XMediaResponse {
  media_id_string: string;
  processing_info?: {
    state: string;
    check_after_secs: number;
  };
}

interface XMediaStatusResponse {
  media_id_string: string;
  processing_info?: {
    state: string;
    check_after_secs: number;
    error?: { message: string };
  };
}

/**
 * Post a tweet to X/Twitter using API v2 with OAuth 1.0a authentication.
 */
export async function postToX(
  options: XPostOptions,
  credentials: PlatformCredentials
): Promise<PostResult> {
  const { accessToken, accessTokenSecret, consumerKey, consumerSecret } = credentials;

  if (!accessToken || !accessTokenSecret || !consumerKey || !consumerSecret) {
    return {
      success: false,
      error:
        'Missing X/Twitter OAuth 1.0a credentials (need all four: consumer key/secret + access token/secret)',
      platform: Platform.X,
    };
  }

  try {
    // Upload media if present
    const mediaIds: string[] = [];
    const mediaFiles = options.mediaFiles ?? [];

    for (const file of mediaFiles.slice(0, 4)) {
      const mediaId = await uploadMedia(file, {
        consumerKey,
        consumerSecret,
        accessToken,
        accessTokenSecret,
      });
      if (mediaId) {
        mediaIds.push(mediaId);
      }
    }

    // Build tweet payload
    const tweetBody: Record<string, unknown> = {
      text: buildTweetText(options),
    };

    if (mediaIds.length > 0) {
      tweetBody.media = { media_ids: mediaIds };
    }

    if (options.replyToId) {
      tweetBody.reply = { in_reply_to_tweet_id: options.replyToId };
    }

    if (options.quoteTweetId) {
      tweetBody.quote_tweet_id = options.quoteTweetId;
    }

    if (options.poll) {
      tweetBody.poll = {
        options: options.poll.options.map((label) => ({ label })),
        duration_minutes: options.poll.durationMinutes,
      };
    }

    // Send the tweet
    const url = `${X_API_BASE}/tweets`;
    const headers = buildOAuth1Headers('POST', url, {
      consumerKey,
      consumerSecret,
      accessToken,
      accessTokenSecret,
    });

    const response = await proxyFetch(url, {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(tweetBody),
    });

    const data = (await response.json()) as XTweetResponse | XErrorResponse;

    if (!response.ok) {
      const errData = data as XErrorResponse;
      const errMsg = errData.detail || errData.errors?.[0]?.message || `HTTP ${response.status}`;
      return {
        success: false,
        error: `X post failed: ${errMsg}`,
        platform: Platform.X,
      };
    }

    const tweetData = data as XTweetResponse;
    return {
      success: true,
      postId: tweetData.data.id,
      url: `https://x.com/i/status/${tweetData.data.id}`,
      platform: Platform.X,
    };
  } catch (err) {
    return {
      success: false,
      error: `X post failed: ${err instanceof Error ? err.message : String(err)}`,
      platform: Platform.X,
    };
  }
}

/** Build tweet text with hashtags appended */
function buildTweetText(options: XPostOptions): string {
  let text = options.text;
  if (options.tags?.length) {
    const hashtags = options.tags.map((t) => `#${t}`).join(' ');
    const combined = `${text} ${hashtags}`;
    // X has 280 char limit
    if (combined.length <= 280) {
      text = combined;
    }
  }
  return text.slice(0, 280);
}

// ============ Media Upload (chunked) ============

interface OAuth1Creds {
  consumerKey: string;
  consumerSecret: string;
  accessToken: string;
  accessTokenSecret: string;
}

/**
 * Upload media to X using the chunked upload endpoint.
 * Flow: INIT → APPEND → FINALIZE → (poll STATUS)
 */
async function uploadMedia(filePath: string, creds: OAuth1Creds): Promise<string | null> {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    console.warn(`[X] Media file not found: ${resolved}`);
    return null;
  }

  const fileBuffer = fs.readFileSync(resolved);
  const fileSize = fileBuffer.byteLength;
  const mimeType = getMimeType(resolved);
  const mediaCategory = mimeType.startsWith('video/') ? 'tweet_video' : 'tweet_image';

  // INIT
  const initUrl = `${X_UPLOAD_BASE}/media/upload.json`;
  const initParams = {
    command: 'INIT',
    total_bytes: String(fileSize),
    media_type: mimeType,
    media_category: mediaCategory,
  };

  const initHeaders = buildOAuth1Headers('POST', initUrl, creds, initParams);
  const initResponse = await proxyFetch(initUrl, {
    method: 'POST',
    headers: {
      ...initHeaders,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(initParams).toString(),
  });

  if (!initResponse.ok) {
    console.warn(`[X] Media INIT failed: ${initResponse.statusText}`);
    return null;
  }

  const initData = (await initResponse.json()) as XMediaResponse;
  const mediaId = initData.media_id_string;

  // APPEND (single chunk for simplicity)
  const appendUrl = `${X_UPLOAD_BASE}/media/upload.json`;
  const boundary = `----FormBoundary${crypto.randomUUID().replace(/-/g, '')}`;

  const appendBody = buildMultipartBody(boundary, mediaId, fileBuffer, mimeType);
  const appendHeaders = buildOAuth1Headers('POST', appendUrl, creds, {
    command: 'APPEND',
    media_id: mediaId,
    segment_index: '0',
  });

  const appendResponse = await proxyFetch(appendUrl, {
    method: 'POST',
    headers: {
      ...appendHeaders,
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    },
    body: new Uint8Array(appendBody),
  });

  if (!appendResponse.ok && appendResponse.status !== 204) {
    console.warn(`[X] Media APPEND failed: ${appendResponse.statusText}`);
    return null;
  }

  // FINALIZE
  const finalizeParams = {
    command: 'FINALIZE',
    media_id: mediaId,
  };

  const finalizeHeaders = buildOAuth1Headers('POST', initUrl, creds, finalizeParams);
  const finalizeResponse = await proxyFetch(initUrl, {
    method: 'POST',
    headers: {
      ...finalizeHeaders,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(finalizeParams).toString(),
  });

  if (!finalizeResponse.ok) {
    console.warn(`[X] Media FINALIZE failed: ${finalizeResponse.statusText}`);
    return null;
  }

  const finalizeData = (await finalizeResponse.json()) as XMediaResponse;

  // Poll for processing if needed (videos)
  if (finalizeData.processing_info) {
    await pollMediaProcessing(mediaId, creds);
  }

  return mediaId;
}

/**
 * Poll media processing status until complete.
 */
async function pollMediaProcessing(
  mediaId: string,
  creds: OAuth1Creds,
  maxAttempts: number = 30
): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    const statusUrl = `${X_UPLOAD_BASE}/media/upload.json?command=STATUS&media_id=${mediaId}`;
    const headers = buildOAuth1Headers('GET', statusUrl, creds);

    const response = await proxyFetch(statusUrl, { headers });
    const data = (await response.json()) as XMediaStatusResponse;

    if (!data.processing_info) return; // Done

    if (data.processing_info.state === 'succeeded') return;

    if (data.processing_info.state === 'failed') {
      throw new Error(
        `Media processing failed: ${data.processing_info.error?.message || 'unknown error'}`
      );
    }

    const waitSecs = data.processing_info.check_after_secs || 5;
    await sleep(waitSecs * 1000);
  }
}

// ============ OAuth 1.0a Signing ============

/**
 * Build OAuth 1.0a Authorization header using HMAC-SHA1.
 */
function buildOAuth1Headers(
  method: string,
  url: string,
  creds: OAuth1Creds,
  extraParams?: Record<string, string>
): Record<string, string> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomUUID().replace(/-/g, '');

  const oauthParams: Record<string, string> = {
    oauth_consumer_key: creds.consumerKey,
    oauth_nonce: nonce,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: timestamp,
    oauth_token: creds.accessToken,
    oauth_version: '1.0',
  };

  // Combine oauth params with any extra params for signature base
  const allParams = { ...oauthParams, ...(extraParams ?? {}) };

  // Parse URL to separate base URL from query params
  const urlObj = new URL(url);
  for (const [key, value] of urlObj.searchParams) {
    allParams[key] = value;
  }
  const baseUrl = `${urlObj.origin}${urlObj.pathname}`;

  // Sort and encode
  const paramString = Object.keys(allParams)
    .sort()
    .map((key) => `${percentEncode(key)}=${percentEncode(allParams[key])}`)
    .join('&');

  const signatureBase = `${method.toUpperCase()}&${percentEncode(baseUrl)}&${percentEncode(paramString)}`;
  const signingKey = `${percentEncode(creds.consumerSecret)}&${percentEncode(creds.accessTokenSecret)}`;
  const signature = crypto.createHmac('sha1', signingKey).update(signatureBase).digest('base64');

  oauthParams.oauth_signature = signature;

  const authHeader =
    'OAuth ' +
    Object.keys(oauthParams)
      .sort()
      .map((key) => `${percentEncode(key)}="${percentEncode(oauthParams[key])}"`)
      .join(', ');

  return { Authorization: authHeader };
}

/** RFC 3986 percent encoding */
function percentEncode(str: string): string {
  return encodeURIComponent(str).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

/** Build multipart form body for media upload */
function buildMultipartBody(
  boundary: string,
  mediaId: string,
  fileBuffer: Buffer,
  mimeType: string
): Buffer {
  const parts: Buffer[] = [];

  // command field
  parts.push(
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="command"\r\n\r\nAPPEND\r\n`)
  );
  // media_id field
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="media_id"\r\n\r\n${mediaId}\r\n`
    )
  );
  // segment_index field
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="segment_index"\r\n\r\n0\r\n`
    )
  );
  // media_data field
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="media_data"; filename="media"\r\nContent-Type: ${mimeType}\r\n\r\n`
    )
  );
  parts.push(fileBuffer);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));

  return Buffer.concat(parts);
}

/** Determine MIME type from file extension */
function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes: Record<string, string> = {
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.gif': 'image/gif',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
