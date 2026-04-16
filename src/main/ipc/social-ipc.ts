import { ipcMain, dialog, app } from 'electron';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import Anthropic from '@anthropic-ai/sdk';
import { proxyFetch } from '../../utils/proxy-fetch';
import { SettingsManager } from '../../settings';
import { searchContent, downloadVideo } from '../../social/scraping/index';
import { KieClient } from '../../image';
import type { ImageModelId } from '../../image';
import type { ImageJobTracker } from '../../image';
import type { ScrapingPlatform } from '../../social/scraping/index';
import type { GeneratedContentType } from '../../memory/generated-content';
import type { SocialPostStatus, UpdateSocialPostInput } from '../../memory/social-posts';
import { detectTrends } from '../../social/scoring/trend-detect';
import { repurposePrompt, refinePrompt } from '../../social/content/prompts';
import { transcribeContent } from '../../social/transcription/assemblyai';
import { finalizeDraft } from '../../social/content/finalize';
import type { TrendStatusValue } from '../../memory/trends';
import type { IPCDependencies } from './types';
import { getCurrentSessionId } from '../../tools/session-context';

export function registerSocialIpc(deps: IPCDependencies, tracker?: ImageJobTracker): void {
  const { getMemory } = deps;

  // ============ Account CRUD ============

  ipcMain.handle('social:listAccounts', async () => {
    try {
      const memory = getMemory();
      if (!memory) return [];
      const accounts = memory.socialAccounts.getAll();
      return accounts.map((account) => ({
        id: account.id,
        platform: account.platform,
        account_name: account.account_name,
        display_name: account.display_name,
        active: account.active,
        hasCredentials: !!(account.access_token || account.metadata),
        created_at: account.created_at,
        updated_at: account.updated_at,
      }));
    } catch (err) {
      console.error('[SocialIPC] listAccounts error:', err);
      return [];
    }
  });

  ipcMain.handle('social:getAccount', async (_, id: string) => {
    try {
      const memory = getMemory();
      if (!memory) return null;
      return memory.socialAccounts.getById(id);
    } catch (err) {
      console.error('[SocialIPC] getAccount error:', err);
      return null;
    }
  });

  ipcMain.handle(
    'social:addAccount',
    async (
      _,
      input: {
        platform: string;
        account_name: string;
        display_name?: string | null;
        access_token?: string | null;
        refresh_token?: string | null;
        metadata?: string | null;
      }
    ) => {
      try {
        const memory = getMemory();
        if (!memory) return { success: false, error: 'Memory not initialized' };
        const account = memory.socialAccounts.create(input);
        return { success: true, id: account.id };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[SocialIPC] addAccount error:', err);
        return { success: false, error: message };
      }
    }
  );

  ipcMain.handle(
    'social:updateAccount',
    async (
      _,
      id: string,
      updates: {
        platform?: string;
        account_name?: string;
        display_name?: string | null;
        access_token?: string | null;
        refresh_token?: string | null;
        token_expires_at?: string | null;
        scopes?: string | null;
        metadata?: string | null;
        active?: boolean;
      }
    ) => {
      try {
        const memory = getMemory();
        if (!memory) return { success: false, error: 'Memory not initialized' };
        memory.socialAccounts.update(id, updates ?? {});
        return { success: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[SocialIPC] updateAccount error:', err);
        return { success: false, error: message };
      }
    }
  );

  ipcMain.handle('social:removeAccount', async (_, id: string) => {
    try {
      const memory = getMemory();
      if (!memory) return { success: false, error: 'Memory not initialized' };
      memory.socialAccounts.delete(id);
      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[SocialIPC] removeAccount error:', err);
      return { success: false, error: message };
    }
  });

  // ============ Scraping Key Validation ============

  ipcMain.handle('social:validateApifyKey', async (_, apiKey: string) => {
    try {
      const trimmed = (apiKey || '').trim() || SettingsManager.get('apify.apiKey') || '';
      if (!trimmed) return { valid: false, error: 'API key is empty' };
      // Apify supports both Bearer token and ?token= query param — use query param as it's more reliable
      const response = await proxyFetch(
        `https://api.apify.com/v2/users/me?token=${encodeURIComponent(trimmed)}`
      );
      console.log(`[SocialIPC] Apify validation response: ${response.status}`);
      if (response.ok) {
        return { valid: true };
      }
      const text = await response.text().catch(() => response.statusText);
      console.warn(`[SocialIPC] Apify validation failed: ${response.status} ${text}`);
      return { valid: false, error: text || `HTTP ${response.status}` };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[SocialIPC] validateApifyKey error:', message);
      return { valid: false, error: message };
    }
  });

  ipcMain.handle('social:validateRapidAPIKey', async (_, apiKey: string) => {
    try {
      const resolvedKey = (apiKey || '').trim() || SettingsManager.get('rapidapi.apiKey') || '';
      if (!resolvedKey) return { valid: false, error: 'API key is empty' };
      const response = await proxyFetch(
        'https://tiktok-scraper7.p.rapidapi.com/user/info?unique_id=tiktok',
        {
          headers: {
            'X-RapidAPI-Key': resolvedKey,
            'X-RapidAPI-Host': 'tiktok-scraper7.p.rapidapi.com',
          },
        }
      );
      // RapidAPI returns 403 for invalid keys and 200/other for valid ones
      if (response.status !== 403 && response.status !== 401) {
        return { valid: true };
      }
      const text = await response.text().catch(() => response.statusText);
      return { valid: false, error: text || `HTTP ${response.status}` };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[SocialIPC] validateRapidAPIKey error:', err);
      return { valid: false, error: message };
    }
  });

  // ============ Kie.ai Validation ============

  ipcMain.handle('social:validateKieKey', async (_, apiKey: string) => {
    try {
      const trimmed = (apiKey || '').trim() || SettingsManager.get('kie.apiKey') || '';
      if (!trimmed) return { valid: false, error: 'API key is empty' };
      // Use the recordInfo endpoint with a dummy taskId — a valid key returns a
      // structured JSON response (code !== 200 but well-formed), whereas an
      // invalid key returns 401/403.
      const response = await proxyFetch(
        `https://api.kie.ai/api/v1/jobs/recordInfo?taskId=validation-check`,
        {
          method: 'GET',
          headers: { Authorization: `Bearer ${trimmed}` },
        }
      );
      console.log(`[SocialIPC] Kie validation response: ${response.status}`);
      // 401/403 means invalid key; anything else (200, 400, etc.) means the key is accepted
      if (response.status === 401 || response.status === 403) {
        return { valid: false, error: 'Invalid API key' };
      }
      return { valid: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[SocialIPC] validateKieKey error:', err);
      return { valid: false, error: message };
    }
  });

  // ============ AssemblyAI Validation ============

  ipcMain.handle('social:validateAssemblyKey', async (_, apiKey: string) => {
    try {
      const trimmed = (apiKey || '').trim() || SettingsManager.get('assembly.apiKey') || '';
      if (!trimmed) return { valid: false, error: 'API key is empty' };

      // Validate via REST API — lightweight auth check (no external deps needed)
      const res = await proxyFetch('https://api.assemblyai.com/v2/transcript?limit=1', {
        headers: { authorization: trimmed },
      });
      if (res.ok) return { valid: true };

      const body = await res.json().catch(() => null);
      const errMsg =
        (body as Record<string, unknown>)?.error ?? `HTTP ${res.status}`;
      return { valid: false, error: String(errMsg) };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[SocialIPC] validateAssemblyKey error:', err);
      return { valid: false, error: message };
    }
  });

  // ============ Brand Voice ============

  ipcMain.handle('social:saveBrand', async (_, brandData: unknown) => {
    try {
      SettingsManager.set('social.brand', JSON.stringify(brandData));
      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[SocialIPC] saveBrand error:', err);
      return { success: false, error: message };
    }
  });

  ipcMain.handle('social:getBrand', async () => {
    try {
      const raw = SettingsManager.get('social.brand');
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (err) {
      console.error('[SocialIPC] getBrand error:', err);
      return null;
    }
  });

  // ============ Content Discovery ============

  ipcMain.handle('social:searchContent', async (_, query: string, platform?: string) => {
    try {
      const results = await searchContent((platform ?? 'youtube') as ScrapingPlatform, query);
      return results;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[SocialIPC] searchContent error:', err);
      return { error: message };
    }
  });

  ipcMain.handle('social:getDiscovered', async (_, limit?: number) => {
    try {
      const memory = getMemory();
      if (!memory) return [];
      return memory.discoveredContent.getRecent(limit ?? 50);
    } catch (err) {
      console.error('[SocialIPC] getDiscovered error:', err);
      return [];
    }
  });

  ipcMain.handle(
    'social:saveDiscovered',
    async (
      _,
      input: {
        platform: string;
        content_type: string;
        social_account_id?: string | null;
        source_url?: string | null;
        source_author?: string | null;
        title?: string | null;
        body?: string | null;
        media_urls?: string | null;
        likes?: number;
        comments?: number;
        shares?: number;
        views?: number;
        tags?: string | null;
        metadata?: string | null;
      }
    ) => {
      try {
        const memory = getMemory();
        if (!memory) return { success: false, error: 'Memory not initialized' };
        const record = memory.discoveredContent.create(input);
        return { success: true, id: record.id, data: record };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[SocialIPC] saveDiscovered error:', err);
        return { success: false, error: message };
      }
    }
  );

  ipcMain.handle('social:deleteDiscovered', async (event, id: string) => {
    try {
      const memory = getMemory();
      if (!memory) return { success: false, error: 'Memory not initialized' };
      const deleted = memory.discoveredContent.delete(id);
      if (!deleted) return { success: false, error: 'Record not found' };
      event.sender.send('social:contentChanged', { action: 'deleted', id });
      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[SocialIPC] deleteDiscovered error:', err);
      return { success: false, error: message };
    }
  });

  // ============ Social Posts ============

  ipcMain.handle('social:listPosts', async (_, status?: string) => {
    try {
      const memory = getMemory();
      if (!memory) return [];
      if (status) {
        return memory.socialPosts.getByStatus(status as SocialPostStatus);
      }
      return memory.socialPosts.getAll();
    } catch (err) {
      console.error('[SocialIPC] listPosts error:', err);
      return [];
    }
  });

  ipcMain.handle(
    'social:createPost',
    async (
      event,
      input: {
        platform: string;
        content: string;
        status?: SocialPostStatus;
        social_account_id?: string | null;
        media_urls?: string | null;
        scheduled_at?: string | null;
        metadata?: string | null;
        source_content_id?: string | null;
        video_path?: string | null;
        generated_content_id?: string | null;
        media_items?: string | null;
      }
    ) => {
      try {
        const memory = getMemory();
        if (!memory) return { success: false, error: 'Memory not initialized' };
        const post = memory.socialPosts.create(input);
        event.sender.send('social:postChanged', { action: 'created', postId: post.id, platform: input.platform });
        return { success: true, id: post.id };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[SocialIPC] createPost error:', err);
        return { success: false, error: message };
      }
    }
  );

  ipcMain.handle(
    'social:updatePost',
    async (
      event,
      id: string,
      input: UpdateSocialPostInput
    ) => {
      try {
        const memory = getMemory();
        if (!memory) return { success: false, error: 'Memory not initialized' };
        const post = memory.socialPosts.update(id, input);
        if (!post) return { success: false, error: 'Post not found' };
        event.sender.send('social:postChanged', { action: 'updated', postId: post.id, platform: post.platform });
        return { success: true, data: post };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[SocialIPC] updatePost error:', err);
        return { success: false, error: message };
      }
    }
  );

  // ============ Calendar Queries ============

  ipcMain.handle(
    'social:getCalendarPosts',
    async (_, startDate: string, endDate: string) => {
      try {
        const memory = getMemory();
        if (!memory) return [];
        return memory.socialPosts.getInDateRange(startDate, endDate);
      } catch (err) {
        console.error('[SocialIPC] getCalendarPosts error:', err);
        return [];
      }
    }
  );

  ipcMain.handle(
    'social:getCalendarSummary',
    async (_, startDate: string, endDate: string) => {
      try {
        const memory = getMemory();
        if (!memory) return [];
        return memory.socialPosts.getPostCountByDay(startDate, endDate);
      } catch (err) {
        console.error('[SocialIPC] getCalendarSummary error:', err);
        return [];
      }
    }
  );

  ipcMain.handle(
    'social:reschedulePost',
    async (event, id: string, scheduledAt: string) => {
      try {
        const memory = getMemory();
        if (!memory) return { success: false, error: 'Memory not initialized' };
        const post = memory.socialPosts.updateSchedule(id, scheduledAt);
        if (!post) return { success: false, error: 'Post not found' };
        event.sender.send('social:postChanged', { action: 'rescheduled', postId: id, scheduledAt });
        return { success: true, data: post };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[SocialIPC] reschedulePost error:', err);
        return { success: false, error: message };
      }
    }
  );

  ipcMain.handle('social:deletePost', async (event, id: string) => {
    try {
      const memory = getMemory();
      if (!memory) return { success: false, error: 'Memory not initialized' };
      const deleted = memory.socialPosts.delete(id);
      if (!deleted) return { success: false, error: 'Post not found' };
      event.sender.send('social:postChanged', { action: 'deleted', postId: id });
      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[SocialIPC] deletePost error:', err);
      return { success: false, error: message };
    }
  });

  // ============ Pick Video File ============

  ipcMain.handle('social:pickVideoFile', async () => {
    try {
      const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [
          { name: 'Videos', extensions: ['mp4', 'mov', 'avi', 'mkv', 'webm'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      });
      if (result.canceled || !result.filePaths.length) {
        return { success: false, error: 'No file selected' };
      }
      const filePath = result.filePaths[0];
      const fileName = path.basename(filePath);
      return { success: true, filePath, fileName };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[SocialIPC] pickVideoFile error:', err);
      return { success: false, error: message };
    }
  });

  // ============ Pick Media Files ============

  ipcMain.handle('social:pickMediaFiles', async () => {
    try {
      const result = await dialog.showOpenDialog({
        properties: ['openFile', 'multiSelections'],
        filters: [
          {
            name: 'Media',
            extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'mp4', 'mov', 'avi', 'mkv', 'webm'],
          },
          { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] },
          { name: 'Videos', extensions: ['mp4', 'mov', 'avi', 'mkv', 'webm'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      });
      if (result.canceled || !result.filePaths.length) {
        return { success: false, error: 'No files selected' };
      }
      const imageExts = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);
      const videoExts = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm']);
      const files = result.filePaths.map((filePath) => {
        const ext = path.extname(filePath).toLowerCase();
        const type = imageExts.has(ext) ? 'image' : videoExts.has(ext) ? 'video' : 'image';
        return { filePath, fileName: path.basename(filePath), type };
      });
      return { success: true, files };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[SocialIPC] pickMediaFiles error:', err);
      return { success: false, error: message };
    }
  });

  // ============ Attach Media ============

  ipcMain.handle(
    'social:attachMedia',
    async (_, input: { draft_id: string; files: Array<{ filePath: string; type: string; fileName: string }> }) => {
      try {
        const memory = getMemory();
        if (!memory) return { success: false, error: 'Memory not initialized' };

        const post = memory.socialPosts.getById(input.draft_id);
        if (!post) return { success: false, error: 'Draft not found' };

        const dateDir = new Date().toISOString().slice(0, 10);
        const mediaDir = path.join(app.getPath('userData'), 'media', dateDir);
        fs.mkdirSync(mediaDir, { recursive: true });

        // Parse existing media items
        let existingItems: Array<{ path: string; type: string; name: string }> = [];
        if (post.media_items) {
          try {
            existingItems = JSON.parse(post.media_items);
          } catch {
            existingItems = [];
          }
        }

        const newItems: Array<{ path: string; type: string; name: string }> = [];
        for (const file of input.files) {
          if (!fs.existsSync(file.filePath)) continue;
          const ext = path.extname(file.filePath);
          const destName = `${crypto.randomUUID()}${ext}`;
          const destPath = path.join(mediaDir, destName);
          fs.copyFileSync(file.filePath, destPath);
          newItems.push({ path: destPath, type: file.type, name: file.fileName });
        }

        const allItems = [...existingItems, ...newItems];
        const updated = memory.socialPosts.update(input.draft_id, {
          media_items: JSON.stringify(allItems),
        });
        return { success: true, data: updated };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[SocialIPC] attachMedia error:', err);
        return { success: false, error: message };
      }
    }
  );

  // ============ Draft Management ============

  ipcMain.handle(
    'social:uploadVideo',
    async (_, input: { draft_id: string; file_path: string }) => {
      try {
        const memory = getMemory();
        if (!memory) return { success: false, error: 'Memory not initialized' };

        const post = memory.socialPosts.getById(input.draft_id);
        if (!post) return { success: false, error: 'Draft not found' };

        if (!fs.existsSync(input.file_path)) {
          return { success: false, error: 'File not found' };
        }

        const ext = path.extname(input.file_path);
        const dateDir = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
        const videoDir = path.join(app.getPath('userData'), 'videos', dateDir);
        fs.mkdirSync(videoDir, { recursive: true });

        const destName = `${crypto.randomUUID()}${ext}`;
        const destPath = path.join(videoDir, destName);
        fs.copyFileSync(input.file_path, destPath);

        const updated = memory.socialPosts.update(input.draft_id, { video_path: destPath });
        return { success: true, data: updated };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[SocialIPC] uploadVideo error:', err);
        return { success: false, error: message };
      }
    }
  );

  // ============ Cold Upload ============

  ipcMain.handle(
    'social:coldUpload',
    async (
      event,
      input: { file_path: string; platform: string }
    ) => {
      try {
        const memory = getMemory();
        if (!memory) return { success: false, error: 'Memory not initialized' };

        if (!fs.existsSync(input.file_path)) {
          return { success: false, error: 'File not found' };
        }

        // 1. Copy video to app storage
        const ext = path.extname(input.file_path);
        const dateDir = new Date().toISOString().slice(0, 10);
        const videoDir = path.join(app.getPath('userData'), 'videos', dateDir);
        fs.mkdirSync(videoDir, { recursive: true });

        const destName = `${crypto.randomUUID()}${ext}`;
        const destPath = path.join(videoDir, destName);
        fs.copyFileSync(input.file_path, destPath);

        // 2. Transcribe
        console.log(`[SocialIPC] coldUpload: transcribing ${destPath}`);
        const transcription = await transcribeContent(destPath);

        // 3. Finalize — generate copy/hashtags/captions via Claude
        const brand = memory.brandConfig.getActive();
        console.log(`[SocialIPC] coldUpload: finalizing for ${input.platform}`);
        const finalized = await finalizeDraft(transcription.text, input.platform, brand);

        // 4. Build content with hashtags
        const hashtagStr = finalized.hashtags.length
          ? '\n\n' + finalized.hashtags.map((h) => (h.startsWith('#') ? h : `#${h}`)).join(' ')
          : '';
        const content = finalized.copy + hashtagStr;

        // 5. Create draft
        const post = memory.socialPosts.create({
          platform: input.platform,
          status: 'draft',
          content,
          video_path: destPath,
          transcript: transcription.text,
          metadata: JSON.stringify({
            captions: finalized.captions,
            hashtags: finalized.hashtags,
            duration: transcription.duration,
            language: transcription.language,
          }),
        });

        event.sender.send('social:postChanged', {
          action: 'created',
          postId: post.id,
          platform: input.platform,
        });

        return { success: true, data: post };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[SocialIPC] coldUpload error:', err);
        return { success: false, error: message };
      }
    }
  );

  // ============ Generate From Video ============

  ipcMain.handle(
    'social:generateFromVideo',
    async (event, input: { draft_id: string }) => {
      try {
        const memory = getMemory();
        if (!memory) return { success: false, error: 'Memory not initialized' };

        const post = memory.socialPosts.getById(input.draft_id);
        if (!post) return { success: false, error: 'Draft not found' };
        if (!post.video_path) return { success: false, error: 'Draft has no video attached' };

        // 1. Transcribe
        event.sender.send('social:videoProgress', {
          draftId: input.draft_id,
          step: 'transcribing',
          percent: 0,
        });

        console.log(`[SocialIPC] generateFromVideo: transcribing ${post.video_path}`);
        const transcription = await transcribeContent(post.video_path);

        event.sender.send('social:videoProgress', {
          draftId: input.draft_id,
          step: 'transcribing',
          percent: 100,
        });

        // 2. Generate copy
        event.sender.send('social:videoProgress', {
          draftId: input.draft_id,
          step: 'generating',
          percent: 0,
        });

        const brand = memory.brandConfig.getActive();
        console.log(`[SocialIPC] generateFromVideo: finalizing for ${post.platform}`);
        const finalized = await finalizeDraft(transcription.text, post.platform, brand);

        const hashtagStr = finalized.hashtags.length
          ? '\n\n' + finalized.hashtags.map((h) => (h.startsWith('#') ? h : `#${h}`)).join(' ')
          : '';
        const content = finalized.copy + hashtagStr;

        // 3. Update draft
        const updated = memory.socialPosts.update(input.draft_id, {
          content,
          transcript: transcription.text,
          metadata: JSON.stringify({
            captions: finalized.captions,
            hashtags: finalized.hashtags,
            duration: transcription.duration,
            language: transcription.language,
          }),
        });

        event.sender.send('social:videoProgress', {
          draftId: input.draft_id,
          step: 'complete',
          percent: 100,
        });

        event.sender.send('social:postChanged', {
          action: 'updated',
          postId: input.draft_id,
          platform: post.platform,
        });

        return { success: true, data: updated };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[SocialIPC] generateFromVideo error:', err);
        event.sender.send('social:videoProgress', {
          draftId: input.draft_id,
          step: 'error',
          percent: 0,
        });
        return { success: false, error: message };
      }
    }
  );

  // ============ Refine with Video ============

  ipcMain.handle(
    'social:refineWithVideo',
    async (_, input: { draft_id: string }) => {
      try {
        const memory = getMemory();
        if (!memory) return { success: false, error: 'Memory not initialized' };

        const post = memory.socialPosts.getById(input.draft_id);
        if (!post) return { success: false, error: 'Draft not found' };
        if (!post.content) return { success: false, error: 'Draft has no content to refine' };
        if (!post.video_path) return { success: false, error: 'Draft has no video attached' };

        // Get or create transcript
        let transcript = post.transcript;
        if (!transcript) {
          console.log(`[SocialIPC] refineWithVideo: transcribing ${post.video_path}`);
          const result = await transcribeContent(post.video_path);
          transcript = result.text;
          // Persist transcript on the post
          memory.socialPosts.update(input.draft_id, { transcript });
        }

        if (!transcript) return { success: false, error: 'Transcription produced no text' };

        // Build refine prompt with optional brand config
        const brand = memory.brandConfig.getActive();
        const prompt = refinePrompt({
          existingCopy: post.content,
          transcript,
          platform: post.platform,
          ...(brand && {
            brandVoice: brand.voice ?? undefined,
            brandTone: brand.tone ?? undefined,
            targetAudience: brand.target_audience ?? undefined,
            themes: brand.themes ? brand.themes.split(',').map((t) => t.trim()) : undefined,
          }),
        });

        const apiKey = SettingsManager.get('anthropic.apiKey');
        if (!apiKey) return { success: false, error: 'Anthropic API key not configured' };

        const model = SettingsManager.get('agent.model') || 'claude-3-5-haiku-20241022';
        const client = new Anthropic({ apiKey });
        const response = await client.messages.create({
          model,
          max_tokens: 1024,
          messages: [{ role: 'user', content: prompt }],
        });

        const output = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('\n')
          .trim();

        let refinedCopy: string;
        try {
          const parsed = JSON.parse(output) as { copy?: string };
          refinedCopy = parsed.copy || output;
        } catch {
          refinedCopy = output;
        }

        return {
          success: true,
          originalCopy: post.content,
          refinedCopy,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[SocialIPC] refineWithVideo error:', err);
        return { success: false, error: message };
      }
    }
  );

  ipcMain.handle('social:getDrafts', async (_, platform?: string) => {
    try {
      const memory = getMemory();
      if (!memory) return [];
      let drafts = memory.socialPosts.getByStatus('draft');
      if (platform) {
        drafts = drafts.filter((d) => d.platform === platform);
      }
      // Sort by updated_at descending
      drafts.sort((a, b) => (b.updated_at > a.updated_at ? 1 : b.updated_at < a.updated_at ? -1 : 0));
      return drafts;
    } catch (err) {
      console.error('[SocialIPC] getDrafts error:', err);
      return [];
    }
  });

  ipcMain.handle(
    'social:updateDraft',
    async (
      _,
      id: string,
      updates: { content?: string; metadata?: string | null; platform?: string; media_urls?: string | null }
    ) => {
      try {
        const memory = getMemory();
        if (!memory) return { success: false, error: 'Memory not initialized' };
        const post = memory.socialPosts.getById(id);
        if (!post) return { success: false, error: 'Draft not found' };
        if (post.status !== 'draft') return { success: false, error: 'Post is not a draft' };
        const updated = memory.socialPosts.update(id, updates);
        return { success: true, data: updated };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[SocialIPC] updateDraft error:', err);
        return { success: false, error: message };
      }
    }
  );

  ipcMain.handle('social:deleteDraft', async (_, id: string) => {
    try {
      const memory = getMemory();
      if (!memory) return { success: false, error: 'Memory not initialized' };
      const post = memory.socialPosts.getById(id);
      if (!post) return { success: false, error: 'Draft not found' };
      if (post.status !== 'draft') return { success: false, error: 'Post is not a draft' };
      const deleted = memory.socialPosts.delete(id);
      if (!deleted) return { success: false, error: 'Failed to delete' };
      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[SocialIPC] deleteDraft error:', err);
      return { success: false, error: message };
    }
  });

  // ============ Generated Content ============

  ipcMain.handle('social:getGenerated', async (_, limit?: number) => {
    try {
      const memory = getMemory();
      if (!memory) return [];
      const all = memory.generatedContent.getAll();
      return limit ? all.slice(0, limit) : all;
    } catch (err) {
      console.error('[SocialIPC] getGenerated error:', err);
      return [];
    }
  });

  ipcMain.handle('social:deleteGenerated', async (_, id: string) => {
    try {
      const memory = getMemory();
      if (!memory) return { success: false, error: 'Memory not initialized' };
      const deleted = memory.generatedContent.delete(id);
      if (!deleted) return { success: false, error: 'Record not found' };
      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[SocialIPC] deleteGenerated error:', err);
      return { success: false, error: message };
    }
  });

  ipcMain.handle('social:bulkDeleteGenerated', async (_, ids: string[]) => {
    try {
      const memory = getMemory();
      if (!memory) return { success: false, error: 'Memory not initialized' };
      if (!Array.isArray(ids) || ids.length === 0)
        return { success: false, error: 'No IDs provided' };
      let deleted = 0;
      for (const id of ids) {
        if (memory.generatedContent.delete(id)) deleted++;
      }
      return { success: true, deleted };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[SocialIPC] bulkDeleteGenerated error:', err);
      return { success: false, error: message };
    }
  });

  ipcMain.handle('social:favoriteGenerated', async (_, id: string, rating: number) => {
    try {
      const memory = getMemory();
      if (!memory) return { success: false, error: 'Memory not initialized' };
      const updated = memory.generatedContent.update(id, { rating });
      if (!updated) return { success: false, error: 'Record not found' };
      return { success: true, data: updated };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[SocialIPC] favoriteGenerated error:', err);
      return { success: false, error: message };
    }
  });

  // ============ Gallery Grouped Query ============

  ipcMain.handle('social:getGalleryGrouped', async () => {
    try {
      const memory = getMemory();
      if (!memory) return [];
      const all = memory.generatedContent.getAll();

      // Group carousel items by group_id, leave others as singles
      const groupMap = new Map<string, typeof all>();
      const result: Array<
        | { type: 'single'; item: (typeof all)[0] }
        | { type: 'carousel'; group_id: string; slides: typeof all; item: (typeof all)[0] }
      > = [];
      const seenGroups = new Set<string>();

      for (const item of all) {
        if (item.group_id) {
          if (!groupMap.has(item.group_id)) {
            groupMap.set(item.group_id, []);
          }
          groupMap.get(item.group_id)!.push(item);
        } else {
          result.push({ type: 'single', item });
        }
      }

      // Insert carousel groups at the position of their first slide (by created_at DESC order)
      // Re-walk to preserve ordering
      const finalResult: typeof result = [];
      for (const item of all) {
        if (item.group_id) {
          if (!seenGroups.has(item.group_id)) {
            seenGroups.add(item.group_id);
            const slides = groupMap.get(item.group_id)!;
            finalResult.push({
              type: 'carousel',
              group_id: item.group_id,
              slides,
              item: slides[0],
            });
          }
        } else {
          finalResult.push({ type: 'single', item });
        }
      }

      return finalResult;
    } catch (err) {
      console.error('[SocialIPC] getGalleryGrouped error:', err);
      return [];
    }
  });

  // ============ Carousel Zip Download ============

  ipcMain.handle('social:downloadCarousel', async (_, groupId: string) => {
    try {
      const memory = getMemory();
      if (!memory) return { success: false, error: 'Memory not initialized' };

      const slides = memory.generatedContent.getByGroup(groupId);
      if (slides.length === 0) return { success: false, error: 'No slides found for group' };

      const { canceled, filePath: savePath } = await dialog.showSaveDialog({
        title: 'Save Carousel',
        defaultPath: path.join(app.getPath('downloads'), `carousel-${groupId.slice(0, 8)}.zip`),
        filters: [{ name: 'ZIP Archive', extensions: ['zip'] }],
      });

      if (canceled || !savePath) return { success: false, error: 'Cancelled' };

      // Build zip using raw zip format (no external deps)
      const files: Array<{ name: string; data: Buffer }> = [];
      for (let i = 0; i < slides.length; i++) {
        const mediaPath = slides[i].media_url;
        if (!mediaPath || !fs.existsSync(mediaPath)) continue;
        const ext = path.extname(mediaPath) || '.png';
        files.push({
          name: `slide-${String(i + 1).padStart(2, '0')}${ext}`,
          data: fs.readFileSync(mediaPath),
        });
      }

      if (files.length === 0) return { success: false, error: 'No slide files found on disk' };

      // Minimal ZIP archive (store, no compression — images are already compressed)
      const zipBuffer = buildZipArchive(files);
      fs.writeFileSync(savePath, zipBuffer);

      return { success: true, filePath: savePath, slides: files.length };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[SocialIPC] downloadCarousel error:', err);
      return { success: false, error: message };
    }
  });

  ipcMain.handle(
    'social:generateContent',
    async (
      _,
      input: {
        content_type: GeneratedContentType;
        platform?: string | null;
        prompt_used?: string | null;
        source_content_id?: string | null;
        target_platforms?: string[] | null;
      }
    ) => {
      try {
        const memory = getMemory();
        if (!memory) return { success: false, error: 'Memory not initialized' };

        let prompt = input.prompt_used;

        // Build prompt from discovered content for repurpose
        if (input.content_type === 'repurpose' && input.source_content_id) {
          const source = memory.discoveredContent.getById(input.source_content_id);
          if (!source) return { success: false, error: 'Source content not found' };

          const targets = input.target_platforms?.length
            ? input.target_platforms
            : input.platform
              ? [input.platform]
              : ['x'];

          let transcript: string | undefined;
          const meta = source.metadata ? (() => { try { return JSON.parse(source.metadata!); } catch { return {}; } })() : {};

          if (meta.transcript) {
            transcript = meta.transcript;
          } else if (
            (source.media_urls || source.source_url) &&
            (
              ['video', 'reel', 'slideshow'].includes((source.content_type ?? '').toLowerCase()) ||
              /tiktok\.com|youtube\.com|youtu\.be|instagram\.com\/reel/i.test(source.source_url ?? '')
            )
          ) {
            try {
              // Extract direct video URL from media_urls (CDN links from scraper)
              let videoUrl: string | undefined;
              if (source.media_urls) {
                try {
                  const urls = JSON.parse(source.media_urls) as string[];
                  // Pick first video-like URL (mp4/webm/m3u8) or fall back to first URL
                  videoUrl = urls.find((u) => /\.(mp4|webm|m3u8|mov)/i.test(u)) ?? urls[0];
                } catch { /* malformed JSON — fall through */ }
              }

              // Try CDN URL first, then fall back to page URL (yt-dlp handles pages)
              // CDN URLs expire fast — source_url is stable and yt-dlp can extract from it
              const videoDir = path.join(app.getPath('userData'), 'videos', 'repurpose');
              let localPath: string | undefined;

              if (videoUrl) {
                try {
                  console.log(`[SocialIPC] Downloading video (CDN): ${videoUrl}`);
                  localPath = await downloadVideo(videoUrl, videoDir);
                } catch (dlErr) {
                  console.warn(`[SocialIPC] CDN download failed (will try page URL): ${dlErr instanceof Error ? dlErr.message : dlErr}`);
                }
              }

              if (!localPath && source.source_url) {
                console.log(`[SocialIPC] Downloading video (page URL via yt-dlp): ${source.source_url}`);
                localPath = await downloadVideo(source.source_url, videoDir);
              }

              if (!localPath) {
                throw new Error('No downloadable video URL available');
              }

              const result = await transcribeContent(localPath);
              transcript = result.text;
              meta.transcript = transcript;
              memory.discoveredContent.update(source.id, { metadata: JSON.stringify(meta) });
              console.log(`[SocialIPC] Transcribed video for repurpose: ${source.id}`);
            } catch (err) {
              const errMsg = err instanceof Error ? err.message : String(err);
              console.warn(`[SocialIPC] Video transcription failed: ${errMsg}`);
              // Surface the error to the caller so the UI can notify the user
              return { success: false, error: `Video transcription failed: ${errMsg}` };
            }
          }

          // Load active brand config so repurposed content follows brand guidelines
          const brand = memory.brandConfig.getActive();

          prompt = repurposePrompt({
            sourceContent: source.body || source.title || '',
            sourcePlatform: source.platform,
            sourceStats: {
              likes: source.likes,
              comments: source.comments,
              shares: source.shares,
              views: source.views,
            },
            sourceTranscript: transcript,
            targetPlatforms: targets,
            platform: targets[0],
            topic: source.title || source.body?.substring(0, 100) || 'content',
            ...(brand && {
              brandVoice: brand.voice ?? undefined,
              brandTone: brand.tone ?? undefined,
              targetAudience: brand.target_audience ?? undefined,
              themes: brand.themes ? brand.themes.split(',').map((t) => t.trim()) : undefined,
              hashtags: brand.hashtags ? brand.hashtags.split(',').map((h) => h.trim()) : undefined,
              dos: brand.dos ?? undefined,
              donts: brand.donts ?? undefined,
              examplePosts: brand.example_posts ?? undefined,
            }),
          });
        }

        if (!prompt) return { success: false, error: 'No prompt provided' };

        const apiKey = SettingsManager.get('anthropic.apiKey');
        if (!apiKey) return { success: false, error: 'Anthropic API key not configured' };

        const model = SettingsManager.get('agent.model') || 'claude-3-5-haiku-20241022';

        const client = new Anthropic({ apiKey });
        const response = await client.messages.create({
          model,
          max_tokens: 2048,
          messages: [{ role: 'user', content: prompt }],
        });

        const output = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('\n');

        const generated = memory.generatedContent.create({
          content_type: input.content_type,
          platform: input.platform ?? input.target_platforms?.[0] ?? null,
          prompt_used: prompt,
          output,
        });

        // Persist repurpose drafts as social_posts with status='draft'
        const draftIds: Record<string, string> = {};
        if (input.content_type === 'repurpose') {
          const targets = input.target_platforms?.length
            ? input.target_platforms
            : input.platform
              ? [input.platform]
              : ['x'];

          // Parse output per platform (same logic as UI)
          const drafts: Record<string, string> = {};
          try {
            const parsed = JSON.parse(output);
            if (parsed && typeof parsed === 'object') {
              for (const p of targets) {
                if (parsed[p]) {
                  const val = parsed[p];
                  drafts[p] = typeof val === 'object' ? (val.copy || val.text || JSON.stringify(val)) : String(val);
                }
              }
            }
          } catch {
            // Fallback: split by platform headers
            for (const p of targets) {
              const regex = new RegExp(`(?:^|\\n)#+\\s*${p}[:\\s]*\\n([\\s\\S]*?)(?=\\n#+\\s|$)`, 'i');
              const match = output.match(regex);
              drafts[p] = match ? match[1].trim() : output;
            }
          }

          for (const p of targets) {
            const content = drafts[p] || output;
            const post = memory.socialPosts.create({
              platform: p,
              status: 'draft',
              content,
              source_content_id: input.source_content_id ?? null,
              generated_content_id: generated.id,
            });
            draftIds[p] = post.id;
          }
        }

        return { success: true, data: generated, draftIds };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[SocialIPC] generateContent error:', err);
        return { success: false, error: message };
      }
    }
  );

  // ============ Image Generation (Kie.ai) ============

  ipcMain.handle(
    'social:generateImage',
    async (
      _,
      input: {
        prompt: string;
        model?: ImageModelId;
        aspectRatio?: string;
        quality?: string;
        referenceImages?: string[];
        outputFormat?: string;
      }
    ) => {
      try {
        const apiKey = SettingsManager.get('kie.apiKey');
        if (!apiKey) return { success: false, error: 'Kie.ai API key not configured' };

        const client = new KieClient(apiKey);
        const { resolveModelId } = await import('../../image');
        const model: ImageModelId = resolveModelId(input.model ?? 'nano-banana-2');
        const { predictionId } = await client.generate({
          prompt: input.prompt,
          model,
          aspectRatio: input.aspectRatio ?? '1:1',
          quality: input.quality ?? '1K',
          referenceImages: input.referenceImages,
          outputFormat: input.outputFormat,
        });

        // Hand off to centralised tracker for background polling + gallery save
        if (tracker) {
          tracker.track({
            predictionId,
            prompt: input.prompt,
            model,
            sessionId: getCurrentSessionId(),
          });
        }

        return { success: true, predictionId, status: 'generating' };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[SocialIPC] generateImage error:', err);
        return { success: false, error: message };
      }
    }
  );

  ipcMain.handle('social:downloadImage', async (_, id: string) => {
    try {
      const memory = getMemory();
      if (!memory) return { success: false, error: 'Memory not initialized' };

      const item = memory.generatedContent.getById(id);
      if (!item) return { success: false, error: 'Record not found' };

      const mediaUrl = item.media_url || (item.content_type === 'image' ? item.output : null);
      if (!mediaUrl) return { success: false, error: 'No media URL found' };

      // Build a default filename from the prompt
      const promptSlug = (item.prompt_used || 'image')
        .slice(0, 60)
        .replace(/[^a-zA-Z0-9 _-]/g, '')
        .trim()
        .replace(/\s+/g, '-');
      const ext = path.extname(mediaUrl).split('?')[0] || '.png';
      const defaultName = `${promptSlug}${ext}`;

      const { canceled, filePath } = await dialog.showSaveDialog({
        title: 'Save Image',
        defaultPath: path.join(app.getPath('downloads'), defaultName),
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }],
      });

      if (canceled || !filePath) return { success: false, error: 'Cancelled' };

      if (mediaUrl.startsWith('http://') || mediaUrl.startsWith('https://')) {
        const res = await proxyFetch(mediaUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        fs.writeFileSync(filePath, buf);
      } else {
        // Local file — copy it
        fs.copyFileSync(mediaUrl, filePath);
      }

      return { success: true, filePath };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[SocialIPC] downloadImage error:', err);
      return { success: false, error: message };
    }
  });

  ipcMain.handle('social:getImageStatus', async (_, predictionId: string) => {
    try {
      const apiKey = SettingsManager.get('kie.apiKey');
      if (!apiKey) return { success: false, error: 'Kie.ai API key not configured' };

      const client = new KieClient(apiKey);
      const result = await client.getStatus(predictionId);
      return { success: true, ...result };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[SocialIPC] getImageStatus error:', err);
      return { success: false, error: message };
    }
  });

  // ============ Trend Detection ============

  ipcMain.handle('social:detectTrends', async (_, limit?: number) => {
    try {
      const memory = getMemory();
      if (!memory) return { success: false, error: 'Memory not initialized' };

      // Get recent discovered content to analyze
      const items = memory.discoveredContent.getRecent(limit ?? 200);
      if (items.length < 2) return { success: true, trends: [] };

      // Run the trend detection engine
      const clusters = detectTrends(items);

      // Upsert each detected trend into the database
      const upserted = clusters.map((cluster) => {
        const sampleIds = cluster.items.slice(0, 10).map((i) => i.id);
        return memory.trends.upsert({
          keyword: cluster.keywords.join(', '),
          score: cluster.score,
          status: cluster.status,
          sample_content_ids: sampleIds,
        });
      });

      return { success: true, trends: upserted };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[SocialIPC] detectTrends error:', err);
      return { success: false, error: message };
    }
  });

  ipcMain.handle('social:getTrends', async (_, status?: string) => {
    try {
      const memory = getMemory();
      if (!memory) return [];
      if (status) {
        return memory.trends.getByStatus(status as TrendStatusValue);
      }
      return memory.trends.getActive();
    } catch (err) {
      console.error('[SocialIPC] getTrends error:', err);
      return [];
    }
  });

  ipcMain.handle('social:dismissTrend', async (_, id: string) => {
    try {
      const memory = getMemory();
      if (!memory) return { success: false, error: 'Memory not initialized' };
      const dismissed = memory.trends.dismiss(id);
      if (!dismissed) return { success: false, error: 'Trend not found' };
      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[SocialIPC] dismissTrend error:', err);
      return { success: false, error: message };
    }
  });
}

// ---------------------------------------------------------------------------
// Minimal ZIP archive builder (store mode, no compression — images are already compressed)
// ---------------------------------------------------------------------------

function buildZipArchive(files: Array<{ name: string; data: Buffer }>): Buffer {
  const chunks: Buffer[] = [];
  const centralDir: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBuffer = Buffer.from(file.name, 'utf8');
    const data = file.data;

    // Local file header (30 bytes + name)
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // signature
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(0, 8); // compression: store
    local.writeUInt16LE(0, 10); // mod time
    local.writeUInt16LE(0, 12); // mod date
    local.writeUInt32LE(crc32(data), 14); // crc-32
    local.writeUInt32LE(data.length, 18); // compressed size
    local.writeUInt32LE(data.length, 22); // uncompressed size
    local.writeUInt16LE(nameBuffer.length, 26); // name length
    local.writeUInt16LE(0, 28); // extra length

    chunks.push(local, nameBuffer, data);

    // Central directory header (46 bytes + name)
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // signature
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8); // flags
    central.writeUInt16LE(0, 10); // compression: store
    central.writeUInt16LE(0, 12); // mod time
    central.writeUInt16LE(0, 14); // mod date
    central.writeUInt32LE(crc32(data), 16); // crc-32
    central.writeUInt32LE(data.length, 20); // compressed size
    central.writeUInt32LE(data.length, 24); // uncompressed size
    central.writeUInt16LE(nameBuffer.length, 28); // name length
    central.writeUInt16LE(0, 30); // extra length
    central.writeUInt16LE(0, 32); // comment length
    central.writeUInt16LE(0, 34); // disk number start
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(offset, 42); // local header offset
    centralDir.push(central, nameBuffer);

    offset += 30 + nameBuffer.length + data.length;
  }

  const centralDirBuf = Buffer.concat(centralDir);
  const centralDirOffset = offset;

  // End of central directory (22 bytes)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // signature
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // disk with central dir
  eocd.writeUInt16LE(files.length, 8); // entries on this disk
  eocd.writeUInt16LE(files.length, 10); // total entries
  eocd.writeUInt32LE(centralDirBuf.length, 12); // central dir size
  eocd.writeUInt32LE(centralDirOffset, 16); // central dir offset
  eocd.writeUInt16LE(0, 20); // comment length

  chunks.push(centralDirBuf, eocd);
  return Buffer.concat(chunks);
}

// CRC-32 lookup table
const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[i] = c;
}

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
