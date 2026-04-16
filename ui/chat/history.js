async function loadHistory() {
  try {
    const history = await window.neonPost.agent.getHistory(100, currentSessionId);
    // Detach in-flight image placeholders before clearing DOM
    const savedPlaceholders = [];
    for (const [pid, el] of imagePlaceholders) {
      if (el.parentNode) el.parentNode.removeChild(el);
      savedPlaceholders.push([pid, el]);
    }
    disableAutoAnimate(); messagesDiv.innerHTML = '';

    if (history.length === 0) {
      showEmptyState();
    } else {
      let lastDate = null;
      for (let i = 0; i < history.length; i++) {
        const msg = history[i];
        // Add date separator if needed
        const msgDate = parseSqliteTimestamp(msg.timestamp).toLocaleDateString();
        if (msgDate !== lastDate) {
          addTimestamp(msgDate);
          lastDate = msgDate;
        }

        // Hide routine prompts — only show the agent's response
        if (msg.role === 'user' && msg.metadata?.source === 'scheduler') {
          continue;
        }

        // Strip workflow content from user messages — show badge + user text only
        let displayContent = msg.content;
        let isWorkflowMsg = false;
        if (msg.role === 'user' && msg.content.startsWith('[Workflow: ')) {
          const endBracket = msg.content.indexOf(']');
          const endMarker = msg.content.indexOf('[/Workflow]');
          if (endBracket !== -1 && endMarker !== -1) {
            const workflowName = msg.content.substring(11, endBracket);
            const userText = msg.content.substring(endMarker + 11).replace(/^\n\n/, '').trim();
            displayContent = workflowName + (userText ? ' ' + userText : '');
            isWorkflowMsg = true;
          }
        }

        // Render social result cards (search, trending, profile)
        if (msg.metadata?.type === 'social-results') {
          renderMiniCardBlock(
            msg.metadata.subtype || 'search',
            msg.metadata.headerLabel || `${(msg.metadata.results || []).length} results`,
            msg.metadata.results || [],
            msg.metadata.platform || ''
          );
          continue;
        }

        // Render generated images as image bubbles instead of text
        if (msg.metadata?.type === 'generated-image') {
          renderGeneratedImage({
            imageUrl: msg.metadata.imageUrl,
            prompt: msg.metadata.prompt,
            savedId: msg.metadata.savedId,
          });
          continue;
        }
        if (msg.metadata?.type === 'generated-image-error') {
          renderImageError({
            error: msg.metadata.error,
            prompt: msg.metadata.prompt,
          });
          continue;
        }

        // Render error messages with error style instead of assistant style
        const renderRole = (msg.role === 'assistant' && msg.metadata?.isError) ? 'error' : msg.role;
        const msgEl = addMessage(renderRole, displayContent, false, [], msg.timestamp);
        // Add workflow badge
        if (isWorkflowMsg) {
          msgEl.classList.add('from-workflow');
        }
        // Add scheduled badge if message came from scheduler
        if (msg.metadata?.source === 'scheduler' && msg.metadata?.jobName) {
          msgEl.classList.add('scheduled');
          msgEl.dataset.badge = msg.metadata.jobName;
        }
        // Add Telegram badge if message came from Telegram
        if (msg.metadata?.source === 'telegram') {
          msgEl.classList.add('from-telegram');
          const badge = document.createElement('div');
          badge.className = 'telegram-badge';
          const attachmentLabel = getAttachmentLabel(msg.metadata.hasAttachment, msg.metadata.attachmentType);
          badge.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>${attachmentLabel}`;
          msgEl.insertBefore(badge, msgEl.firstChild);
        }
        // Add iOS badge if message came from mobile
        if (msg.metadata?.source === 'ios') {
          msgEl.classList.add('from-ios');
          const badge = document.createElement('div');
          badge.className = 'ios-badge';
          badge.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path stroke-width="2" d="M12 19h.01"/><path stroke-width="1.5" d="M13.5 2h-3c-2.357 0-3.536 0-4.268.732S5.5 4.643 5.5 7v10c0 2.357 0 3.535.732 4.268S8.143 22 10.5 22h3c2.357 0 3.535 0 4.268-.732c.732-.733.732-1.911.732-4.268V7c0-2.357 0-3.536-.732-4.268C17.035 2 15.857 2 13.5 2"/></g></svg> Mobile`;
          msgEl.insertBefore(badge, msgEl.firstChild);
        }
      }
    }

    // Re-attach in-flight image placeholders for the current session only
    for (const [, el] of savedPlaceholders) {
      if (el.dataset.sessionId === currentSessionId) {
        messagesDiv.appendChild(el);
      }
    }

    enableAutoAnimate();
    scrollToBottom(true); // Instant scroll on initial load
  } catch (err) {
    enableAutoAnimate();
    console.error('Failed to load history:', err);
    showEmptyState();
  }
}

let _appVersion = '';

async function updateStats() {
  try {
    if (!_appVersion) {
      try { _appVersion = await window.neonPost.app.getVersion(); } catch (e) { /* ignore */ }
    }
    const prefix = _appVersion ? `Neon Post v${_appVersion}` : 'Neon Post';
    const stats = await window.neonPost.agent.getStats(currentSessionId);
    if (stats) {
      let parts = [`${stats.messageCount} msgs`];
      if (currentAgentMode !== 'coder') {
        parts.push(`${stats.factCount} facts`);
      }
      if (stats.contextTokens != null && stats.contextWindow) {
        const pct = Math.round((stats.contextTokens / stats.contextWindow) * 100);
        parts.push(`${pct}% context`);
      }

      document.title = `${prefix} — ${parts.join(' · ')}`;
    }
  } catch (err) {
    console.error('Failed to get stats:', err);
  }
}

async function updateModelBadge() {
  try {
    const badge = document.getElementById('model-badge');
    const modelId = await window.neonPost.settings.get('agent.model');
    const fallbackNames = {
      'claude-opus-4-6': 'OPUS 4.6',
      'claude-sonnet-4-6': 'SONNET 4.6',
      'claude-haiku-4-5-20251001': 'HAIKU 4.5',
      'kimi-k2.5': 'KIMI K2.5',
      'glm-5-turbo': 'GLM-5 TURBO',
      'glm-5': 'GLM-5',
      'glm-4.7': 'GLM-4.7',
    };

    let models = [];
    try {
      models = await window.neonPost.settings.getAvailableModels();
    } catch (_) {
      // IPC failed — fall back to single option
    }

    badge.innerHTML = '';

    if (models.length > 0) {
      for (const model of models) {
        const opt = document.createElement('option');
        opt.value = model.id;
        opt.textContent = model.name;
        if (model.id === modelId) opt.selected = true;
        badge.appendChild(opt);
      }
    } else {
      // Fallback: show current model only
      const opt = document.createElement('option');
      opt.value = modelId;
      opt.textContent = fallbackNames[modelId] || modelId.toUpperCase();
      opt.selected = true;
      badge.appendChild(opt);
    }
  } catch (err) {
    console.error('Failed to load model:', err);
  }
}

// Model badge change handler — switch model and auto-reboot
document.getElementById('model-badge').addEventListener('change', async (e) => {
  const newModel = e.target.value;
  const badge = e.target;
  try {
    // Save new model setting
    await window.neonPost.settings.set('agent.model', newModel);
    // Flash badge to indicate switching
    badge.classList.add('badge-attachment');
    // Restart agent with new model
    await window.neonPost.agent.restart();
    // Restore badge color
    badge.classList.remove('badge-attachment');
    await updateModelBadge();
  } catch (err) {
    console.error('Failed to switch model:', err);
    badge.classList.remove('badge-attachment');
    await updateModelBadge();
  }
});

