function addMessage(role, content, animate = true, attachments = [], timestamp = null, showTimestamp = true, media = null) {
  const div = document.createElement('div');
  div.className = `message ${role}`;
  if (!animate) div.style.animation = 'none';

  // Add attachments display for user messages
  if (attachments && attachments.length > 0) {
    const attDiv = document.createElement('div');
    attDiv.className = 'message-attachments';

    for (const att of attachments) {
      const attItem = document.createElement('div');
      attItem.className = 'message-attachment';

      if (att.isImage && att.dataUrl) {
        const img = document.createElement('img');
        img.src = att.dataUrl;
        img.alt = att.name;
        attItem.appendChild(img);
      } else {
        attItem.innerHTML = `<span class="attachment-icon">${escapeHtml(att.ext)}</span> ${escapeHtml(att.name)}`;
      }

      attDiv.appendChild(attItem);
    }

    div.appendChild(attDiv);
  }

  // Add text content
  if (content) {
    const contentDiv = document.createElement('div');
    // Format error messages with structured layout
    if (role === 'error') {
      contentDiv.innerHTML = formatErrorContent(content);
    } else {
      contentDiv.innerHTML = formatContent(content);
    }
    // Append children directly to avoid nesting issues
    while (contentDiv.firstChild) {
      div.appendChild(contentDiv.firstChild);
    }
    // Intercept link and image clicks
    div.addEventListener('click', (e) => {
      // Open links in external browser
      const link = e.target.closest('a[href]');
      if (link) {
        e.preventDefault();
        const href = link.getAttribute('href');
        // Handle internal neon:// navigation links (e.g. neon://social/discover)
        if (href && href.startsWith('neon://')) {
          const parts = href.replace('neon://', '').split('/');
          if (parts[0] === 'social' && typeof navigateToSocialTab === 'function') {
            navigateToSocialTab(parts[1] || 'discover', parts[2] || null);
          }
          return;
        }
        if (href && (href.startsWith('http://') || href.startsWith('https://'))) {
          window.neonPost.app.openExternal(href);
        }
        return;
      }
      // Open markdown-rendered images in default image viewer
      if (e.target.tagName === 'IMG' && !e.target.closest('.message-media')) {
        const src = e.target.getAttribute('src');
        if (src) {
          window.neonPost.app.openImage(src);
        }
        return;
      }
      // Open attached files from history
      const attEl = e.target.closest('.message-attachment[data-path]');
      if (attEl) {
        window.neonPost.app.openPath(attEl.dataset.path);
      }
    });
  }

  // Add response media images (from agent screenshots/tools)
  if (media && media.length > 0) {
    const imageItems = media.filter(m => m.type === 'image');
    const isCarousel = imageItems.length >= 3;

    if (isCarousel) {
      // Render as a scrollable carousel with arrows and dots
      const carousel = document.createElement('div');
      carousel.className = 'message-media message-carousel';

      const track = document.createElement('div');
      track.className = 'message-carousel-track';

      let currentSlide = 0;

      for (const item of imageItems) {
        const slide = document.createElement('div');
        slide.className = 'message-carousel-slide';

        const img = document.createElement('img');
        img.alt = 'Carousel slide';
        img.loading = 'lazy';

        if (item.dataUri) {
          img.src = item.dataUri;
        } else if (item.filePath) {
          window.neonPost.agent.readMedia(item.filePath).then(dataUri => {
            if (dataUri) img.src = dataUri;
          });
        }

        if (item.filePath) {
          img.title = 'Click to open';
          img.addEventListener('click', () => {
            window.neonPost.app.openImage(item.filePath);
          });
        }

        slide.appendChild(img);
        track.appendChild(slide);
      }

      carousel.appendChild(track);

      // Navigation arrows
      const prevBtn = document.createElement('button');
      prevBtn.className = 'message-carousel-arrow message-carousel-prev';
      prevBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="m15 18-6-6 6-6"/></svg>';
      carousel.appendChild(prevBtn);

      const nextBtn = document.createElement('button');
      nextBtn.className = 'message-carousel-arrow message-carousel-next';
      nextBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="m9 18 6-6-6-6"/></svg>';
      carousel.appendChild(nextBtn);

      // Dots + counter
      const footer = document.createElement('div');
      footer.className = 'message-carousel-footer';

      const dots = document.createElement('div');
      dots.className = 'message-carousel-dots';
      for (let i = 0; i < imageItems.length; i++) {
        const dot = document.createElement('span');
        dot.className = 'message-carousel-dot' + (i === 0 ? ' active' : '');
        dot.addEventListener('click', () => goToSlide(i));
        dots.appendChild(dot);
      }
      footer.appendChild(dots);

      const counter = document.createElement('span');
      counter.className = 'message-carousel-counter';
      counter.textContent = '1 / ' + imageItems.length;
      footer.appendChild(counter);

      carousel.appendChild(footer);

      function goToSlide(idx) {
        currentSlide = Math.max(0, Math.min(idx, imageItems.length - 1));
        track.style.transform = 'translateX(-' + (currentSlide * 100) + '%)';
        dots.querySelectorAll('.message-carousel-dot').forEach((d, i) => {
          d.classList.toggle('active', i === currentSlide);
        });
        counter.textContent = (currentSlide + 1) + ' / ' + imageItems.length;
      }

      prevBtn.addEventListener('click', () => goToSlide(currentSlide - 1));
      nextBtn.addEventListener('click', () => goToSlide(currentSlide + 1));

      div.appendChild(carousel);
    } else {
      // Regular media display (1-2 images)
      const mediaDiv = document.createElement('div');
      mediaDiv.className = 'message-media';

      for (const item of imageItems) {
        const img = document.createElement('img');
        img.alt = 'Agent image';
        img.loading = 'lazy';

        if (item.dataUri) {
          img.src = item.dataUri;
        } else if (item.filePath) {
          window.neonPost.agent.readMedia(item.filePath).then(dataUri => {
            if (dataUri) img.src = dataUri;
          });
        }

        if (item.filePath) {
          img.title = 'Click to open';
          img.addEventListener('click', () => {
            window.neonPost.app.openImage(item.filePath);
          });
        }

        mediaDiv.appendChild(img);
      }

      div.appendChild(mediaDiv);
    }
  }

  // Add footer with copy button and timestamp
  if (showTimestamp) {
    const ts = timestamp ? parseSqliteTimestamp(timestamp) : new Date();
    const footerDiv = document.createElement('div');
    footerDiv.className = 'message-footer';

    // Copy button
    const copyBtn = document.createElement('button');
    copyBtn.className = 'message-copy-btn';
    copyBtn.title = 'Copy';
    copyBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"><path d="M9 15c0-2.828 0-4.243.879-5.121C10.757 9 12.172 9 15 9h1c2.828 0 4.243 0 5.121.879C22 10.757 22 12.172 22 15v1c0 2.828 0 4.243-.879 5.121C20.243 22 18.828 22 16 22h-1c-2.828 0-4.243 0-5.121-.879C9 20.243 9 18.828 9 16z"/><path d="M17 9c-.003-2.957-.047-4.489-.908-5.538a4 4 0 0 0-.554-.554C14.43 2 12.788 2 9.5 2c-3.287 0-4.931 0-6.038.908a4 4 0 0 0-.554.554C2 4.57 2 6.212 2 9.5c0 3.287 0 4.931.908 6.038a4 4 0 0 0 .554.554c1.05.86 2.58.906 5.538.908"/></g></svg>`;
    copyBtn.onclick = (e) => {
      e.stopPropagation();
      copyMessageText(div, copyBtn);
    };
    footerDiv.appendChild(copyBtn);

    // Timestamp
    const timestampDiv = document.createElement('div');
    timestampDiv.className = 'message-timestamp';
    timestampDiv.textContent = formatTimestamp(ts);
    footerDiv.appendChild(timestampDiv);

    div.appendChild(footerDiv);
  }

  // Insert before status indicator if one exists (keeps indicator at bottom)
  const statusIndicator = messagesDiv.querySelector('.status-indicator');
  if (statusIndicator) {
    messagesDiv.insertBefore(div, statusIndicator);
  } else {
    messagesDiv.appendChild(div);
  }
  return div;
}

// Parse SQLite timestamp consistently (SQLite stores UTC with 'Z' suffix)
function parseSqliteTimestamp(timestamp) {
  if (!timestamp) return new Date();

  // Check if timestamp has an explicit timezone indicator (Z, +HH:MM, -HH:MM, +HHMM, -HHMM)
  const hasTimezone = /Z$|[+-]\d{2}:?\d{2}$/.test(timestamp);

  if (hasTimezone) {
    // Already has timezone info, parse directly
    return new Date(timestamp);
  }

  // Legacy fallback: old timestamps without timezone (assumed UTC)
  const normalized = timestamp.replace(' ', 'T');
  return new Date(normalized + 'Z');
}

function formatTimestamp(date) {
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();

  const timeStr = date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });

  if (isToday) {
    return `Today, ${timeStr}`;
  }

  const dateStr = date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric'
  });

  return `${dateStr}, ${timeStr}`;
}

function formatErrorContent(text) {
  const escaped = escapeHtml(text);
  // Strip report hint — badge is enough context
  const reportHint = 'If this keeps happening, send this error to the developer.';
  const mainText = escaped.replace(reportHint, '').trim();

  // Extract error code if present: [error_code]
  const codeMatch = mainText.match(/\[([a-z_]+)\]/);
  const errorCode = codeMatch ? codeMatch[1] : null;
  const body = codeMatch ? mainText.replace(/\s*\[[a-z_]+\]/, '').trim() : mainText;

  let html = `<div class="error-body">${body}</div>`;
  if (errorCode) {
    html += `<div class="error-code">${errorCode}</div>`;
  }
  return html;
}

function formatContent(text) {
  // Pre-process: convert attachment markers into styled chips before markdown
  // Handles: [Attached document: name], [Attached PDF: name], [Attached image: name], etc.
  // Also strips trailing extracted content code block if present
  text = text.replace(
    /\[Attached [^\]]*?: ([^\]]+)\]\nFile saved at: ([^\n]+)\n(?:Use the Read tool to view this [^\n]*\.)?(?:\n*```[\s\S]*?```)?/g,
    (_, name, filePath) => {
      const ext = name.split('.').pop()?.toLowerCase() || '';
      const safeExt = ext.replace(/[<>&"']/g, '');
      const safeName = name.replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]));
      const safePath = filePath.replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]));
      return `\n<div class="message-attachment" data-path="${safePath}" style="cursor:pointer" title="${safePath}"><span class="attachment-icon">${safeExt}</span> ${safeName}</div>\n`;
    }
  );
  // Handle legacy [File: name] format (old extracted documents stored without path)
  // Also strips the code block that follows
  text = text.replace(
    /\[File: ([^\]]+\.(?:docx|pptx|xlsx|odt|odp|ods|rtf))\]\n(?:```[\s\S]*?```)?/gi,
    (_, name) => {
      const ext = name.split('.').pop()?.toLowerCase() || '';
      const safeExt = ext.replace(/[<>&"']/g, '');
      const safeName = name.replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]));
      return `<div class="message-attachment"><span class="attachment-icon">${safeExt}</span> ${safeName}</div>\n`;
    }
  );

  // Use marked for full markdown rendering (only when DOMPurify is available to sanitize)
  if (typeof marked !== 'undefined' && typeof DOMPurify !== 'undefined') {
    marked.setOptions({
      breaks: true, // Convert \n to <br>
      gfm: true, // GitHub flavored markdown
    });
    let html = marked.parse(text);
    // Wrap tables in scrollable container
    html = html.replace(/<table>/g, '<div class="table-wrapper"><table>');
    html = html.replace(/<\/table>/g, '</table></div>');
    // Sanitize to prevent XSS from untrusted message sources (Telegram, iOS, agent responses)
    html = DOMPurify.sanitize(html, {
      ADD_ATTR: ['data-path', 'target'],
      ADD_URI_SAFE_ATTR: ['href'],
      ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|neon):)/i,
    });
    return html;
  }
  // Fallback: escape HTML (when marked or DOMPurify isn't loaded)
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function addTimestamp(date) {
  const div = document.createElement('div');
  div.className = 'timestamp';
  div.textContent = date;
  messagesDiv.appendChild(div);
}

function addTyping() {
  const div = document.createElement('div');
  div.className = 'typing';
  div.innerHTML = '<div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>';
  messagesDiv.appendChild(div);
  return div;
}

function addStatusIndicator(initialMessage) {
  const div = document.createElement('div');
  div.className = 'status-indicator';
  div.innerHTML = `
    <div class="status-spinner"></div>
    <div class="status-content">
      <div class="status-action">${escapeHtml(initialMessage)}</div>
      <div class="status-detail"></div>
      <div class="status-preview"></div>
    </div>
    <div class="status-count hidden"></div>
  `;
  messagesDiv.appendChild(div);
  return div;
}

function updateStatusIndicator(status, sessionId) {
  // Use status.sessionId (from the event) as authoritative source, fall back to listener's sessionId, then currentSessionId
  const targetSession = status.sessionId || sessionId || currentSessionId;

  // GUARD: If the event has a sessionId, only the listener registered for that session should process it.
  // Without this, multiple session listeners all accumulate partial_text, causing duplicates.
  if (sessionId && status.sessionId && sessionId !== status.sessionId) return;

  // Allow notification sound for any session completing (even non-active)
  if (status.type === 'done' && targetSession !== currentSessionId) {
    playNotificationSound();
    return;
  }

  // GUARD: Never render status/streaming UI for a session that isn't currently displayed.
  // This prevents events from session A leaking into session B's UI when both are active
  // (e.g. general mode still processing while user switched to coder session).
  if (targetSession !== currentSessionId) return;

  // Handle background tasks before status element check — they use a separate UI area
  if (status.type === 'background_task_start') {
    if (status.backgroundTaskId) {
      addBackgroundTask(
        status.sessionId || targetSession,
        status.backgroundTaskId,
        status.toolName || 'task',
        status.backgroundTaskDescription || 'background task'
      );
    }
    return;
  } else if (status.type === 'background_task_output') {
    return;
  } else if (status.type === 'background_task_end') {
    if (status.backgroundTaskId) {
      removeBackgroundTask(status.sessionId || targetSession, status.backgroundTaskId);
    }
    return;
  }

  const statusEl = statusElBySession.get(targetSession);
  if (!statusEl) return;

  const actionEl = statusEl.querySelector('.status-action');
  const detailEl = statusEl.querySelector('.status-detail');
  const previewEl = statusEl.querySelector('.status-preview');
  const countEl = statusEl.querySelector('.status-count');

  // Clear preview when switching to a non-preview status
  if (status.type !== 'partial_text' && previewEl) {
    previewEl.textContent = '';
    previewEl.classList.add('hidden');
  }

  // Re-show the status indicator when switching away from streaming text
  if (status.type !== 'partial_text' && statusEl.style.display === 'none') {
    statusEl.style.display = '';
  }

  if (status.type === 'thinking') {
    // Don't overwrite blocked state
    if (!statusEl.classList.contains('tool-blocked')) {
      actionEl.textContent = status.message || '*stretches paws* thinking...';
      detailEl.textContent = '';
      detailEl.classList.add('hidden');
      statusEl.classList.remove('subagent-active');
      statusEl.classList.remove('pocket-cli-active');
      statusEl.classList.remove('team-active');
      statusEl.classList.remove('plan-mode-active');
    }
  } else if (status.type === 'tool_start') {
    // Increment tool call counter
    const count = (toolCountBySession.get(targetSession) || 0) + 1;
    toolCountBySession.set(targetSession, count);
    if (countEl) {
      countEl.textContent = count === 1 ? '1 tool' : `${count} tools`;
      countEl.classList.remove('hidden');
    }

    actionEl.textContent = status.toolName || 'pouncing on it...';
    if (status.toolInput) {
      detailEl.textContent = status.toolInput;
      detailEl.title = status.toolInput;
      detailEl.classList.remove('hidden');
    } else {
      detailEl.textContent = '';
      detailEl.classList.add('hidden');
    }
    statusEl.classList.remove('subagent-active');
    statusEl.classList.remove('team-active');
    statusEl.classList.remove('plan-mode-active');
    if (status.isPocketCli) {
      statusEl.classList.add('pocket-cli-active');
    } else {
      statusEl.classList.remove('pocket-cli-active');
    }
  } else if (status.type === 'tool_end') {
    // Don't overwrite blocked state - keep showing the block message
    if (!statusEl.classList.contains('tool-blocked')) {
      actionEl.textContent = status.message || 'caught it! processing...';
      detailEl.textContent = '';
      detailEl.classList.add('hidden');
      statusEl.classList.remove('subagent-active');
      statusEl.classList.remove('pocket-cli-active');
      statusEl.classList.remove('team-active');
      statusEl.classList.remove('plan-mode-active');
    }
  } else if (status.type === 'tool_blocked') {
    // Safety hook blocked a dangerous command
    statusEl.classList.add('tool-blocked');
    actionEl.textContent = status.message || '🙀 whoa! not allowed!';
    if (status.blockedReason) {
      detailEl.textContent = status.blockedReason;
      detailEl.title = status.blockedReason;
      detailEl.classList.remove('hidden');
    } else {
      detailEl.textContent = '';
      detailEl.classList.add('hidden');
    }
    statusEl.classList.remove('subagent-active');
    statusEl.classList.remove('pocket-cli-active');
    statusEl.classList.remove('team-active');
  } else if (status.type === 'subagent_start') {
    // Subagent spawned - show special status
    statusEl.classList.add('subagent-active');
    statusEl.classList.remove('pocket-cli-active');
    actionEl.textContent = status.message || 'summoning cat friends';
    if (status.toolInput) {
      const countBadge = status.agentCount > 1 ? ` (${status.agentCount} active)` : '';
      detailEl.textContent = status.toolInput + countBadge;
      detailEl.title = status.toolInput;
      detailEl.classList.remove('hidden');
    } else {
      detailEl.textContent = status.agentCount > 1 ? `${status.agentCount} helpers active` : '';
      detailEl.classList.toggle('hidden', !(status.agentCount > 1));
    }
  } else if (status.type === 'subagent_update') {
    // Multiple subagents, one finished
    actionEl.textContent = status.message || `${status.agentCount} kitties on the job`;
    detailEl.textContent = '';
    detailEl.classList.add('hidden');
  } else if (status.type === 'subagent_end') {
    // All subagents done
    statusEl.classList.remove('subagent-active');
    statusEl.classList.remove('pocket-cli-active');
    statusEl.classList.remove('team-active');
    actionEl.textContent = status.message || 'cat squad finished! ✨';
    detailEl.textContent = '';
    detailEl.classList.add('hidden');
  } else if (status.type === 'teammate_start') {
    // Teammate spawned - show team status
    statusEl.classList.add('team-active');
    statusEl.classList.remove('subagent-active');
    statusEl.classList.remove('pocket-cli-active');
    actionEl.textContent = status.message || 'rallying the squad';
    if (status.teammateName) {
      detailEl.textContent = status.teammateName + (status.toolInput ? ': ' + status.toolInput : '');
      detailEl.title = detailEl.textContent;
      detailEl.classList.remove('hidden');
    } else {
      detailEl.textContent = '';
      detailEl.classList.add('hidden');
    }
  } else if (status.type === 'teammate_message') {
    // Message sent between teammates
    statusEl.classList.add('team-active');
    statusEl.classList.remove('subagent-active');
    statusEl.classList.remove('pocket-cli-active');
    actionEl.textContent = status.message || 'passing a note';
    if (status.toolInput) {
      detailEl.textContent = status.toolInput;
      detailEl.title = status.toolInput;
      detailEl.classList.remove('hidden');
    } else {
      detailEl.textContent = '';
      detailEl.classList.add('hidden');
    }
  } else if (status.type === 'teammate_idle') {
    // Teammate went idle
    statusEl.classList.add('team-active');
    statusEl.classList.remove('subagent-active');
    statusEl.classList.remove('pocket-cli-active');
    actionEl.textContent = status.message || 'teammate idle';
    if (status.teammateName) {
      detailEl.textContent = status.teammateName + ' finished their part';
      detailEl.classList.remove('hidden');
    } else {
      detailEl.textContent = '';
      detailEl.classList.add('hidden');
    }
  } else if (status.type === 'task_completed') {
    // Team task completed
    statusEl.classList.add('team-active');
    statusEl.classList.remove('subagent-active');
    statusEl.classList.remove('pocket-cli-active');
    actionEl.textContent = status.message || 'task done!';
    if (status.taskSubject) {
      const by = status.teammateName ? ` (by ${status.teammateName})` : '';
      detailEl.textContent = status.taskSubject + by;
      detailEl.title = detailEl.textContent;
      detailEl.classList.remove('hidden');
    } else {
      detailEl.textContent = '';
      detailEl.classList.add('hidden');
    }
  } else if (status.type === 'plan_mode_entered') {
    statusEl.classList.add('plan-mode-active');
    statusEl.classList.remove('subagent-active');
    statusEl.classList.remove('pocket-cli-active');
    statusEl.classList.remove('team-active');
    actionEl.textContent = status.message || 'planning the pounce...';
    detailEl.textContent = '';
    detailEl.classList.add('hidden');
  } else if (status.type === 'plan_mode_exited') {
    statusEl.classList.remove('plan-mode-active');
    actionEl.textContent = status.message || 'plan ready for review';
    detailEl.textContent = '';
    detailEl.classList.add('hidden');
  } else if (status.type === 'partial_text') {
    // Show live-updating assistant bubble with composed text
    if (status.partialText && status.sessionId) {
      let bubble = streamingBubbleBySession.get(status.sessionId);
      if (!bubble) {
        bubble = document.createElement('div');
        bubble.className = 'message assistant streaming-bubble';
        // Insert before the status indicator
        if (statusEl && statusEl.parentNode) {
          statusEl.parentNode.insertBefore(bubble, statusEl);
        } else {
          messagesDiv.appendChild(bubble);
        }
        streamingBubbleBySession.set(status.sessionId, bubble);
      }
      // Hide the status indicator while streaming text is visible to prevent jumpiness
      if (statusEl) {
        statusEl.style.display = 'none';
      }
      // partialReplace: full text from coder mode (replace entirely)
      // otherwise: delta from general mode (accumulate with separator)
      const prev = streamingTextBySession.get(status.sessionId) || '';
      const accumulated = status.partialReplace
        ? status.partialText
        : prev + status.partialText;
      streamingTextBySession.set(status.sessionId, accumulated);
      // Throttle DOM updates with RAF — skip if a render is already queued
      if (!streamingRafBySession.has(status.sessionId)) {
        const rafId = requestAnimationFrame(() => {
          streamingRafBySession.delete(status.sessionId);
          const currentBubble = streamingBubbleBySession.get(status.sessionId);
          if (!currentBubble) return;
          const text = streamingTextBySession.get(status.sessionId) || '';
          // Re-render all accumulated text
          const contentDiv = document.createElement('div');
          contentDiv.innerHTML = formatContent(text);
          currentBubble.innerHTML = '';
          while (contentDiv.firstChild) {
            currentBubble.appendChild(contentDiv.firstChild);
          }
          // Only scroll if user is near the bottom (within 120px)
          const distFromBottom = messagesDiv.scrollHeight - messagesDiv.scrollTop - messagesDiv.clientHeight;
          if (distFromBottom < 120) {
            scrollToBottom();
          }
        });
        streamingRafBySession.set(status.sessionId, rafId);
      }
    }
  } else if (status.type === 'responding') {
    actionEl.textContent = 'grooming my response... 🐈';
    detailEl.textContent = '';
    detailEl.classList.add('hidden');
    statusEl.classList.remove('subagent-active');
    statusEl.classList.remove('pocket-cli-active');
    statusEl.classList.remove('team-active');
  } else if (status.type === 'queued') {
    // Message was queued - show queue position
    actionEl.textContent = status.message || 'in the litter queue 📋';
    if (status.queuePosition) {
      detailEl.textContent = `Position #${status.queuePosition} in queue`;
      detailEl.classList.remove('hidden');
    } else {
      detailEl.textContent = '';
      detailEl.classList.add('hidden');
    }
    statusEl.classList.remove('subagent-active');
    statusEl.classList.remove('pocket-cli-active');
    statusEl.classList.remove('team-active');
  } else if (status.type === 'queue_processing') {
    // Now processing a queued message
    actionEl.textContent = status.message || 'digging it up now...';
    if (status.queuedMessage) {
      detailEl.textContent = status.queuedMessage;
      detailEl.title = status.queuedMessage;
      detailEl.classList.remove('hidden');
    } else {
      detailEl.textContent = '';
      detailEl.classList.add('hidden');
    }
    statusEl.classList.remove('subagent-active');
    statusEl.classList.remove('pocket-cli-active');
    statusEl.classList.remove('team-active');

    // Remove 'queued' class from the oldest queued message since it's now processing
    const queuedMsgs = messagesDiv.querySelectorAll('.message.queued');
    if (queuedMsgs.length > 0) {
      queuedMsgs[0].classList.remove('queued');
    }
  } else if (status.type === 'done') {
    // Don't touch streaming bubble here — response handler finalizes it
    // Response complete - play notification sound
    playNotificationSound();
  }

  scrollToBottom();
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function copyMessageText(messageEl, copyBtn) {
  // Get text content, excluding footer (timestamp, copy button)
  const clone = messageEl.cloneNode(true);
  const footer = clone.querySelector('.message-footer');
  if (footer) footer.remove();
  const attachments = clone.querySelector('.message-attachments');
  if (attachments) attachments.remove();

  const text = clone.textContent.trim();

  navigator.clipboard.writeText(text).then(() => {
    // Show copied state
    copyBtn.classList.add('copied');
    copyBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M5 14.5s1.5 0 3.5 3.5c0 0 5.559-9.167 10.5-11"/></svg>`;

    setTimeout(() => {
      copyBtn.classList.remove('copied');
      copyBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"><path d="M9 15c0-2.828 0-4.243.879-5.121C10.757 9 12.172 9 15 9h1c2.828 0 4.243 0 5.121.879C22 10.757 22 12.172 22 15v1c0 2.828 0 4.243-.879 5.121C20.243 22 18.828 22 16 22h-1c-2.828 0-4.243 0-5.121-.879C9 20.243 9 18.828 9 16z"/><path d="M17 9c-.003-2.957-.047-4.489-.908-5.538a4 4 0 0 0-.554-.554C14.43 2 12.788 2 9.5 2c-3.287 0-4.931 0-6.038.908a4 4 0 0 0-.554.554C2 4.57 2 6.212 2 9.5c0 3.287 0 4.931.908 6.038a4 4 0 0 0 .554.554c1.05.86 2.58.906 5.538.908"/></g></svg>`;
    }, 1500);
  }).catch(err => {
    console.error('Failed to copy:', err);
  });
}

// eslint-disable-next-line no-unused-vars
function renderGeneratedImage({ imageUrl, prompt, savedId }) {
  console.log('[MessageRenderer] renderGeneratedImage called:', { imageUrl: imageUrl?.slice(0, 80), prompt: prompt?.slice(0, 60), savedId });
  const div = document.createElement('div');
  div.className = 'message assistant generated-image-bubble';

  const imgWrap = document.createElement('div');
  imgWrap.className = 'image-bubble-wrap';

  const img = document.createElement('img');
  img.src = imageUrl;
  img.alt = prompt || 'Generated image';
  imgWrap.appendChild(img);

  imgWrap.appendChild(buildImageActionBar(imageUrl));
  div.appendChild(imgWrap);

  const caption = document.createElement('div');
  caption.className = 'caption';
  const truncated = prompt && prompt.length > 120 ? prompt.slice(0, 120) + '…' : (prompt || '');
  caption.textContent = truncated;
  div.appendChild(caption);

  if (savedId) {
    const badge = document.createElement('div');
    badge.className = 'badge';
    badge.textContent = '✓ Saved to gallery';
    div.appendChild(badge);
  }

  const statusIndicator = messagesDiv.querySelector('.status-indicator');
  if (statusIndicator) {
    messagesDiv.insertBefore(div, statusIndicator);
  } else {
    messagesDiv.appendChild(div);
  }
  scrollToBottom();
}

// eslint-disable-next-line no-unused-vars
function renderImageError({ error, prompt }) {
  const div = document.createElement('div');
  div.className = 'message assistant';

  const text = document.createElement('span');
  const promptInfo = prompt ? ` for "${prompt.length > 80 ? prompt.slice(0, 80) + '…' : prompt}"` : '';
  text.textContent = `❌ Image generation failed${promptInfo}: ${error}`;
  div.appendChild(text);

  if (prompt) {
    const retryBtn = document.createElement('button');
    retryBtn.className = 'image-retry-btn';
    retryBtn.textContent = 'Retry';
    retryBtn.addEventListener('click', () => {
      retryBtn.disabled = true;
      retryBtn.textContent = 'Retrying…';
      window.neonPost.social.generateImage({ prompt }).catch(() => {
        retryBtn.disabled = false;
        retryBtn.textContent = 'Retry';
      });
    });
    div.appendChild(retryBtn);
  }

  const statusIndicator = messagesDiv.querySelector('.status-indicator');
  if (statusIndicator) {
    messagesDiv.insertBefore(div, statusIndicator);
  } else {
    messagesDiv.appendChild(div);
  }
  scrollToBottom();
}

// Image generation placeholder tracking
// eslint-disable-next-line no-unused-vars
const imagePlaceholders = new Map();

// eslint-disable-next-line no-unused-vars
function addImagePlaceholder(predictionId, prompt) {
  const div = document.createElement('div');
  div.className = 'message assistant generated-image-bubble image-generating';
  div.dataset.sessionId = currentSessionId;

  const shimmer = document.createElement('div');
  shimmer.className = 'image-generating-shimmer';
  div.appendChild(shimmer);

  const label = document.createElement('div');
  label.className = 'image-generating-label';
  label.textContent = 'Generating...';
  div.appendChild(label);

  if (prompt) {
    const caption = document.createElement('div');
    caption.className = 'caption';
    const truncated = prompt.length > 120 ? prompt.slice(0, 120) + '…' : prompt;
    caption.textContent = truncated;
    div.appendChild(caption);
  }

  const statusIndicator = messagesDiv.querySelector('.status-indicator');
  if (statusIndicator) {
    messagesDiv.insertBefore(div, statusIndicator);
  } else {
    messagesDiv.appendChild(div);
  }
  imagePlaceholders.set(predictionId, div);
  scrollToBottom();
}

// eslint-disable-next-line no-unused-vars
function replaceImagePlaceholder(predictionId, data) {
  const placeholder = imagePlaceholders.get(predictionId);
  if (!placeholder) {
    // No placeholder (e.g. app restarted) — fall back to appending
    renderGeneratedImage(data);
    return;
  }
  imagePlaceholders.delete(predictionId);

  // Build the real image bubble in-place
  placeholder.className = 'message assistant generated-image-bubble';
  placeholder.innerHTML = '';

  const imgWrap = document.createElement('div');
  imgWrap.className = 'image-bubble-wrap';

  const img = document.createElement('img');
  img.src = data.imageUrl;
  img.alt = data.prompt || 'Generated image';
  imgWrap.appendChild(img);

  imgWrap.appendChild(buildImageActionBar(data.imageUrl));
  placeholder.appendChild(imgWrap);

  const caption = document.createElement('div');
  caption.className = 'caption';
  const truncated = data.prompt && data.prompt.length > 120 ? data.prompt.slice(0, 120) + '…' : (data.prompt || '');
  caption.textContent = truncated;
  placeholder.appendChild(caption);

  if (data.savedId) {
    const badge = document.createElement('div');
    badge.className = 'badge';
    badge.textContent = '✓ Saved to gallery';
    placeholder.appendChild(badge);
  }

  scrollToBottom();
}

// eslint-disable-next-line no-unused-vars
function replaceImagePlaceholderWithError(predictionId, data) {
  const placeholder = imagePlaceholders.get(predictionId);
  if (!placeholder) {
    renderImageError(data);
    return;
  }
  imagePlaceholders.delete(predictionId);
  placeholder.className = 'message assistant';
  placeholder.innerHTML = '';

  const text = document.createElement('span');
  const promptInfo = data.prompt ? ` for "${data.prompt.length > 80 ? data.prompt.slice(0, 80) + '…' : data.prompt}"` : '';
  text.textContent = `❌ Image generation failed${promptInfo}: ${data.error}`;
  placeholder.appendChild(text);

  if (data.prompt) {
    const retryBtn = document.createElement('button');
    retryBtn.className = 'image-retry-btn';
    retryBtn.textContent = 'Retry';
    retryBtn.addEventListener('click', () => {
      retryBtn.disabled = true;
      retryBtn.textContent = 'Retrying…';
      window.neonPost.social.generateImage({ prompt: data.prompt }).catch(() => {
        retryBtn.disabled = false;
        retryBtn.textContent = 'Retry';
      });
    });
    placeholder.appendChild(retryBtn);
  }

  scrollToBottom();
}

// Pipeline placeholder tracking
// eslint-disable-next-line no-unused-vars
const pipelinePlaceholders = new Map();

const pipelinePlatformColors = {
  x: 'rgba(29, 155, 240, 0.5)',
  twitter: 'rgba(29, 155, 240, 0.5)',
  instagram: 'rgba(225, 48, 108, 0.5)',
  tiktok: 'rgba(0, 242, 234, 0.5)',
  linkedin: 'rgba(10, 102, 194, 0.5)',
  youtube: 'rgba(255, 0, 0, 0.5)',
};

// eslint-disable-next-line no-unused-vars
function addPipelinePlaceholder(id, type, label, platform) {
  const div = document.createElement('div');
  div.className = 'message assistant pipeline-placeholder pipeline-' + (type || 'scraping');
  div.dataset.sessionId = currentSessionId;
  div.dataset.pipelineId = id;

  if (platform && pipelinePlatformColors[platform.toLowerCase()]) {
    div.style.borderLeftColor = pipelinePlatformColors[platform.toLowerCase()];
  }

  const shimmer = document.createElement('div');
  shimmer.className = 'pipeline-placeholder-shimmer';
  div.appendChild(shimmer);

  const labelEl = document.createElement('div');
  labelEl.className = 'pipeline-placeholder-label';
  labelEl.textContent = label || 'Processing...';
  div.appendChild(labelEl);

  const statusIndicator = messagesDiv.querySelector('.status-indicator');
  if (statusIndicator) {
    messagesDiv.insertBefore(div, statusIndicator);
  } else {
    messagesDiv.appendChild(div);
  }
  pipelinePlaceholders.set(id, div);
  scrollToBottom();
}

// eslint-disable-next-line no-unused-vars
function updatePipelinePlaceholder(id, label) {
  const placeholder = pipelinePlaceholders.get(id);
  if (!placeholder) return;
  const labelEl = placeholder.querySelector('.pipeline-placeholder-label');
  if (labelEl) labelEl.textContent = label;
}

// eslint-disable-next-line no-unused-vars
function removePipelinePlaceholder(id) {
  const placeholder = pipelinePlaceholders.get(id);
  if (!placeholder) return;
  pipelinePlaceholders.delete(id);
  placeholder.remove();
}

// Build hover action bar for generated image bubbles
function buildImageActionBar(imageUrl) {
  const bar = document.createElement('div');
  bar.className = 'image-action-bar';

  // Download
  const dlBtn = document.createElement('button');
  dlBtn.title = 'Download';
  dlBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v13m0 0l-4-4m4 4l4-4M4 19h16"/></svg>';
  dlBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const a = document.createElement('a');
    a.href = imageUrl;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  });
  bar.appendChild(dlBtn);

  // Copy URL
  const copyBtn = document.createElement('button');
  copyBtn.title = 'Copy URL';
  copyBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>';
  copyBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(imageUrl).then(() => {
      copyBtn.title = 'Copied!';
      copyBtn.classList.add('copied');
      setTimeout(() => { copyBtn.title = 'Copy URL'; copyBtn.classList.remove('copied'); }, 1500);
    });
  });
  bar.appendChild(copyBtn);

  // Open external
  const openBtn = document.createElement('button');
  openBtn.title = 'Open in browser';
  openBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';
  openBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    window.neonPost.app.openExternal(imageUrl);
  });
  bar.appendChild(openBtn);

  return bar;
}

// Search functionality
let searchMatches = [];
let currentSearchIndex = -1;
let searchDebounceTimer = null;

// Workflow state
let activeWorkflow = null;

// ── Repurpose Comparison Block ──────────────────────────────────────

function renderRepurposeComparison(data) {
  var container = document.createElement('div');
  container.className = 'message assistant repurpose-comparison';

  var platformColors = { twitter: '#1da1f2', x: '#1da1f2', tiktok: '#fe2c55', instagram: '#e1306c', linkedin: '#0a66c2', youtube: '#ff0000', facebook: '#1877f2' };

  // ── Header
  var header = document.createElement('div');
  header.className = 'repurpose-comparison-header';
  header.innerHTML = '<span class="repurpose-comparison-icon">&#x1F504;</span> Repurpose Comparison' +
    '<span class="repurpose-comparison-platforms">' +
    (data.platforms || []).map(function(p) {
      return '<span class="repurpose-platform-pill" style="background:' + (platformColors[p] || 'var(--accent)') + '">' + p.toUpperCase() + '</span>';
    }).join('') + '</span>';
  container.appendChild(header);

  // ── Side-by-side layout
  var layout = document.createElement('div');
  layout.className = 'repurpose-comparison-layout';

  // LEFT: Original source
  var leftPanel = document.createElement('div');
  leftPanel.className = 'repurpose-panel repurpose-panel-source';

  var leftTitle = document.createElement('div');
  leftTitle.className = 'repurpose-panel-title';
  leftTitle.innerHTML = 'Original' + (data.source_platform ? ' <span class="repurpose-platform-pill" style="background:' + (platformColors[data.source_platform] || '#666') + '">' + data.source_platform.toUpperCase() + '</span>' : '');
  leftPanel.appendChild(leftTitle);

  // Source title
  if (data.source_title) {
    var srcTitle = document.createElement('div');
    srcTitle.className = 'repurpose-source-title';
    srcTitle.textContent = data.source_title;
    leftPanel.appendChild(srcTitle);
  }

  // Source body/caption
  if (data.source_body) {
    var srcBody = document.createElement('div');
    srcBody.className = 'repurpose-source-body';
    srcBody.textContent = data.source_body;
    leftPanel.appendChild(srcBody);
  }

  // Transcript section
  if (data.has_transcript && data.source_transcript) {
    var transcriptLabel = document.createElement('div');
    transcriptLabel.className = 'repurpose-transcript-label';
    transcriptLabel.textContent = 'Transcript';
    leftPanel.appendChild(transcriptLabel);

    var transcriptBody = document.createElement('div');
    transcriptBody.className = 'repurpose-transcript-body';
    transcriptBody.textContent = data.source_transcript;
    leftPanel.appendChild(transcriptBody);
  }

  // Stats
  if (data.source_stats) {
    var statsEl = document.createElement('div');
    statsEl.className = 'repurpose-source-stats';
    var s = data.source_stats;
    var parts = [];
    if (s.views) parts.push(formatCompactNumber(s.views) + ' views');
    if (s.likes) parts.push(formatCompactNumber(s.likes) + ' likes');
    if (s.comments) parts.push(formatCompactNumber(s.comments) + ' comments');
    if (s.shares) parts.push(formatCompactNumber(s.shares) + ' shares');
    statsEl.textContent = parts.join('  ·  ');
    leftPanel.appendChild(statsEl);
  }

  // Source media thumbnail
  if (data.source_media_urls && data.source_media_urls.length) {
    var thumb = document.createElement('div');
    thumb.className = 'repurpose-source-media';
    thumb.innerHTML = '<img src="' + escapeHtml(data.source_media_urls[0]) + '" alt="source media">';
    leftPanel.appendChild(thumb);
  }

  layout.appendChild(leftPanel);

  // RIGHT: Per-platform drafts (placeholder — agent fills these in via message content)
  var rightPanel = document.createElement('div');
  rightPanel.className = 'repurpose-panel repurpose-panel-drafts';

  var rightTitle = document.createElement('div');
  rightTitle.className = 'repurpose-panel-title';
  rightTitle.textContent = 'Repurposed Drafts';
  rightPanel.appendChild(rightTitle);

  var draftHint = document.createElement('div');
  draftHint.className = 'repurpose-drafts-hint';
  draftHint.innerHTML = 'The agent will present per-platform drafts below for your review. ' +
    'Approve to send them to the <a href="#" onclick="if(typeof navigateToSocialTab===\'function\')navigateToSocialTab(\'create\');return false;">Social Panel</a>.';
  rightPanel.appendChild(draftHint);

  // Per-platform slots that the agent's text response will fill
  (data.platforms || []).forEach(function(p) {
    var slot = document.createElement('div');
    slot.className = 'repurpose-draft-slot';
    slot.setAttribute('data-platform', p);
    slot.innerHTML =
      '<div class="repurpose-draft-slot-header">' +
        '<span class="repurpose-platform-pill" style="background:' + (platformColors[p] || '#666') + '">' + p.toUpperCase() + '</span>' +
        '<span class="repurpose-draft-status">Awaiting draft...</span>' +
      '</div>' +
      '<div class="repurpose-draft-slot-body"></div>';
    rightPanel.appendChild(slot);
  });

  layout.appendChild(rightPanel);
  container.appendChild(layout);

  // Insert into messages container
  var messagesEl = document.getElementById('messages');
  if (messagesEl) {
    messagesEl.appendChild(container);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
}

