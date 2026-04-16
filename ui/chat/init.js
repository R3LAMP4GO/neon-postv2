/**
 * Full chat initialization — runs either immediately on load (no onboarding)
 * or after onboarding completes (called by obFinishSetup).
 */
async function initializeChat() {
  // Load current model
  await updateModelBadge();

  // Refresh model badge when window gains focus (in case user changed it in settings)
  window.addEventListener('focus', updateModelBadge);

  // Reload history when window regains visibility (e.g. after sleep/wake)
  // Throttle to avoid nuking image placeholders on quick tab switches
  let lastHistoryLoad = Date.now();
  document.addEventListener('visibilitychange', () => {
    document.body.classList.toggle('animations-paused', document.hidden);
    if (!document.hidden && Date.now() - lastHistoryLoad > 30_000) {
      lastHistoryLoad = Date.now();
      loadHistory();
    }
  });
  window.addEventListener('blur', () => document.body.classList.add('animations-paused'));
  window.addEventListener('focus', () => document.body.classList.remove('animations-paused'));


  // Load user/agent profile for placeholder and empty state
  await loadUserProfile();

  // Refresh profile when window regains focus (in case user changed it in Personalize)
  window.addEventListener('focus', loadUserProfile);

  // Load sessions first (sets currentSessionId), then init mode for correct session
  await loadSessions();
  await initAgentMode();
  ensureStatusListener(currentSessionId);
  await loadHistory();
  updateStats();
  input.focus();

  // Initialize notification sound
  initNotificationSound();

  // Connect to global chat server (stay online while app is open)
  await getOrCreateChatUsername();
  connectChatWs();

  // Listen for chat username changes from settings window
  window.neonPost.chat.onUsernameChanged((newUsername) => {
    console.log('[Chat] Username changed via settings:', newUsername);
    globalChatUsername = newUsername;
    // Clear any pending reconnect timer and reconnect with new username
    clearTimeout(chatWsReconnectTimer);
    if (chatWs) {
      chatWs.onclose = null; // Prevent auto-reconnect with old handler
      chatWs.close();
      chatWs = null;
    }
    connectChatWs();
    // Update header badge if in chat mode
    if (globalChatMode) updateHeaderTierBadge();
  });

  // Listen for scheduler messages
  window.neonPost.events.onSchedulerMessage((data) => {
    console.log('[Chat] Received scheduler message:', data.jobName, 'sessionId:', data.sessionId, 'currentSession:', currentSessionId);
    handleSchedulerMessage(data);
  });

  // Listen for Telegram messages (cross-channel sync)
  window.neonPost.events.onTelegramMessage((data) => {
    handleTelegramMessage(data);
  });

  // Listen for iOS messages (cross-channel sync)
  window.neonPost.events.onIOSMessage((data) => {
    console.log('[Chat] Received iOS message:', data);
    handleIOSMessage(data);
  });

  // Listen for session clears from iOS
  window.neonPost.sessions.onCleared((sessionId) => {
    console.log('[Chat] Session cleared from iOS:', sessionId);
    if (sessionId === currentSessionId) {
      disableAutoAnimate(); messagesDiv.innerHTML = ''; enableAutoAnimate();
      showEmptyState();
      updateStats();
    }
  });

  // Listen for session changes (e.g., Telegram link/unlink)
  window.neonPost.sessions.onChanged(() => {
    console.log('[Chat] Sessions changed, reloading...');
    loadSessions();
  });

  // Listen for model changes (e.g., changed via Telegram)
  window.neonPost.events.onModelChanged((model) => {
    console.log('[Chat] Model changed to:', model);
    updateModelBadge();
  });

  // Listen for image generation started (show placeholder)
  if (window.neonPost.social?.onImageGenerating) {
    console.log('[Chat] Registering onImageGenerating listener');
    window.neonPost.social.onImageGenerating((data) => {
      console.log('[Chat] onImageGenerating fired:', data.predictionId, data.prompt?.slice(0, 60));
      addImagePlaceholder(data.predictionId, data.prompt, data.model);
    });
  }

  // Listen for generated image results
  if (window.neonPost.social?.onImageReady) {
    console.log('[Chat] Registering onImageReady listener');
    window.neonPost.social.onImageReady((data) => {
      console.log('[Chat] onImageReady fired:', data.predictionId, data.imageUrl?.slice(0, 80));
      replaceImagePlaceholder(data.predictionId, data);
    });
  } else {
    console.warn('[Chat] onImageReady not available on social API');
  }
  if (window.neonPost.social?.onImageFailed) {
    console.log('[Chat] Registering onImageFailed listener');
    window.neonPost.social.onImageFailed((data) => {
      console.log('[Chat] onImageFailed fired:', data.predictionId, data.error);
      replaceImagePlaceholderWithError(data.predictionId, data);
    });
  } else {
    console.warn('[Chat] onImageFailed not available on social API');
  }

  // Listen for repurpose completed — render side-by-side comparison in chat
  if (window.neonPost.social?.onRepurposeCompleted) {
    window.neonPost.social.onRepurposeCompleted((data) => {
      console.log('[Chat] Repurpose completed:', data.platforms?.length ?? 0, 'platforms');
      removePipelinePlaceholder('repurpose');
      if (data.drafts && data.drafts.length && typeof _socReceiveGeneratedContent === 'function') {
        _socReceiveGeneratedContent(data.drafts);
      }
      if (typeof _socRefreshDrafts === 'function') _socRefreshDrafts();
      renderRepurposeComparison(data);
    });
  }

  // Listen for search rate-limit hit — show a user-friendly toast in the chat
  if (window.neonPost.social?.onSearchLimitReached) {
    window.neonPost.social.onSearchLimitReached((data) => {
      console.log('[Chat] Search limit reached:', data.used, '/', data.limit);
      addMessage(
        'error',
        'Search limit reached (' + data.used + '/' + data.limit + ' searches this session). ' +
        'This keeps your API credits safe — start a new chat session to search again.',
        true, [], null, true
      );
    });
  }

  // Listen for pipeline started events — show placeholders
  if (window.neonPost.social?.onSearchStarted) {
    window.neonPost.social.onSearchStarted((data) => {
      console.log('[Chat] Search started:', data.query, 'on', data.platform);
      addPipelinePlaceholder('search-' + data.platform, 'scraping', 'Searching ' + (data.platform || '') + '...', data.platform);
    });
  }

  if (window.neonPost.social?.onProfileStarted) {
    window.neonPost.social.onProfileStarted((data) => {
      console.log('[Chat] Profile scrape started:', data.username, 'on', data.platform);
      var label = 'Scraping @' + (data.username || '').replace(/^@/, '') + '...';
      addPipelinePlaceholder('profile-' + data.platform, 'scraping', label, data.platform);
    });
  }

  if (window.neonPost.social?.onRepurposeStarted) {
    window.neonPost.social.onRepurposeStarted((data) => {
      console.log('[Chat] Repurpose started:', data.platforms);
      var label = 'Repurposing content for ' + (data.platforms || []).join(', ') + '...';
      addPipelinePlaceholder('repurpose', 'repurpose', label, '');
    });
  }

  if (window.neonPost.social?.onRepurposeProgress) {
    window.neonPost.social.onRepurposeProgress((data) => {
      console.log('[Chat] Repurpose progress:', data.stage);
      updatePipelinePlaceholder('repurpose', data.stage);
    });
  }

  // Listen for video upload started — show placeholder
  if (window.neonPost.social?.onVideoUploadStarted) {
    window.neonPost.social.onVideoUploadStarted(function (data) {
      console.log('[Chat] Video upload started:', data.draftId);
      addPipelinePlaceholder('video-upload-' + data.draftId, 'video', 'Uploading video...', '');
    });
  }

  // Listen for video upload completed — remove placeholder
  if (window.neonPost.social?.onVideoUploadCompleted) {
    window.neonPost.social.onVideoUploadCompleted(function (data) {
      console.log('[Chat] Video upload completed:', data.draftId, data.error || 'OK');
      removePipelinePlaceholder('video-upload-' + data.draftId);
    });
  }

  // Listen for video processing stages — show/update placeholder
  if (window.neonPost.social?.onVideoProcessing) {
    window.neonPost.social.onVideoProcessing(function (data) {
      console.log('[Chat] Video processing:', data.stage);
      var id = 'video-pipeline-' + data.platform;
      if (data.stage === 'Done!' || data.error) {
        removePipelinePlaceholder(id);
        if (typeof _socRefreshDrafts === 'function') _socRefreshDrafts();
      } else if (data.stage === 'Uploading video...') {
        addPipelinePlaceholder(id, 'video', data.stage, data.platform);
      } else {
        updatePipelinePlaceholder(id, data.stage);
      }
    });
  }

  // Listen for video generation progress (Generate Copy from Video)
  if (window.neonPost.social?.onVideoProgress) {
    window.neonPost.social.onVideoProgress(function (data) {
      var progressEl = document.querySelector('.soc-video-progress[data-draft-id="' + data.draftId + '"]');
      if (!progressEl) return;

      if (data.step === 'transcribing') {
        var transStep = progressEl.querySelector('[data-step="transcribing"]');
        if (transStep) {
          transStep.classList.add('active');
          transStep.textContent = data.percent >= 100
            ? '\u2713 Transcribing'
            : '\u25CF Transcribing (' + data.percent + '%)';
          if (data.percent >= 100) {
            transStep.classList.remove('active');
            transStep.classList.add('done');
          }
        }
      } else if (data.step === 'generating') {
        var transStep2 = progressEl.querySelector('[data-step="transcribing"]');
        if (transStep2) { transStep2.textContent = '\u2713 Transcribing'; transStep2.classList.add('done'); transStep2.classList.remove('active'); }
        var genStep = progressEl.querySelector('[data-step="generating"]');
        if (genStep) { genStep.classList.add('active'); genStep.textContent = '\u25CF Generate'; }
      } else if (data.step === 'complete') {
        progressEl.querySelectorAll('.soc-video-progress__step').forEach(function (s) {
          s.classList.add('done');
          s.classList.remove('active');
        });
      }
    });
  }

  // Listen for search results pushed from agent — render mini cards in chat + populate Discover cache
  if (window.neonPost.social?.onSearchResultsPushed) {
    window.neonPost.social.onSearchResultsPushed((data) => {
      console.log('[Chat] Search results pushed:', data.results?.length ?? 0, 'items');
      removePipelinePlaceholder('search-' + (data.platform || ''));
      if (typeof _socReceivePushedResults === 'function') _socReceivePushedResults(data);
      if (!data.results || !data.results.length) return;

      var headerLabel = data.results.length + ' results';
      renderMiniCardBlock('search', headerLabel, data.results, data.platform || '');
    });
  }

  // Listen for post changes (created, updated, deleted) — refresh calendar + posts tabs
  if (window.neonPost.social?.onPostChanged) {
    window.neonPost.social.onPostChanged((data) => {
      console.log('[Chat] Post changed:', data.postId, data.platform);
      if (typeof _socRefreshCalendar === 'function') _socRefreshCalendar();
      if (typeof _socRefreshPosts === 'function') _socRefreshPosts();
    });
  }

  // Listen for post published by agent — show toast + refresh Posts/Calendar
  if (window.neonPost.social?.onPostPublished) {
    window.neonPost.social.onPostPublished((data) => {
      console.log('[Chat] Post published:', data.postId, data.platform);
      var platform = (data.platform || '').charAt(0).toUpperCase() + (data.platform || '').slice(1);
      addMessage('system', 'Posted to ' + platform + '!', true, [], null, true);
      if (typeof _socRefreshPosts === 'function') _socRefreshPosts();
      if (typeof _socRefreshCalendar === 'function') _socRefreshCalendar();
    });
  }

  // Listen for schedule created by agent — show toast + refresh Calendar/Posts
  if (window.neonPost.social?.onScheduleCreated) {
    window.neonPost.social.onScheduleCreated((data) => {
      console.log('[Chat] Schedule created:', data.postId, data.platform, data.scheduled_at);
      var dateStr = data.scheduled_at ? new Date(data.scheduled_at).toLocaleString() : 'later';
      var platform = (data.platform || '').charAt(0).toUpperCase() + (data.platform || '').slice(1);
      addMessage('system', 'Scheduled for ' + dateStr + ' on ' + platform, true, [], null, true);
      if (typeof _socRefreshCalendar === 'function') _socRefreshCalendar();
      if (typeof _socRefreshPosts === 'function') _socRefreshPosts();
    });
  }

  // Listen for content saved — refresh Discover Saved tab
  if (window.neonPost.social?.onContentSaved) {
    window.neonPost.social.onContentSaved((data) => {
      console.log('[Chat] Content saved:', data.contentType, data.platform);
      if (typeof _socRefreshDiscoverSaved === 'function') _socRefreshDiscoverSaved();
    });
  }

  // Listen for trending results — render cards in chat + cache in discover tab
  if (window.neonPost.social?.onTrendingResults) {
    window.neonPost.social.onTrendingResults((data) => {
      console.log('[Chat] Trending results:', data.platform, data.results?.length ?? 0, 'items');
      if (typeof _socReceivePushedResults === 'function') _socReceivePushedResults(data);
      if (!data.results || !data.results.length) return;

      var headerLabel = 'Trending on ' + (data.platform || '').toUpperCase();
      renderMiniCardBlock('trending', headerLabel, data.results, data.platform || '');
    });
  }

  // Listen for profile results — render cards in chat + cache in discover tab
  if (window.neonPost.social?.onProfileResults) {
    window.neonPost.social.onProfileResults((data) => {
      console.log('[Chat] Profile results:', data.platform, data.username, data.results?.length ?? 0, 'items');
      removePipelinePlaceholder('profile-' + (data.platform || ''));
      if (typeof _socReceivePushedResults === 'function') _socReceivePushedResults(data);
      if (!data.results || !data.results.length) return;

      var displayName = data.username ? '@' + data.username.replace(/^@/, '') : data.platform || 'Profile';
      var headerLabel = escapeHtml(displayName) + ' on ' + (data.platform || '').toUpperCase();
      renderMiniCardBlock('profile', headerLabel, data.results, data.platform || '');
    });
  }
}

/**
 * Shared renderer for all mini card blocks (search, trending, profile).
 * Inserts a card block into the chat message area.
 */
// eslint-disable-next-line no-unused-vars
function renderMiniCardBlock(type, headerLabel, items, platform) {
  var platformColors = { twitter: '#1da1f2', tiktok: '#fe2c55', instagram: '#e1306c', linkedin: '#0a66c2', youtube: '#ff0000' };
  var accentColor = platformColors[platform] || 'var(--accent)';
  var isTopicStyle = type === 'trending' && platform === 'twitter';

  // Container
  var container = document.createElement('div');
  container.className = 'message mini-card-block';

  // Header
  var header = document.createElement('div');
  header.className = 'mini-card-block-header';
  header.innerHTML = '<span class="mini-card-block-label" style="color:' + accentColor + '">' + headerLabel + '</span>' +
    '<span class="mini-card-block-count">' + items.length + '</span>';
  container.appendChild(header);

  // Grid
  var grid = document.createElement('div');
  grid.className = 'mini-card-grid';

  items.forEach(function (item) {
    var card = document.createElement('div');
    card.className = 'mini-card';
    card.style.borderLeftColor = accentColor;

    var url = item.url || item.source_url || '';
    if (url) card.setAttribute('data-url', url);

    var innerHtml = '';

    if (isTopicStyle) {
      // Twitter trending: rank + topic name + tweet volume
      var rank = item.rank || '';
      var name = item.name || item.title || 'Unknown';
      var volume = item.tweetVolume;
      innerHtml += '<div class="mini-card-rank" style="color:' + accentColor + '">' + rank + '</div>';
      innerHtml += '<div class="mini-card-body">';
      innerHtml += '<div class="mini-card-title">' + escapeHtml(name) + '</div>';
      if (volume) {
        innerHtml += '<div class="mini-card-stats"><span class="mini-card-stat">' + formatCompactNumber(volume) + ' tweets</span></div>';
      }
      innerHtml += '</div>';
    } else {
      // Content card: title, meta, stats, viral score
      var likes = item.likes || item.diggCount || 0;
      var views = item.views || item.playCount || 0;
      var comments = item.comments || item.commentCount || 0;
      var shares = item.shares || item.shareCount || 0;
      var creator = item.creatorUsername || item.source_author || '';
      var title = item.title || item.caption || item.text || item.body || 'Untitled';
      var truncTitle = title.length > 80 ? title.slice(0, 80) + '\u2026' : title;
      var viralScore = item.viralScore || item.viral_score;
      var timeAgo = item.timeAgo || item.time_ago || '';

      innerHtml += '<div class="mini-card-body">';
      innerHtml += '<div class="mini-card-title">' + escapeHtml(truncTitle) + '</div>';

      // Meta row
      var metaParts = [];
      if (creator) metaParts.push('<span class="mini-card-creator">@' + escapeHtml(creator) + '</span>');
      if (timeAgo) metaParts.push('<span class="mini-card-time">' + escapeHtml(timeAgo) + '</span>');
      if (metaParts.length) innerHtml += '<div class="mini-card-meta">' + metaParts.join('') + '</div>';

      // Stats pills
      var stats = [];
      if (views) stats.push('<span class="mini-card-stat">' + formatCompactNumber(views) + ' views</span>');
      if (likes) stats.push('<span class="mini-card-stat">' + formatCompactNumber(likes) + ' likes</span>');
      if (comments) stats.push('<span class="mini-card-stat">' + formatCompactNumber(comments) + ' comments</span>');
      if (shares) stats.push('<span class="mini-card-stat">' + formatCompactNumber(shares) + ' shares</span>');
      if (stats.length) innerHtml += '<div class="mini-card-stats">' + stats.join('') + '</div>';

      innerHtml += '</div>';

      // Viral score badge
      if (viralScore) {
        var vNum = parseFloat(viralScore) || 0;
        var vClass = vNum >= 8 ? 'viral-high' : vNum >= 6 ? 'viral-good' : vNum >= 4 ? 'viral-avg' : 'viral-low';
        innerHtml += '<div class="mini-card-viral ' + vClass + '">' + viralScore + '</div>';
      }
    }

    card.innerHTML = innerHtml;

    if (url) {
      card.addEventListener('click', function () {
        window.neonPost.app.openExternal(url);
      });
    }
    grid.appendChild(card);
  });

  container.appendChild(grid);

  // Navigation link to Discover tab
  var navLink = document.createElement('div');
  navLink.className = 'mini-card-block-nav';
  navLink.innerHTML = '<a href="#">View in Discover \u2192</a>';
  navLink.querySelector('a').addEventListener('click', function (e) {
    e.preventDefault();
    if (typeof navigateToSocialTab === 'function') {
      navigateToSocialTab('discover', 'search');
    }
  });
  container.appendChild(navLink);

  // Insert into chat
  var msgDiv = document.getElementById('messages');
  var statusIndicator = msgDiv.querySelector('.status-indicator');
  if (statusIndicator) {
    msgDiv.insertBefore(container, statusIndicator);
  } else {
    msgDiv.appendChild(container);
  }
  msgDiv.scrollTop = msgDiv.scrollHeight;
}

function formatCompactNumber(n) {
  if (n == null) return '0';
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

/**
 * Called by onboarding.js after setup completes and the transition animation finishes.
 */
// eslint-disable-next-line no-unused-vars
async function initializeChatAfterOnboarding() {
  await initializeChat();
}

window.addEventListener('DOMContentLoaded', async () => {
  // Show app version in titlebar
  try {
    const version = await window.neonPost.app.getVersion();
    document.title = `Neon Post v${version}`;
  } catch (err) {
    console.error('Failed to load app version:', err);
  }

  // Check if onboarding is needed
  const onboardingActive = await checkAndShowOnboarding();

  // Now that we know the state, reveal the UI (prevents sidebar flash)
  document.body.classList.add('app-ready');

  if (onboardingActive) {
    // Onboarding is showing — chat init will happen after it completes
    return;
  }

  // No onboarding needed — initialize chat immediately
  await initializeChat();
});
