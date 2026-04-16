function handleSchedulerMessage(data) {
  console.log(`[Chat] handleSchedulerMessage called - data.sessionId: ${data.sessionId}, currentSessionId: ${currentSessionId}`);
  // Only show message if it's for the current session
  if (data.sessionId && data.sessionId !== currentSessionId) {
    console.log(`[Chat] SKIPPING - session mismatch`);
    return;
  }
  console.log(`[Chat] DISPLAYING - session matches or no sessionId`);

  // Clear empty state if present
  const emptyState = messagesDiv.querySelector('.empty-state');
  if (emptyState) emptyState.remove();

  // Routine prompts are hidden from the UI - the user only sees the agent's response
  // The prompt is still processed by the agent and saved to the database for history

  // Add the agent's response with scheduled badge
  const msgEl = addMessage('assistant', data.response);
  if (data.jobName) {
    msgEl.classList.add('scheduled');
    msgEl.dataset.badge = data.jobName;
  }

  // Update stats and scroll
  updateStats();
  scrollToBottom();

  // Focus window
  window.focus();
}

function handleTelegramMessage(data) {
  // Only show message if it's for the current session
  // (messages are already saved to SQLite for the correct session)
  if (data.sessionId && data.sessionId !== currentSessionId) {
    console.log(`[Chat] Telegram message for session ${data.sessionId}, current is ${currentSessionId} - skipping display`);
    return;
  }

  // Clear empty state if present
  const emptyState = messagesDiv.querySelector('.empty-state');
  if (emptyState) emptyState.remove();

  // Add Telegram indicator + user message
  addTelegramMessage('user', data.userMessage, data.hasAttachment, data.attachmentType);

  // Add the agent's response (with media if present)
  addMessage('assistant', data.response, true, [], null, true, data.media);

  // Show compaction notice if conversation was compacted
  if (data.wasCompacted) {
    addMessage('system', 'your chat has been compacted', true, [], null, false);
  }

  // Update stats and scroll
  updateStats();
  scrollToBottom();
}

// Helper to get appropriate label for attachment type
function getAttachmentLabel(hasAttachment, attachmentType) {
  if (!hasAttachment) return '';
  switch (attachmentType) {
    case 'photo': return ' 📷';
    case 'voice': return ' Voice note';
    case 'audio': return ' 🎵';
    default: return ' 📎';
  }
}

function addTelegramMessage(role, content, hasAttachment = false, attachmentType = null) {
  const wrapper = document.createElement('div');
  wrapper.className = `message ${role} from-telegram`;

  // Get attachment icon based on type
  const attachmentLabel = getAttachmentLabel(hasAttachment, attachmentType);

  // Telegram badge with icon
  const badge = document.createElement('div');
  badge.className = 'telegram-badge';
  badge.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>${attachmentLabel}`;
  wrapper.appendChild(badge);

  const contentDiv = document.createElement('div');
  contentDiv.className = 'message-content';
  contentDiv.innerHTML = formatContent(content);
  // Intercept link clicks to open in external browser
  contentDiv.addEventListener('click', (e) => {
    const link = e.target.closest('a[href]');
    if (link) {
      e.preventDefault();
      const href = link.getAttribute('href');
      if (href && (href.startsWith('http://') || href.startsWith('https://'))) {
        window.neonPost.app.openExternal(href);
      }
    }
  });
  wrapper.appendChild(contentDiv);

  // Add timestamp
  const timestampDiv = document.createElement('div');
  timestampDiv.className = 'message-timestamp';
  timestampDiv.textContent = formatTimestamp(new Date());
  wrapper.appendChild(timestampDiv);

  messagesDiv.appendChild(wrapper);
  return wrapper;
}

function handleIOSMessage(data) {
  // Only show message if it's for the current session
  if (data.sessionId && data.sessionId !== currentSessionId) {
    console.log(`[Chat] iOS message for session ${data.sessionId}, current is ${currentSessionId} - skipping display`);
    return;
  }

  // Clear empty state if present
  const emptyState = messagesDiv.querySelector('.empty-state');
  if (emptyState) emptyState.remove();

  // Add iOS indicator + user message (strip workflow content for display)
  let iosDisplayMsg = data.userMessage;
  if (iosDisplayMsg && iosDisplayMsg.startsWith('[Workflow: ')) {
    const eb = iosDisplayMsg.indexOf(']');
    const em = iosDisplayMsg.indexOf('[/Workflow]');
    if (eb !== -1 && em !== -1) {
      const wfName = iosDisplayMsg.substring(11, eb);
      const userText = iosDisplayMsg.substring(em + 11).replace(/^\n\n/, '').trim();
      iosDisplayMsg = wfName + (userText ? ' ' + userText : '');
    }
  }
  addIOSMessage('user', iosDisplayMsg);

  // Add the agent's response (with media if present) — skip empty (aborted)
  if (data.response) {
    addMessage('assistant', data.response, true, [], null, true, data.media);
  }

  // Update stats and scroll
  updateStats();
  scrollToBottom();
}

function addIOSMessage(role, content) {
  const wrapper = document.createElement('div');
  wrapper.className = `message ${role} from-ios`;

  // iOS badge with phone icon
  const badge = document.createElement('div');
  badge.className = 'ios-badge';
  badge.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path stroke-width="2" d="M12 19h.01"/><path stroke-width="1.5" d="M13.5 2h-3c-2.357 0-3.536 0-4.268.732S5.5 4.643 5.5 7v10c0 2.357 0 3.535.732 4.268S8.143 22 10.5 22h3c2.357 0 3.535 0 4.268-.732c.732-.733.732-1.911.732-4.268V7c0-2.357 0-3.536-.732-4.268C17.035 2 15.857 2 13.5 2"/></g></svg> Mobile`;
  wrapper.appendChild(badge);

  const contentDiv = document.createElement('div');
  contentDiv.className = 'message-content';
  contentDiv.innerHTML = formatContent(content);
  contentDiv.addEventListener('click', (e) => {
    const link = e.target.closest('a[href]');
    if (link) {
      e.preventDefault();
      const href = link.getAttribute('href');
      if (href && (href.startsWith('http://') || href.startsWith('https://'))) {
        window.neonPost.app.openExternal(href);
      }
    }
  });
  wrapper.appendChild(contentDiv);

  const timestampDiv = document.createElement('div');
  timestampDiv.className = 'message-timestamp';
  timestampDiv.textContent = formatTimestamp(new Date());
  wrapper.appendChild(timestampDiv);

  messagesDiv.appendChild(wrapper);
  return wrapper;
}

