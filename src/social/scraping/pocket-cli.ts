/**
 * Pocket CLI - Wrapper for the `pocket` Go binary
 *
 * Calls pocket as a subprocess and parses JSON output.
 * Handles YouTube, Reddit, and Twitter scraping.
 */

import { execFile } from 'node:child_process';

const LOG_PREFIX = '[pocket-cli]';
const POCKET_BIN = 'pocket';

// ── Shared types ──

export interface ContentResult {
  platform: string;
  externalId: string;
  url: string;
  title: string;
  caption: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  creatorUsername: string;
  createdAt?: string;
  tags?: string[];
  contentType?: string;
  mediaUrls?: string[];
}

export interface YouTubeVideo {
  id: string;
  title: string;
  description: string;
  url: string;
  channelId: string;
  channelTitle: string;
  publishedAt: string;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  duration: string;
  thumbnailUrl: string;
}

export interface YouTubeChannel {
  id: string;
  title: string;
  description: string;
  url: string;
  subscriberCount: number;
  videoCount: number;
  viewCount: number;
  thumbnailUrl: string;
}

export interface YouTubeComment {
  id: string;
  text: string;
  authorName: string;
  authorChannelId: string;
  likeCount: number;
  publishedAt: string;
  replyCount: number;
}

export interface RedditPost {
  id: string;
  title: string;
  selftext: string;
  url: string;
  subreddit: string;
  author: string;
  score: number;
  upvoteRatio: number;
  numComments: number;
  createdUtc: number;
  permalink: string;
}

export interface RedditComment {
  id: string;
  body: string;
  author: string;
  score: number;
  createdUtc: number;
  parentId: string;
  depth: number;
}

export interface TwitterProfile {
  id: string;
  username: string;
  displayName: string;
  followersCount: number;
  followingCount: number;
  tweetCount: number;
  bio: string;
  profileImageUrl: string;
}

export interface TweetResult {
  id: string;
  text: string;
  createdAt: string;
}

// ── Subprocess runner ──

interface SubprocessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function runSubprocess(
  bin: string,
  args: string[],
  options?: { timeout?: number }
): Promise<SubprocessResult> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      bin,
      args,
      { timeout: options?.timeout ?? 60_000, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error && 'code' in error && error.code === 'ENOENT') {
          reject(new Error(`"${bin}" binary not found (ENOENT)`));
          return;
        }
        resolve({
          exitCode:
            error?.code != null && typeof error.code === 'number'
              ? error.code
              : (child.exitCode ?? 0),
          stdout: stdout ?? '',
          stderr: stderr ?? '',
        });
      }
    );
  });
}

// ── Error helpers ──

const NOT_FOUND_MESSAGE =
  `"${POCKET_BIN}" binary not found. Ensure "pocket" is on your PATH.`;

function isPocketNotFound(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    return msg.includes('enoent') || msg.includes('not found') || msg.includes('failed to spawn');
  }
  return false;
}

// ── JSON parsing ──

/**
 * Parse pocket-cli output, handling the `{success, data}` wrapper format.
 * Falls back to raw parsing if the wrapper is absent.
 */
function parsePocketOutput<T>(raw: string): T {
  const parsed: unknown = JSON.parse(raw);
  if (parsed && typeof parsed === 'object' && 'success' in (parsed as Record<string, unknown>)) {
    const wrapper = parsed as { success: boolean; data: T; error?: { message?: string } };
    if (!wrapper.success) {
      const errMsg = wrapper.error?.message ?? 'CLI command failed';
      throw new Error(String(errMsg));
    }
    return wrapper.data;
  }
  return parsed as T;
}

function parseContentResults(raw: string, platform: string): ContentResult[] {
  let data: unknown;
  try {
    data = parsePocketOutput<unknown>(raw);
  } catch (err) {
    console.warn(`${LOG_PREFIX} Failed to parse JSON output:`, (err as Error).message);
    return [];
  }

  const items = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
  return items.map((item) => ({
    platform,
    externalId: String(item.id ?? item.externalId ?? ''),
    url: String(item.url ?? item.link ?? ''),
    title: String(item.title ?? ''),
    caption: String(item.caption ?? item.description ?? item.text ?? ''),
    views: Number(item.views ?? item.viewCount ?? 0),
    likes: Number(item.likes ?? item.likeCount ?? 0),
    comments: Number(item.comments ?? item.commentCount ?? 0),
    shares: Number(item.shares ?? item.shareCount ?? 0),
    creatorUsername: String(item.creatorUsername ?? item.author ?? item.username ?? ''),
  }));
}

// ── Generic runners ──

/** Run a pocket CLI command. Throws on failure. Use for single-item fetches. */
async function runPocket<T>(args: string[], label: string, timeout?: number): Promise<T> {
  try {
    const result = await runSubprocess(POCKET_BIN, args, timeout ? { timeout } : undefined);
    if (result.exitCode !== 0) {
      throw new Error(`${label} failed (exit ${result.exitCode}): ${result.stderr}`);
    }
    return parsePocketOutput<T>(result.stdout);
  } catch (err) {
    if (isPocketNotFound(err)) {
      throw new Error(NOT_FOUND_MESSAGE, { cause: err });
    }
    throw err;
  }
}

/** Run a pocket CLI command that returns a content list. Returns [] on failure. */
async function runPocketList(
  args: string[],
  platform: string,
  label: string
): Promise<ContentResult[]> {
  try {
    const result = await runSubprocess(POCKET_BIN, args);
    if (result.exitCode !== 0) {
      console.error(`${LOG_PREFIX} ${label} failed (exit ${result.exitCode}):`, result.stderr);
      return [];
    }
    return parseContentResults(result.stdout, platform);
  } catch (err) {
    if (isPocketNotFound(err)) {
      throw new Error(NOT_FOUND_MESSAGE, { cause: err });
    }
    throw err;
  }
}

// ── YouTube ──

export async function searchYouTube(query: string, limit: number = 10): Promise<ContentResult[]> {
  console.log(`${LOG_PREFIX} Searching YouTube: "${query}" (limit ${limit})`);
  return runPocketList(
    ['social', 'youtube', 'search', query, '--limit', String(limit)],
    'youtube',
    'YouTube search'
  );
}

export async function getYouTubeVideo(id: string): Promise<YouTubeVideo> {
  console.log(`${LOG_PREFIX} Fetching YouTube video: ${id}`);
  return runPocket<YouTubeVideo>(['social', 'youtube', 'video', id], 'YouTube video fetch');
}

export async function getYouTubeChannel(idOrHandle: string): Promise<YouTubeChannel> {
  console.log(`${LOG_PREFIX} Fetching YouTube channel: ${idOrHandle}`);
  return runPocket<YouTubeChannel>(
    ['social', 'youtube', 'channel', idOrHandle],
    'YouTube channel fetch'
  );
}

export async function getYouTubeChannelVideos(
  channelId: string,
  limit: number = 20
): Promise<ContentResult[]> {
  console.log(`${LOG_PREFIX} Fetching YouTube channel videos: ${channelId} (limit ${limit})`);
  return runPocketList(
    ['social', 'youtube', 'videos', channelId, '--limit', String(limit)],
    'youtube',
    'YouTube channel videos'
  );
}

export async function getYouTubeTrending(
  region?: string,
  category?: number
): Promise<ContentResult[]> {
  console.log(
    `${LOG_PREFIX} Fetching YouTube trending (region=${region ?? 'default'}, category=${category ?? 'default'})`
  );
  const args = ['social', 'youtube', 'trending'];
  if (region) args.push('--region', region);
  if (category !== undefined) args.push('--category', String(category));
  return runPocketList(args, 'youtube', 'YouTube trending');
}

export async function getYouTubeComments(
  videoId: string,
  limit: number = 50
): Promise<YouTubeComment[]> {
  console.log(`${LOG_PREFIX} Fetching YouTube comments: ${videoId} (limit ${limit})`);
  return runPocket<YouTubeComment[]>(
    ['social', 'youtube', 'comments', videoId, '--limit', String(limit)],
    'YouTube comments fetch'
  );
}

// ── Reddit ──

export async function searchReddit(
  query: string,
  options?: { subreddit?: string; sort?: string; time?: string; limit?: number }
): Promise<ContentResult[]> {
  console.log(`${LOG_PREFIX} Searching Reddit: "${query}"`);
  const args = ['social', 'reddit', 'search', query];
  if (options?.subreddit) args.push('--subreddit', options.subreddit);
  if (options?.sort) args.push('--sort', options.sort);
  if (options?.time) args.push('--time', options.time);
  if (options?.limit) args.push('--limit', String(options.limit));
  return runPocketList(args, 'reddit', 'Reddit search');
}

export async function getRedditSubreddit(
  name: string,
  sort?: string,
  limit: number = 25
): Promise<ContentResult[]> {
  console.log(
    `${LOG_PREFIX} Fetching subreddit: r/${name} (sort=${sort ?? 'hot'}, limit ${limit})`
  );
  const args = ['social', 'reddit', 'subreddit', name];
  if (sort) args.push('--sort', sort);
  args.push('--limit', String(limit));
  return runPocketList(args, 'reddit', 'Reddit subreddit');
}

export async function getRedditComments(postId: string): Promise<RedditComment[]> {
  console.log(`${LOG_PREFIX} Fetching Reddit comments: ${postId}`);
  return runPocket<RedditComment[]>(
    ['social', 'reddit', 'comments', postId],
    'Reddit comments fetch'
  );
}

// ── Twitter ──

export async function getTwitterTimeline(limit: number = 20): Promise<ContentResult[]> {
  console.log(`${LOG_PREFIX} Fetching Twitter timeline (limit ${limit})`);
  return runPocketList(
    ['social', 'twitter', 'timeline', '--limit', String(limit)],
    'twitter',
    'Twitter timeline'
  );
}

export async function getTwitterProfile(): Promise<TwitterProfile> {
  console.log(`${LOG_PREFIX} Fetching Twitter profile`);
  return runPocket<TwitterProfile>(['social', 'twitter', 'me'], 'Twitter profile fetch');
}

// ── Utility ──

export async function downloadVideo(url: string, outputDir: string): Promise<string> {
  console.log(`${LOG_PREFIX} Downloading video: ${url} -> ${outputDir}`);

  try {
    const result = await runSubprocess(
      POCKET_BIN,
      ['utility', 'video', 'download', url, '--output', outputDir],
      { timeout: 120_000 }
    );

    if (result.exitCode !== 0) {
      throw new Error(`Video download failed (exit ${result.exitCode}): ${result.stderr}`);
    }

    // pocket-cli outputs the file path on stdout
    const outputPath = result.stdout.trim().split('\n').pop() ?? '';
    if (!outputPath) {
      throw new Error('Video download produced no output path');
    }

    return outputPath;
  } catch (err) {
    if (isPocketNotFound(err)) {
      throw new Error(NOT_FOUND_MESSAGE, { cause: err });
    }
    throw err;
  }
}
