import { contextBridge, ipcRenderer } from 'electron';

// Expose API to renderer process — organized by domain
contextBridge.exposeInMainWorld('neonPost', {
  // ─── Agent ───────────────────────────────────────────────────────────
  agent: {
    send: (
      message: string,
      sessionId?: string,
      images?: Array<{ type: 'base64'; mediaType: string; data: string }>
    ) => ipcRenderer.invoke('agent:send', message, sessionId, images),
    stop: (sessionId?: string) => ipcRenderer.invoke('agent:stop', sessionId),
    setMode: (mode: string) => ipcRenderer.invoke('agent:setMode', mode),
    getMode: () => ipcRenderer.invoke('agent:getMode'),
    getSessionMode: (sessionId: string) => ipcRenderer.invoke('agent:getSessionMode', sessionId),
    setSessionMode: (sessionId: string, mode: string) =>
      ipcRenderer.invoke('agent:setSessionMode', sessionId, mode),
    onModeChanged: (callback: (mode: string) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, mode: string) => callback(mode);
      ipcRenderer.on('agent:modeChanged', listener);
      return () => ipcRenderer.removeListener('agent:modeChanged', listener);
    },
    onSessionModeChanged: (callback: (sessionId: string, mode: string) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, sessionId: string, mode: string) =>
        callback(sessionId, mode);
      ipcRenderer.on('agent:sessionModeChanged', listener);
      return () => ipcRenderer.removeListener('agent:sessionModeChanged', listener);
    },
    onStatus: (
      callback: (status: {
        type: string;
        toolName?: string;
        toolInput?: string;
        message?: string;
      }) => void
    ) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        status: { type: string; toolName?: string; toolInput?: string; message?: string }
      ) => callback(status);
      ipcRenderer.on('agent:status', listener);
      return () => ipcRenderer.removeListener('agent:status', listener);
    },
    getHistory: (limit?: number, sessionId?: string) =>
      ipcRenderer.invoke('agent:history', limit, sessionId),
    getStats: (sessionId?: string) => ipcRenderer.invoke('agent:stats', sessionId),
    clearConversation: (sessionId?: string) => ipcRenderer.invoke('agent:clear', sessionId),
    readMedia: (filePath: string) => ipcRenderer.invoke('agent:readMedia', filePath),
    restart: () => ipcRenderer.invoke('agent:restart'),
  },

  // ─── Attachments ─────────────────────────────────────────────────────
  attachments: {
    save: (name: string, dataUrl: string) => ipcRenderer.invoke('attachment:save', name, dataUrl),
    extractText: (filePath: string) => ipcRenderer.invoke('attachment:extract-text', filePath),
  },

  // ─── Sessions ────────────────────────────────────────────────────────
  sessions: {
    list: () => ipcRenderer.invoke('sessions:list'),
    create: (name: string) => ipcRenderer.invoke('sessions:create', name),
    rename: (id: string, name: string) => ipcRenderer.invoke('sessions:rename', id, name),
    delete: (id: string) => ipcRenderer.invoke('sessions:delete', id),
    onChanged: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on('sessions:changed', listener);
      return () => ipcRenderer.removeListener('sessions:changed', listener);
    },
    onCleared: (callback: (sessionId: string) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, sessionId: string) =>
        callback(sessionId);
      ipcRenderer.on('session:cleared', listener);
      return () => ipcRenderer.removeListener('session:cleared', listener);
    },
  },

  // ─── Facts ───────────────────────────────────────────────────────────
  facts: {
    list: () => ipcRenderer.invoke('facts:list'),
    search: (query: string) => ipcRenderer.invoke('facts:search', query),
    getCategories: () => ipcRenderer.invoke('facts:categories'),
    delete: (id: number) => ipcRenderer.invoke('facts:delete', id),
  },

  // ─── Soul (Self-Knowledge) ──────────────────────────────────────────
  soul: {
    listAspects: () => ipcRenderer.invoke('soul:list'),
    getAspect: (aspect: string) => ipcRenderer.invoke('soul:get', aspect),
    deleteAspect: (id: number) => ipcRenderer.invoke('soul:delete', id),
  },

  // ─── Daily Logs ──────────────────────────────────────────────────────
  dailyLogs: {
    list: () => ipcRenderer.invoke('dailyLogs:list'),
    delete: (id: number) => ipcRenderer.invoke('dailyLogs:delete', id),
  },

  // ─── App (Windows, Navigation, Info) ─────────────────────────────────
  app: {
    openFacts: () => ipcRenderer.invoke('app:openFacts'),
    openDailyLogs: () => ipcRenderer.invoke('app:openDailyLogs'),
    openSoul: () => ipcRenderer.invoke('app:openSoul'),
    openCustomize: () => ipcRenderer.invoke('app:openCustomize'),
    openRoutines: () => ipcRenderer.invoke('app:openRoutines'),
    openExternal: (url: string) => ipcRenderer.invoke('app:openExternal', url),
    openPath: (filePath: string) => ipcRenderer.invoke('app:openPath', filePath),
    openImage: (src: string) => ipcRenderer.invoke('app:openImage', src),
    openSettings: (tab?: string) => ipcRenderer.invoke('app:openSettings', tab),
    openChat: () => ipcRenderer.invoke('app:openChat'),
    getVersion: () => ipcRenderer.invoke('app:getVersion'),
    getPlatform: () => process.platform,
    onNavigateTab: (callback: (tab: string) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, tab: string) => callback(tab);
      ipcRenderer.on('navigate-tab', listener);
      return () => ipcRenderer.removeListener('navigate-tab', listener);
    },
  },

  // ─── Customize ───────────────────────────────────────────────────────
  customize: {
    getSystemPrompt: () => ipcRenderer.invoke('customize:getSystemPrompt'),
    getAgentModes: () => ipcRenderer.invoke('customize:getAgentModes'),
  },

  // ─── Location & Timezone ─────────────────────────────────────────────
  location: {
    lookup: (query: string) => ipcRenderer.invoke('location:lookup', query),
    getTimezones: () => ipcRenderer.invoke('timezone:list'),
  },

  // ─── Cron / Routines ────────────────────────────────────────────────
  cron: {
    list: () => ipcRenderer.invoke('cron:list'),
    create: (name: string, schedule: string, prompt: string, channel: string, sessionId: string) =>
      ipcRenderer.invoke('cron:create', name, schedule, prompt, channel, sessionId),
    delete: (name: string) => ipcRenderer.invoke('cron:delete', name),
    toggle: (name: string, enabled: boolean) => ipcRenderer.invoke('cron:toggle', name, enabled),
    run: (name: string) => ipcRenderer.invoke('cron:run', name),
    getHistory: (limit?: number) => ipcRenderer.invoke('cron:history', limit),
  },

  // ─── Settings ────────────────────────────────────────────────────────
  settings: {
    getAll: () => ipcRenderer.invoke('settings:getAll'),
    get: (key: string) => ipcRenderer.invoke('settings:get', key),
    set: (key: string, value: string) => ipcRenderer.invoke('settings:set', key, value),
    delete: (key: string) => ipcRenderer.invoke('settings:delete', key),
    getSchema: (category?: string) => ipcRenderer.invoke('settings:schema', category),
    isFirstRun: () => ipcRenderer.invoke('settings:isFirstRun'),
    resetOnboarding: () => ipcRenderer.invoke('settings:resetOnboarding'),
    initializeKeychain: () => ipcRenderer.invoke('settings:initializeKeychain'),
    getAvailableModels: () => ipcRenderer.invoke('settings:getAvailableModels'),
  },

  // ─── Validation ──────────────────────────────────────────────────────
  validate: {
    anthropicKey: (key: string) => ipcRenderer.invoke('settings:validateAnthropic', key),
    openAIKey: (key: string) => ipcRenderer.invoke('settings:validateOpenAI', key),
    moonshotKey: (key: string) => ipcRenderer.invoke('settings:validateMoonshot', key),
    glmKey: (key: string) => ipcRenderer.invoke('settings:validateGlm', key),
    openRouterKey: (key: string) => ipcRenderer.invoke('settings:validateOpenRouter', key),
    telegramToken: (token: string) => ipcRenderer.invoke('settings:validateTelegram', token),
  },

  // ─── Auth (OAuth) ───────────────────────────────────────────────────
  auth: {
    startOAuth: () => ipcRenderer.invoke('auth:startOAuth'),
    completeOAuth: (code: string) => ipcRenderer.invoke('auth:completeOAuth', code),
    cancelOAuth: () => ipcRenderer.invoke('auth:cancelOAuth'),
    isOAuthPending: () => ipcRenderer.invoke('auth:isOAuthPending'),
    validateOAuth: () => ipcRenderer.invoke('auth:validateOAuth'),
  },

  // ─── Themes ──────────────────────────────────────────────────────────
  themes: {
    list: () => ipcRenderer.invoke('settings:getThemes'),
    getSkin: () => ipcRenderer.invoke('settings:getSkin'),
    onSkinChanged: (callback: (skinId: string) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, skinId: string) => callback(skinId);
      ipcRenderer.on('skin:changed', listener);
      return () => ipcRenderer.removeListener('skin:changed', listener);
    },
  },

  // ─── Chat Events ────────────────────────────────────────────────────
  chat: {
    onUsernameChanged: (callback: (username: string) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, username: string) => callback(username);
      ipcRenderer.on('chat:usernameChanged', listener);
      return () => ipcRenderer.removeListener('chat:usernameChanged', listener);
    },
  },

  // ─── Commands (Workflows) ───────────────────────────────────────────
  commands: {
    list: (sessionId?: string) => ipcRenderer.invoke('commands:list', sessionId),
  },

  // ─── Updater ─────────────────────────────────────────────────────────
  updater: {
    checkForUpdates: () => ipcRenderer.invoke('updater:checkForUpdates'),
    download: () => ipcRenderer.invoke('updater:downloadUpdate'),
    install: () => ipcRenderer.invoke('updater:installUpdate'),
    getStatus: () => ipcRenderer.invoke('updater:getStatus'),
    onStatus: (
      callback: (status: {
        status: string;
        info?: unknown;
        progress?: { percent: number };
        error?: string;
      }) => void
    ) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        status: { status: string; info?: unknown; progress?: { percent: number }; error?: string }
      ) => callback(status);
      ipcRenderer.on('updater:status', listener);
      return () => ipcRenderer.removeListener('updater:status', listener);
    },
  },

  // ─── Browser Control ────────────────────────────────────────────────
  browser: {
    detectInstalled: () => ipcRenderer.invoke('browser:detectInstalled'),
    launch: (browserId: string, port?: number) =>
      ipcRenderer.invoke('browser:launch', browserId, port),
    testConnection: (cdpUrl?: string) => ipcRenderer.invoke('browser:testConnection', cdpUrl),
  },

  // ─── iOS Mobile Companion ──────────────────────────────────────────
  ios: {
    getPairingCode: (regenerate?: boolean) => ipcRenderer.invoke('ios:pairing-code', regenerate),
    getDevices: () => ipcRenderer.invoke('ios:devices'),
    getInfo: () => ipcRenderer.invoke('ios:info'),
    toggle: (enabled: boolean) => ipcRenderer.invoke('ios:toggle', enabled),
  },

  // ─── Shell ───────────────────────────────────────────────────────────
  shell: {
    runCommand: (command: string) => ipcRenderer.invoke('shell:runCommand', command),
  },

  // ─── Permissions (macOS) ─────────────────────────────────────────────
  permissions: {
    isMacOS: () => ipcRenderer.invoke('permissions:isMacOS'),
    check: (types: string[]) => ipcRenderer.invoke('permissions:checkStatus', types),
    openSettings: (type: string) => ipcRenderer.invoke('permissions:openSettings', type),
  },

  // ─── Social Media ───────────────────────────────────────────────────
  social: {
    listAccounts: () => ipcRenderer.invoke('social:listAccounts'),
    getAccount: (id: string) => ipcRenderer.invoke('social:getAccount', id),
    addAccount: (data: Record<string, unknown>) => ipcRenderer.invoke('social:addAccount', data),
    updateAccount: (id: string, data: Record<string, unknown>) =>
      ipcRenderer.invoke('social:updateAccount', id, data),
    removeAccount: (id: string) => ipcRenderer.invoke('social:removeAccount', id),
    searchContent: (query: string, platform?: string) =>
      ipcRenderer.invoke('social:searchContent', query, platform),
    getDiscovered: (limit?: number) => ipcRenderer.invoke('social:getDiscovered', limit),
    saveDiscovered: (data: Record<string, unknown>) =>
      ipcRenderer.invoke('social:saveDiscovered', data),
    deleteDiscovered: (id: string) => ipcRenderer.invoke('social:deleteDiscovered', id),
    listPosts: (status?: string) => ipcRenderer.invoke('social:listPosts', status),
    createPost: (data: Record<string, unknown>) => ipcRenderer.invoke('social:createPost', data),
    updatePost: (id: string, data: Record<string, unknown>) =>
      ipcRenderer.invoke('social:updatePost', id, data),
    getGenerated: (limit?: number) => ipcRenderer.invoke('social:getGenerated', limit),
    deleteGenerated: (id: string) => ipcRenderer.invoke('social:deleteGenerated', id),
    bulkDeleteGenerated: (ids: string[]) => ipcRenderer.invoke('social:bulkDeleteGenerated', ids),
    favoriteGenerated: (id: string, rating: number) =>
      ipcRenderer.invoke('social:favoriteGenerated', id, rating),
    saveBrand: (data: Record<string, unknown>) => ipcRenderer.invoke('social:saveBrand', data),
    getBrand: () => ipcRenderer.invoke('social:getBrand'),
    generateContent: (data: Record<string, unknown>) =>
      ipcRenderer.invoke('social:generateContent', data),
    validateApifyKey: (key: string) => ipcRenderer.invoke('social:validateApifyKey', key),
    validateRapidAPIKey: (key: string) => ipcRenderer.invoke('social:validateRapidAPIKey', key),
    validateKieKey: (key: string) => ipcRenderer.invoke('social:validateKieKey', key),
    validateAssemblyKey: (key: string) => ipcRenderer.invoke('social:validateAssemblyKey', key),
    downloadImage: (id: string) => ipcRenderer.invoke('social:downloadImage', id),
    getGalleryGrouped: () => ipcRenderer.invoke('social:getGalleryGrouped'),
    downloadCarousel: (groupId: string) => ipcRenderer.invoke('social:downloadCarousel', groupId),
    generateImage: (data: Record<string, unknown>) =>
      ipcRenderer.invoke('social:generateImage', data),
    getCalendarPosts: (startDate: string, endDate: string) =>
      ipcRenderer.invoke('social:getCalendarPosts', startDate, endDate),
    getCalendarSummary: (startDate: string, endDate: string) =>
      ipcRenderer.invoke('social:getCalendarSummary', startDate, endDate),
    reschedulePost: (id: string, scheduledAt: string) =>
      ipcRenderer.invoke('social:reschedulePost', id, scheduledAt),
    deletePost: (id: string) => ipcRenderer.invoke('social:deletePost', id),
    articleSources: {
      list: () => ipcRenderer.invoke('articleSources:list'),
      add: (url: string, scheduleExpr?: string) =>
        ipcRenderer.invoke('articleSources:add', url, scheduleExpr),
      update: (id: string, input: Record<string, unknown>) =>
        ipcRenderer.invoke('articleSources:update', id, input),
      delete: (id: string) => ipcRenderer.invoke('articleSources:delete', id),
      runNow: (id: string) => ipcRenderer.invoke('articleSources:runNow', id),
      listPending: (sourceId: string) =>
        ipcRenderer.invoke('articleSources:listPending', sourceId),
      countPending: (sourceId: string) =>
        ipcRenderer.invoke('articleSources:countPending', sourceId),
      skipPending: (pendingId: string) =>
        ipcRenderer.invoke('articleSources:skipPending', pendingId),
      goPending: (pendingId: string, platform: string) =>
        ipcRenderer.invoke('articleSources:goPending', pendingId, platform),
    },
    onArticleSourceChanged: (
      callback: (data: { action: 'created' | 'updated' | 'deleted'; sourceId: string }) => void
    ) => {
      ipcRenderer.on('social:articleSourceChanged', (_, data) => {
        callback(data);
      });
    },
    getImageStatus: (predictionId: string) =>
      ipcRenderer.invoke('social:getImageStatus', predictionId),
    detectTrends: (limit?: number) => ipcRenderer.invoke('social:detectTrends', limit),
    getTrends: (status?: string) => ipcRenderer.invoke('social:getTrends', status),
    dismissTrend: (id: string) => ipcRenderer.invoke('social:dismissTrend', id),
    getDrafts: (platform?: string) => ipcRenderer.invoke('social:getDrafts', platform),
    updateDraft: (id: string, updates: Record<string, unknown>) =>
      ipcRenderer.invoke('social:updateDraft', id, updates),
    deleteDraft: (id: string) => ipcRenderer.invoke('social:deleteDraft', id),
    pickVideoFile: () => ipcRenderer.invoke('social:pickVideoFile'),
    uploadVideo: (draftId: string, filePath: string) =>
      ipcRenderer.invoke('social:uploadVideo', { draft_id: draftId, file_path: filePath }),
    pickMediaFiles: () => ipcRenderer.invoke('social:pickMediaFiles'),
    attachMedia: (draftId: string, files: Array<{ filePath: string; type: string; fileName: string }>) =>
      ipcRenderer.invoke('social:attachMedia', { draft_id: draftId, files }),
    coldUpload: (filePath: string, platform: string) =>
      ipcRenderer.invoke('social:coldUpload', { file_path: filePath, platform }),
    refineWithVideo: (draftId: string) =>
      ipcRenderer.invoke('social:refineWithVideo', { draft_id: draftId }),
    generateFromVideo: (draftId: string) =>
      ipcRenderer.invoke('social:generateFromVideo', { draft_id: draftId }),
    onVideoProgress: (
      callback: (data: { draftId: string; step: string; percent: number }) => void
    ) => {
      ipcRenderer.on('social:videoProgress', (_, data) => callback(data));
    },
    onImageGenerating: (
      callback: (data: { predictionId: string; prompt: string; model: string }) => void
    ) => {
      ipcRenderer.on('image:generating', (_, data) => {
        console.log('[Preload] image:generating received', data.predictionId);
        callback(data);
      });
    },
    onImageReady: (
      callback: (data: {
        predictionId: string;
        imageUrl: string;
        savedId: string | null;
        prompt: string;
      }) => void
    ) => {
      ipcRenderer.on('image:ready', (_, data) => {
        console.log('[Preload] image:ready received', data.predictionId);
        callback(data);
      });
    },
    onImageFailed: (
      callback: (data: { predictionId: string; error: string; prompt: string }) => void
    ) => {
      ipcRenderer.on('image:failed', (_, data) => {
        console.log('[Preload] image:failed received', data.predictionId);
        callback(data);
      });
    },
    onSearchStarted: (
      callback: (data: { platform: string; query: string }) => void
    ) => {
      ipcRenderer.on('social:searchStarted', (_, data) => {
        console.log('[Preload] search started:', data.query, 'on', data.platform);
        callback(data);
      });
    },
    onProfileStarted: (
      callback: (data: { platform: string; username: string }) => void
    ) => {
      ipcRenderer.on('social:profileStarted', (_, data) => {
        console.log('[Preload] profile started:', data.username, 'on', data.platform);
        callback(data);
      });
    },
    onRepurposeStarted: (
      callback: (data: { platforms: string[]; source_content_id?: string; source_url?: string }) => void
    ) => {
      ipcRenderer.on('social:repurposeStarted', (_, data) => {
        console.log('[Preload] repurpose started:', data.platforms?.join(', '));
        callback(data);
      });
    },
    onRepurposeProgress: (
      callback: (data: { stage: string }) => void
    ) => {
      ipcRenderer.on('social:repurposeProgress', (_, data) => {
        console.log('[Preload] repurpose progress:', data.stage);
        callback(data);
      });
    },
    onSearchResultsPushed: (
      callback: (data: {
        query: string;
        platform: string;
        results: Record<string, unknown>[];
      }) => void
    ) => {
      ipcRenderer.on('social:searchResultsPushed', (_, data) => {
        console.log('[Preload] search results pushed:', data.results?.length ?? 0, 'items');
        callback(data);
      });
    },
    onSearchLimitReached: (
      callback: (data: { used: number; limit: number; sessionId: string }) => void
    ) => {
      ipcRenderer.on('social:searchLimitReached', (_, data) => {
        callback(data);
      });
    },
    onPostChanged: (
      callback: (data: { platform: string; postId: string; scheduled_at?: string; content?: string }) => void
    ) => {
      ipcRenderer.on('social:postChanged', (_, data) => {
        console.log('[Preload] social:postChanged received', data.postId);
        callback(data);
      });
    },
    onPostPublished: (
      callback: (data: { platform: string; postId: string; content: string }) => void
    ) => {
      ipcRenderer.on('social:post-published', (_, data) => {
        console.log('[Preload] social:post-published received', data.postId, data.platform);
        callback(data);
      });
    },
    onScheduleCreated: (
      callback: (data: { platform: string; postId: string; scheduled_at: string; content: string }) => void
    ) => {
      ipcRenderer.on('social:schedule-created', (_, data) => {
        console.log('[Preload] social:schedule-created received', data.postId, data.platform);
        callback(data);
      });
    },
    onContentSaved: (
      callback: (data: { contentType: string; id: string; platform: string }) => void
    ) => {
      ipcRenderer.on('social:contentSaved', (_, data) => {
        console.log('[Preload] social:contentSaved received', data.id);
        callback(data);
      });
    },
    onTrendingResults: (
      callback: (data: { platform: string; results: Record<string, unknown>[] }) => void
    ) => {
      ipcRenderer.on('social:trendingResults', (_, data) => {
        console.log('[Preload] social:trendingResults received', data.results?.length ?? 0, 'items');
        callback(data);
      });
    },
    onProfileResults: (
      callback: (data: { platform: string; username: string; results: Record<string, unknown>[] }) => void
    ) => {
      ipcRenderer.on('social:profileResults', (_, data) => {
        console.log('[Preload] social:profileResults received', data.results?.length ?? 0, 'posts');
        callback(data);
      });
    },
    onRepurposeCompleted: (
      callback: (data: { drafts: Record<string, unknown>[]; sourceId: string }) => void
    ) => {
      ipcRenderer.on('social:repurposeCompleted', (_, data) => {
        console.log('[Preload] social:repurposeCompleted received', data.drafts?.length ?? 0, 'drafts');
        callback(data);
      });
    },
    onVideoUploadStarted: (
      callback: (data: { draftId: string; filePath: string }) => void
    ) => {
      ipcRenderer.on('social:videoUploadStarted', (_, data) => {
        console.log('[Preload] video upload started:', data.draftId);
        callback(data);
      });
    },
    onVideoUploadCompleted: (
      callback: (data: { draftId: string; videoPath?: string; platform?: string; error?: string }) => void
    ) => {
      ipcRenderer.on('social:videoUploadCompleted', (_, data) => {
        console.log('[Preload] video upload completed:', data.draftId);
        callback(data);
      });
    },
    onVideoProcessing: (
      callback: (data: { stage: string; platform: string; filePath: string; draftId?: string; error?: boolean }) => void
    ) => {
      ipcRenderer.on('social:videoProcessing', (_, data) => {
        console.log('[Preload] video processing:', data.stage);
        callback(data);
      });
    },
  },

  // ─── External Events ────────────────────────────────────────────────
  events: {
    onSchedulerMessage: (
      callback: (data: {
        jobName: string;
        prompt: string;
        response: string;
        sessionId: string;
      }) => void
    ) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: { jobName: string; prompt: string; response: string; sessionId: string }
      ) => callback(data);
      ipcRenderer.on('scheduler:message', listener);
      return () => ipcRenderer.removeListener('scheduler:message', listener);
    },
    onTelegramMessage: (
      callback: (data: {
        userMessage: string;
        response: string;
        chatId: number;
        sessionId: string;
        hasAttachment?: boolean;
        attachmentType?: 'photo' | 'voice' | 'audio';
        wasCompacted?: boolean;
        media?: Array<{ type: string; filePath: string; mimeType: string }>;
      }) => void
    ) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: {
          userMessage: string;
          response: string;
          chatId: number;
          sessionId: string;
          hasAttachment?: boolean;
          attachmentType?: 'photo' | 'voice' | 'audio';
          wasCompacted?: boolean;
          media?: Array<{ type: string; filePath: string; mimeType: string }>;
        }
      ) => callback(data);
      ipcRenderer.on('telegram:message', listener);
      return () => ipcRenderer.removeListener('telegram:message', listener);
    },
    onIOSMessage: (
      callback: (data: {
        userMessage: string;
        response: string;
        sessionId: string;
        deviceId: string;
        media?: Array<{ type: string; filePath: string; mimeType: string }>;
      }) => void
    ) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: {
          userMessage: string;
          response: string;
          sessionId: string;
          deviceId: string;
          media?: Array<{ type: string; filePath: string; mimeType: string }>;
        }
      ) => callback(data);
      ipcRenderer.on('ios:message', listener);
      return () => ipcRenderer.removeListener('ios:message', listener);
    },
    onModelChanged: (callback: (model: string) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, model: string) => callback(model);
      ipcRenderer.on('model:changed', listener);
      return () => ipcRenderer.removeListener('model:changed', listener);
    },
  },
});

// Session type
interface Session {
  id: string;
  name: string;
  mode?: 'general' | 'coder';
  working_directory?: string | null;
  created_at: string;
  updated_at: string;
  telegram_linked?: boolean;
  telegram_group_name?: string | null;
}

// Type declarations for renderer
declare global {
  interface Window {
    neonPost: {
      agent: {
        send: (
          message: string,
          sessionId?: string,
          images?: Array<{ type: 'base64'; mediaType: string; data: string }>
        ) => Promise<{
          success: boolean;
          response?: string;
          error?: string;
          tokensUsed?: number;
          suggestedPrompt?: string;
          media?: Array<{ type: string; filePath: string; mimeType: string }>;
        }>;
        stop: (sessionId?: string) => Promise<{ success: boolean }>;
        setMode: (mode: string) => Promise<{ success: boolean; error?: string }>;
        getMode: () => Promise<string>;
        getSessionMode: (sessionId: string) => Promise<string>;
        setSessionMode: (
          sessionId: string,
          mode: string
        ) => Promise<{ success: boolean; error?: string }>;
        onModeChanged: (callback: (mode: string) => void) => () => void;
        onSessionModeChanged: (callback: (sessionId: string, mode: string) => void) => () => void;
        onStatus: (
          callback: (status: {
            type: string;
            toolName?: string;
            toolInput?: string;
            message?: string;
          }) => void
        ) => () => void;
        getHistory: (
          limit?: number,
          sessionId?: string
        ) => Promise<
          Array<{
            role: string;
            content: string;
            timestamp: string;
            metadata?: { source?: string; jobName?: string };
          }>
        >;
        getStats: (sessionId?: string) => Promise<{
          messageCount: number;
          factCount: number;
          estimatedTokens: number;
          sessionCount?: number;
          contextTokens?: number;
          contextWindow?: number;
        } | null>;
        clearConversation: (sessionId?: string) => Promise<{ success: boolean }>;
        readMedia: (filePath: string) => Promise<string | null>;
        restart: () => Promise<{ success: boolean }>;
      };

      attachments: {
        save: (name: string, dataUrl: string) => Promise<string>;
        extractText: (filePath: string) => Promise<string>;
      };

      sessions: {
        list: () => Promise<Session[]>;
        create: (name: string) => Promise<{ success: boolean; session?: Session; error?: string }>;
        rename: (id: string, name: string) => Promise<{ success: boolean; error?: string }>;
        delete: (id: string) => Promise<{ success: boolean }>;
        onChanged: (callback: () => void) => () => void;
        onCleared: (callback: (sessionId: string) => void) => () => void;
      };

      facts: {
        list: () => Promise<
          Array<{ id: number; category: string; subject: string; content: string }>
        >;
        search: (
          query: string
        ) => Promise<Array<{ category: string; subject: string; content: string }>>;
        getCategories: () => Promise<string[]>;
        delete: (id: number) => Promise<{ success: boolean }>;
      };

      soul: {
        listAspects: () => Promise<
          Array<{
            id: number;
            aspect: string;
            content: string;
            created_at: string;
            updated_at: string;
          }>
        >;
        getAspect: (aspect: string) => Promise<{
          id: number;
          aspect: string;
          content: string;
          created_at: string;
          updated_at: string;
        } | null>;
        deleteAspect: (id: number) => Promise<{ success: boolean }>;
      };

      dailyLogs: {
        list: () => Promise<
          Array<{ id: number; date: string; content: string; updated_at: string }>
        >;
        delete: (id: number) => Promise<{ success: boolean }>;
      };

      app: {
        openFacts: () => Promise<void>;
        openDailyLogs: () => Promise<void>;
        openSoul: () => Promise<void>;
        openCustomize: () => Promise<void>;
        openRoutines: () => Promise<void>;
        openExternal: (url: string) => Promise<void>;
        openPath: (filePath: string) => Promise<void>;
        openImage: (src: string) => Promise<void>;
        openSettings: (tab?: string) => Promise<void>;
        openChat: () => Promise<void>;
        getVersion: () => Promise<string>;
        getPlatform: () => string;
        onNavigateTab: (callback: (tab: string) => void) => () => void;
      };

      customize: {
        getSystemPrompt: () => Promise<string>;
        getAgentModes: () => Promise<
          Array<{
            id: string;
            name: string;
            icon: string;
            systemPrompt: string;
            description: string;
          }>
        >;
      };

      location: {
        lookup: (query: string) => Promise<
          Array<{
            city: string;
            country: string;
            province: string;
            timezone: string;
            display: string;
          }>
        >;
        getTimezones: () => Promise<string[]>;
      };

      cron: {
        list: () => Promise<
          Array<{
            id: number;
            name: string;
            schedule_type?: string;
            schedule: string | null;
            run_at?: string | null;
            interval_ms?: number | null;
            prompt: string;
            channel: string;
            enabled: boolean;
            session_id?: string | null;
            job_type?: 'routine' | 'reminder';
          }>
        >;
        create: (
          name: string,
          schedule: string,
          prompt: string,
          channel: string,
          sessionId: string
        ) => Promise<{ success: boolean }>;
        delete: (name: string) => Promise<{ success: boolean }>;
        toggle: (name: string, enabled: boolean) => Promise<{ success: boolean }>;
        run: (name: string) => Promise<{
          jobName: string;
          response: string;
          success: boolean;
          error?: string;
        } | null>;
        getHistory: (
          limit?: number
        ) => Promise<
          Array<{ jobName: string; response: string; success: boolean; timestamp: string }>
        >;
      };

      settings: {
        getAll: () => Promise<Record<string, string>>;
        get: (key: string) => Promise<string>;
        set: (key: string, value: string) => Promise<{ success: boolean }>;
        delete: (key: string) => Promise<{ success: boolean }>;
        getSchema: (category?: string) => Promise<
          Array<{
            key: string;
            defaultValue: string;
            encrypted: boolean;
            category: string;
            label: string;
            description?: string;
            type: string;
          }>
        >;
        isFirstRun: () => Promise<boolean>;
        resetOnboarding: () => Promise<{ success: boolean }>;
        initializeKeychain: () => Promise<{ available: boolean; error?: string }>;
        getAvailableModels: () => Promise<Array<{ id: string; name: string; provider: string }>>;
      };

      validate: {
        anthropicKey: (key: string) => Promise<{ valid: boolean; error?: string }>;
        openAIKey: (key: string) => Promise<{ valid: boolean; error?: string }>;
        moonshotKey: (key: string) => Promise<{ valid: boolean; error?: string }>;
        glmKey: (key: string) => Promise<{ valid: boolean; error?: string }>;
        openRouterKey: (key: string) => Promise<{ valid: boolean; error?: string }>;
        telegramToken: (
          token: string
        ) => Promise<{ valid: boolean; error?: string; botInfo?: unknown }>;
      };

      auth: {
        startOAuth: () => Promise<{ success: boolean; error?: string }>;
        completeOAuth: (code: string) => Promise<{ success: boolean; error?: string }>;
        cancelOAuth: () => Promise<{ success: boolean }>;
        isOAuthPending: () => Promise<boolean>;
        validateOAuth: () => Promise<{ valid: boolean; error?: string }>;
      };

      themes: {
        list: () => Promise<
          Record<string, { id: string; name: string; palette: Record<string, string> | null }>
        >;
        getSkin: () => Promise<string>;
        onSkinChanged: (callback: (skinId: string) => void) => () => void;
      };

      chat: {
        onUsernameChanged: (callback: (username: string) => void) => () => void;
      };

      commands: {
        list: (
          sessionId?: string
        ) => Promise<
          Array<{ name: string; description: string; filename: string; content: string }>
        >;
      };

      updater: {
        checkForUpdates: () => Promise<{
          status: string;
          info?: { version: string };
          error?: string;
        }>;
        download: () => Promise<{ success: boolean; error?: string }>;
        install: () => Promise<{ success: boolean; error?: string }>;
        getStatus: () => Promise<{
          status: string;
          info?: { version: string };
          progress?: { percent: number };
          error?: string;
        }>;
        onStatus: (
          callback: (status: {
            status: string;
            info?: { version: string };
            progress?: { percent: number };
            error?: string;
          }) => void
        ) => () => void;
      };

      browser: {
        detectInstalled: () => Promise<
          Array<{
            id: string;
            name: string;
            path: string;
            processName: string;
            installed: boolean;
          }>
        >;
        launch: (
          browserId: string,
          port?: number
        ) => Promise<{ success: boolean; error?: string; alreadyRunning?: boolean }>;
        testConnection: (
          cdpUrl?: string
        ) => Promise<{ connected: boolean; error?: string; browserInfo?: unknown }>;
      };

      ios: {
        getPairingCode: (
          regenerate?: boolean
        ) => Promise<{ code: string; expiresAt: string } | null>;
        getDevices: () => Promise<Array<{ id: string; name: string; lastSeen: string }>>;
        getInfo: () => Promise<{ enabled: boolean; port: number }>;
        toggle: (enabled: boolean) => Promise<{ success: boolean; error?: string }>;
      };

      shell: {
        runCommand: (command: string) => Promise<string>;
      };

      permissions: {
        isMacOS: () => Promise<boolean>;
        check: (types: string[]) => Promise<
          Array<{
            type: string;
            granted: boolean;
            canRequest: boolean;
            label: string;
            description: string;
            settingsUrl: string;
          }>
        >;
        openSettings: (type: string) => Promise<void>;
      };

      events: {
        onSchedulerMessage: (
          callback: (data: {
            jobName: string;
            prompt: string;
            response: string;
            sessionId: string;
          }) => void
        ) => () => void;
        onTelegramMessage: (
          callback: (data: {
            userMessage: string;
            response: string;
            chatId: number;
            sessionId: string;
            hasAttachment?: boolean;
            attachmentType?: 'photo' | 'voice' | 'audio';
            wasCompacted?: boolean;
            media?: Array<{ type: string; filePath: string; mimeType: string }>;
          }) => void
        ) => () => void;
        onIOSMessage: (
          callback: (data: {
            userMessage: string;
            response: string;
            sessionId: string;
            deviceId: string;
            media?: Array<{ type: string; filePath: string; mimeType: string }>;
          }) => void
        ) => () => void;
        onModelChanged: (callback: (model: string) => void) => () => void;
      };

      social: {
        listAccounts: () => Promise<
          Array<{
            id: string;
            platform: string;
            account_name: string;
            display_name: string | null;
            active: boolean;
            hasCredentials: boolean;
            created_at: string;
            updated_at: string;
          }>
        >;
        getAccount: (id: string) => Promise<Record<string, unknown> | null>;
        addAccount: (
          data: Record<string, unknown>
        ) => Promise<{ success: boolean; id?: string; error?: string }>;
        updateAccount: (
          id: string,
          data: Record<string, unknown>
        ) => Promise<{ success: boolean; error?: string }>;
        removeAccount: (id: string) => Promise<{ success: boolean; error?: string }>;
        searchContent: (
          query: string,
          platform?: string
        ) => Promise<Array<Record<string, unknown>> | { error: string }>;
        getDiscovered: (limit?: number) => Promise<Array<Record<string, unknown>>>;
        saveDiscovered: (
          data: Record<string, unknown>
        ) => Promise<{ success: boolean; id?: string; data?: Record<string, unknown>; error?: string }>;
        deleteDiscovered: (id: string) => Promise<{ success: boolean; error?: string }>;
        listPosts: (status?: string) => Promise<Array<Record<string, unknown>>>;
        createPost: (
          data: Record<string, unknown>
        ) => Promise<{ success: boolean; id?: string; error?: string }>;
        updatePost: (
          id: string,
          data: Record<string, unknown>
        ) => Promise<{ success: boolean; data?: Record<string, unknown>; error?: string }>;
        getGenerated: (limit?: number) => Promise<Array<Record<string, unknown>>>;
        deleteGenerated: (id: string) => Promise<{ success: boolean; error?: string }>;
        bulkDeleteGenerated: (ids: string[]) => Promise<{ success: boolean; deleted?: number; error?: string }>;
        favoriteGenerated: (
          id: string,
          rating: number
        ) => Promise<{ success: boolean; data?: Record<string, unknown>; error?: string }>;
        saveBrand: (data: Record<string, unknown>) => Promise<{ success: boolean; error?: string }>;
        getBrand: () => Promise<Record<string, unknown> | null>;
        generateContent: (data: Record<string, unknown>) => Promise<{
          success: boolean;
          data?: Record<string, unknown>;
          draftIds?: Record<string, string>;
          error?: string;
        }>;
        validateApifyKey: (key: string) => Promise<{ valid: boolean; error?: string }>;
        validateRapidAPIKey: (key: string) => Promise<{ valid: boolean; error?: string }>;
        validateKieKey: (key: string) => Promise<{ valid: boolean; error?: string }>;
        downloadImage: (id: string) => Promise<{ success: boolean; filePath?: string; error?: string }>;
        generateImage: (data: Record<string, unknown>) => Promise<{
          success: boolean;
          imageUrl?: string;
          predictionId?: string;
          error?: string;
        }>;
        getCalendarPosts: (
          startDate: string,
          endDate: string
        ) => Promise<Array<Record<string, unknown>>>;
        getCalendarSummary: (
          startDate: string,
          endDate: string
        ) => Promise<Array<{ date: string; count: number; platforms: string[] }>>;
        reschedulePost: (
          id: string,
          scheduledAt: string
        ) => Promise<{ success: boolean; data?: Record<string, unknown>; error?: string }>;
        deletePost: (id: string) => Promise<{ success: boolean; error?: string }>;
        articleSources: {
          list: () => Promise<
            | { success: true; sources: Array<Record<string, unknown>> }
            | { success: false; error: string }
          >;
          add: (
            url: string,
            scheduleExpr?: string
          ) => Promise<
            | { success: true; source: Record<string, unknown> }
            | { success: false; error: string }
          >;
          update: (
            id: string,
            input: Record<string, unknown>
          ) => Promise<
            | { success: true; source: Record<string, unknown> }
            | { success: false; error: string }
          >;
          delete: (id: string) => Promise<{ success: boolean; error?: string }>;
          runNow: (id: string) => Promise<
            | {
                success: true;
                sourceType: 'article' | 'feed' | 'index' | 'unknown';
                itemsScraped: number;
                itemsDeduped: number;
                itemsInserted: number;
              }
            | { success: false; error: string }
          >;
          listPending: (sourceId: string) => Promise<
            | { success: true; items: Array<Record<string, unknown>> }
            | { success: false; error: string }
          >;
          countPending: (
            sourceId: string
          ) => Promise<
            { success: true; count: number } | { success: false; error: string }
          >;
          skipPending: (pendingId: string) => Promise<{ success: boolean; error?: string }>;
          goPending: (
            pendingId: string,
            platform: string
          ) => Promise<
            { success: true; postId: string } | { success: false; error: string }
          >;
        };
        onArticleSourceChanged: (
          callback: (data: {
            action: 'created' | 'updated' | 'deleted';
            sourceId: string;
          }) => void
        ) => void;
        getDrafts: (platform?: string) => Promise<Array<Record<string, unknown>>>;
        updateDraft: (
          id: string,
          updates: Record<string, unknown>
        ) => Promise<{ success: boolean; data?: Record<string, unknown>; error?: string }>;
        deleteDraft: (id: string) => Promise<{ success: boolean; error?: string }>;
        uploadVideo: (
          draftId: string,
          filePath: string
        ) => Promise<{ success: boolean; data?: Record<string, unknown>; error?: string }>;
        pickMediaFiles: () => Promise<{
          success: boolean;
          files?: Array<{ filePath: string; fileName: string; type: string }>;
          error?: string;
        }>;
        attachMedia: (
          draftId: string,
          files: Array<{ filePath: string; type: string; fileName: string }>
        ) => Promise<{ success: boolean; data?: Record<string, unknown>; error?: string }>;
        coldUpload: (
          filePath: string,
          platform: string
        ) => Promise<{ success: boolean; data?: Record<string, unknown>; error?: string }>;
        refineWithVideo: (draftId: string) => Promise<{
          success: boolean;
          originalCopy?: string;
          refinedCopy?: string;
          error?: string;
        }>;
        generateFromVideo: (draftId: string) => Promise<{
          success: boolean;
          data?: Record<string, unknown>;
          error?: string;
        }>;
        onVideoProgress: (
          callback: (data: { draftId: string; step: string; percent: number }) => void
        ) => void;
        getImageStatus: (predictionId: string) => Promise<{
          success: boolean;
          predictionId?: string;
          status?: string;
          imageUrl?: string;
          error?: string;
        }>;
        onImageGenerating: (
          callback: (data: { predictionId: string; prompt: string; model: string }) => void
        ) => void;
        onImageReady: (
          callback: (data: {
            predictionId: string;
            imageUrl: string;
            savedId: string | null;
            prompt: string;
          }) => void
        ) => void;
        onImageFailed: (
          callback: (data: { predictionId: string; error: string; prompt: string }) => void
        ) => void;
        onSearchStarted: (
          callback: (data: { platform: string; query: string }) => void
        ) => void;
        onProfileStarted: (
          callback: (data: { platform: string; username: string }) => void
        ) => void;
        onRepurposeStarted: (
          callback: (data: { platforms: string[]; source_content_id?: string; source_url?: string }) => void
        ) => void;
        onRepurposeProgress: (
          callback: (data: { stage: string }) => void
        ) => void;
        onSearchResultsPushed: (
          callback: (data: {
            query: string;
            platform: string;
            results: Record<string, unknown>[];
          }) => void
        ) => void;
        onSearchLimitReached: (
          callback: (data: { used: number; limit: number; sessionId: string }) => void
        ) => void;
        onPostChanged: (
          callback: (data: { platform: string; postId: string; scheduled_at?: string; content?: string }) => void
        ) => void;
        onPostPublished: (
          callback: (data: { platform: string; postId: string; content: string }) => void
        ) => void;
        onScheduleCreated: (
          callback: (data: { platform: string; postId: string; scheduled_at: string; content: string }) => void
        ) => void;
        onContentSaved: (
          callback: (data: { contentType: string; id: string; platform: string }) => void
        ) => void;
        onTrendingResults: (
          callback: (data: { platform: string; results: Record<string, unknown>[] }) => void
        ) => void;
        onProfileResults: (
          callback: (data: { platform: string; username: string; results: Record<string, unknown>[] }) => void
        ) => void;
        onRepurposeCompleted: (
          callback: (data: { drafts: Record<string, unknown>[]; sourceId: string }) => void
        ) => void;
      };
    };
  }
}
