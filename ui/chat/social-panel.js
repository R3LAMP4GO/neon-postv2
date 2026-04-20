/* Social Panel — embedded in chat.html
 * Follows the show/hide/toggle + lazy-init pattern of routines-panel.js
 */

let _socInitialized = false;
let _socNotyf = null;
let _socEditingAccountId = null;  // null = adding, string = editing
let _socDiscoverCache = null;     // cached discover/search results for tab persistence
let _socDiscoverSearchCache = null; // cached raw search results (ContentResult[]) keyed by index
let _socSavedCache = null;          // cached saved/bookmarked content from DB
let _socTrendsCache = null;          // cached trends for Discover → Trends sub-tab
let _socTrendsLastDetect = 0;        // timestamp of last detectTrends call
// Gallery state moved to gallery-panel.js
let _socCalendarInitialized = false; // calendar lazy-init flag
let _socDiscoverTypeFilter = '';     // content type filter for Discover Search
// _socSelectedIds moved to gallery-panel.js
let _socScheduleModalDraftId = null; // draft id for schedule modal
let _socScheduleModalMode = 'schedule'; // current toggle mode: 'now' | 'schedule' | 'queue'
let _socDraftsFilterValue = '';          // persisted drafts filter value across tab switches

// ─── Copilot Bubble state ──────────────────────────────────────────────────
let _socBubbleActive = false;
let _socBubbleMessagesParent = null;  // original parent of #messages
let _socBubbleMessagesNext = null;    // original nextSibling of #messages
let _socBubbleInputParent = null;     // original parent of #input-area
let _socBubbleInputNext = null;       // original nextSibling of #input-area
let _socBubbleDragInit = false;
let _dragStartX, _dragStartY, _dragBubbleX, _dragBubbleY, _dragging = false;
let _socBubbleResizeInit = false;
let _resizing = false, _resizeDir, _resizeStartX, _resizeStartY, _resizeStartRect;
let _socBubbleSessionPickerInit = false;
let _socBubbleMinimizeInit = false;
let _socBubbleClosed = false;

// ─── Receive agent-generated content (callable from init.js onRepurposeCompleted) ──

function _socReceiveGeneratedContent(drafts) {
  _socDraftsCache = null;
  _socLoadDrafts();
  _socShowToast('Agent created ' + drafts.length + ' draft(s)', 'success');
}

// ─── Receive pushed search results (callable from init.js before panel is opened) ──

function _socReceivePushedResults(data) {
  if (!data || !data.results || !data.results.length) return;
  // Assign stable IDs so save buttons can look up items from the cache
  data.results.forEach(function (item, idx) {
    if (!item.id) item.id = item.externalId || ('search-' + idx);
  });
  _socDiscoverCache = data.results;
  _socDiscoverSearchCache = {};
  data.results.forEach(function (item) {
    _socDiscoverSearchCache[item.id] = item;
  });
  console.log('[SocialPanel] Cached ' + data.results.length + ' pushed search results');

  // If panel is already open and showing Discover, re-render
  var root = document.getElementById('social-view');
  if (root && root.classList.contains('active')) {
    var activeBtn = root.querySelector('.soc-tab-btn.active');
    if (activeBtn && activeBtn.dataset.tab === 'content-browse') {
      _socRenderDiscoverResults(data.results);
    }
  }
}

// ─── Navigation (callable from chat links) ────────────────────────────────

/**
 * Navigate directly to a specific tab (and optional sub-tab) in the Social panel.
 * Called from chat message links with neon:// protocol.
 */
function navigateToSocialTab(tab, subTab) {
  // Backward-compat mapping for renamed tabs
  var tabMap = { 'discover': 'content-browse', 'drafts': 'create' };
  var resolvedTab = tabMap[tab] || tab;

  showSocialPanel();
  var root = document.getElementById('social-view');
  if (!root) return;

  // Accounts is now a modal — open it and return
  if (resolvedTab === 'accounts') {
    _socOpenAccountsModal();
    return;
  }

  // Posts is now a calendar sub-view — switch to calendar tab + posts view
  if (resolvedTab === 'posts') {
    resolvedTab = 'calendar';
    _socCalendarView = 'posts';
    localStorage.setItem('soc-calendar-view', 'posts');
  }

  // Activate the top-level tab
  var tabBtn = root.querySelector('.soc-tab-btn[data-tab="' + resolvedTab + '"]');
  if (tabBtn) {
    root.querySelectorAll('.soc-tab-btn').forEach(function (b) { b.classList.remove('active'); });
    root.querySelectorAll('.soc-tab-content').forEach(function (c) { c.classList.remove('active'); });
    tabBtn.classList.add('active');
    var el = root.querySelector('#soc-tab-' + resolvedTab);
    if (el) el.classList.add('active');
  }

  // Activate sub-tab if specified (e.g. "search" or "saved" within Content)
  if (subTab && (tab === 'discover' || resolvedTab === 'content-browse')) {
    root.querySelectorAll('.soc-discover-sub-tab').forEach(function (b) { b.classList.remove('active'); });
    root.querySelectorAll('.soc-discover-view').forEach(function (v) { v.classList.remove('active'); });
    var subBtn = root.querySelector('.soc-discover-sub-tab[data-discover-view="' + subTab + '"]');
    if (subBtn) subBtn.classList.add('active');
    var subEl = root.querySelector('#soc-discover-view-' + subTab);
    if (subEl) subEl.classList.add('active');
  }

  // Refresh the tab data
  if (resolvedTab === 'content-browse') _socLoadDiscovered();
  if (resolvedTab === 'gallery') galPanelLoad();
  if (resolvedTab === 'calendar') showCalendarPanel();
  if (resolvedTab === 'create') _socLoadDrafts();
}

// ─── Copilot Bubble Show / Hide ────────────────────────────────────────────

function _socBubbleShow() {
  if (currentAgentMode !== 'creator') return;

  var messagesEl = document.getElementById('messages');
  var inputEl = document.getElementById('input-area');
  var body = document.getElementById('soc-bubble-body');
  var footer = document.getElementById('soc-bubble-footer');
  var bubble = document.getElementById('soc-bubble');
  if (!messagesEl || !inputEl || !body || !footer || !bubble) return;

  // Save original positions for restore
  _socBubbleMessagesParent = messagesEl.parentNode;
  _socBubbleMessagesNext = messagesEl.nextSibling;
  _socBubbleInputParent = inputEl.parentNode;
  _socBubbleInputNext = inputEl.nextSibling;

  // Reparent into bubble
  body.appendChild(messagesEl);
  footer.appendChild(inputEl);

  // Update session name in header
  var nameEl = document.getElementById('soc-bubble-session-name');
  if (nameEl) {
    var sess = sessions.find(function (s) { return s.id === currentSessionId; });
    nameEl.textContent = (sess && sess.name) || 'Session';
  }

  // Restore saved position/size from localStorage
  try {
    var pos = localStorage.getItem('soc-bubble-pos');
    if (pos) {
      var p = JSON.parse(pos);
      if (p.top != null) bubble.style.top = p.top + 'px';
      if (p.left != null) bubble.style.left = p.left + 'px';
      bubble.style.bottom = 'auto';
      bubble.style.right = 'auto';
    }
    var size = localStorage.getItem('soc-bubble-size');
    if (size) {
      var s = JSON.parse(size);
      if (s.width) bubble.style.width = s.width + 'px';
      if (s.height) bubble.style.height = s.height + 'px';
    }
  } catch (_e) { /* ignore parse errors */ }

  bubble.classList.add('active');
  _socBubbleActive = true;
  _socBubbleClosed = false;

  // Restore minimized state
  if (localStorage.getItem('soc-bubble-minimized') === 'true') {
    bubble.classList.add('soc-bubble--minimized');
    var minBtn = document.getElementById('soc-bubble-minimize');
    if (minBtn) minBtn.textContent = '\u25A2'; // ▢
  }

  _socBubbleInitDrag();
  _socBubbleInitResize();
  _socBubbleInitSessionPicker();
  _socBubbleInitMinimize();
  _socBubbleUpdateActions();
}

function _socBubbleHide() {
  if (!_socBubbleActive) return;

  var bubble = document.getElementById('soc-bubble');
  var messagesEl = document.getElementById('messages');
  var inputEl = document.getElementById('input-area');

  if (bubble) bubble.classList.remove('active');

  // Move DOM nodes back to original positions
  if (messagesEl && _socBubbleMessagesParent) {
    _socBubbleMessagesParent.insertBefore(messagesEl, _socBubbleMessagesNext);
  }
  if (inputEl && _socBubbleInputParent) {
    _socBubbleInputParent.insertBefore(inputEl, _socBubbleInputNext);
  }

  _socBubbleActive = false;
  _socBubbleMessagesParent = null;
  _socBubbleMessagesNext = null;
  _socBubbleInputParent = null;
  _socBubbleInputNext = null;
}

function _socBubbleInitDrag() {
  if (_socBubbleDragInit) return;
  var bubble = document.getElementById('soc-bubble');
  var header = document.getElementById('soc-bubble-header');
  if (!bubble || !header) return;
  _socBubbleDragInit = true;

  header.addEventListener('mousedown', function (e) {
    if (e.target.closest('.soc-bubble__btn')) return;
    _dragging = true;
    _dragStartX = e.clientX;
    _dragStartY = e.clientY;
    _dragBubbleX = bubble.offsetLeft;
    _dragBubbleY = bubble.offsetTop;
    bubble.classList.add('soc-bubble--dragging');
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });

  document.addEventListener('mousemove', function (e) {
    if (!_dragging) return;
    var deltaX = e.clientX - _dragStartX;
    var deltaY = e.clientY - _dragStartY;
    var newLeft = _dragBubbleX + deltaX;
    var newTop = _dragBubbleY + deltaY;
    var parent = bubble.parentElement;
    if (newLeft < 0) newLeft = 0;
    if (newTop < 0) newTop = 0;
    if (parent && newLeft + bubble.offsetWidth > parent.clientWidth) {
      newLeft = parent.clientWidth - bubble.offsetWidth;
    }
    if (parent && newTop + bubble.offsetHeight > parent.clientHeight) {
      newTop = parent.clientHeight - bubble.offsetHeight;
    }
    bubble.style.left = newLeft + 'px';
    bubble.style.top = newTop + 'px';
    bubble.style.bottom = 'auto';
    bubble.style.right = 'auto';
  });

  document.addEventListener('mouseup', function () {
    if (!_dragging) return;
    _dragging = false;
    bubble.classList.remove('soc-bubble--dragging');
    document.body.style.userSelect = '';
    localStorage.setItem('soc-bubble-pos', JSON.stringify({ left: bubble.offsetLeft, top: bubble.offsetTop }));
  });
}

function _socBubbleInitResize() {
  if (_socBubbleResizeInit) return;
  var bubble = document.getElementById('soc-bubble');
  if (!bubble) return;
  var handles = bubble.querySelectorAll('.soc-bubble__resize');
  if (!handles.length) return;
  _socBubbleResizeInit = true;

  handles.forEach(function (handle) {
    handle.addEventListener('mousedown', function (e) {
      _resizing = true;
      _resizeDir = handle.dataset.dir;
      _resizeStartX = e.clientX;
      _resizeStartY = e.clientY;
      _resizeStartRect = {
        left: bubble.offsetLeft,
        top: bubble.offsetTop,
        width: bubble.offsetWidth,
        height: bubble.offsetHeight
      };
      bubble.classList.add('soc-bubble--resizing');
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });
  });

  document.addEventListener('mousemove', function (e) {
    if (!_resizing) return;
    var deltaX = e.clientX - _resizeStartX;
    var deltaY = e.clientY - _resizeStartY;
    var dir = _resizeDir;
    var newLeft = _resizeStartRect.left;
    var newTop = _resizeStartRect.top;
    var newWidth = _resizeStartRect.width;
    var newHeight = _resizeStartRect.height;
    var parent = bubble.parentElement;
    var maxW = parent ? parent.clientWidth * 0.8 : 800;
    var maxH = parent ? parent.clientHeight * 0.8 : 600;

    // Width changes
    if (dir === 'e' || dir === 'ne' || dir === 'se') {
      newWidth = _resizeStartRect.width + deltaX;
    }
    if (dir === 'w' || dir === 'nw' || dir === 'sw') {
      newWidth = _resizeStartRect.width - deltaX;
      newLeft = _resizeStartRect.left + deltaX;
    }

    // Height changes
    if (dir === 's' || dir === 'se' || dir === 'sw') {
      newHeight = _resizeStartRect.height + deltaY;
    }
    if (dir === 'n' || dir === 'ne' || dir === 'nw') {
      newHeight = _resizeStartRect.height - deltaY;
      newTop = _resizeStartRect.top + deltaY;
    }

    // Clamp width
    if (newWidth < 280) {
      if (dir === 'w' || dir === 'nw' || dir === 'sw') {
        newLeft = _resizeStartRect.left + _resizeStartRect.width - 280;
      }
      newWidth = 280;
    }
    if (newWidth > maxW) {
      if (dir === 'w' || dir === 'nw' || dir === 'sw') {
        newLeft = _resizeStartRect.left + _resizeStartRect.width - maxW;
      }
      newWidth = maxW;
    }

    // Clamp height
    if (newHeight < 300) {
      if (dir === 'n' || dir === 'ne' || dir === 'nw') {
        newTop = _resizeStartRect.top + _resizeStartRect.height - 300;
      }
      newHeight = 300;
    }
    if (newHeight > maxH) {
      if (dir === 'n' || dir === 'ne' || dir === 'nw') {
        newTop = _resizeStartRect.top + _resizeStartRect.height - maxH;
      }
      newHeight = maxH;
    }

    bubble.style.width = newWidth + 'px';
    bubble.style.height = newHeight + 'px';
    if (dir === 'w' || dir === 'nw' || dir === 'sw' || dir === 'n' || dir === 'ne') {
      bubble.style.left = newLeft + 'px';
      bubble.style.right = 'auto';
    }
    if (dir === 'n' || dir === 'ne' || dir === 'nw') {
      bubble.style.top = newTop + 'px';
      bubble.style.bottom = 'auto';
    }
  });

  document.addEventListener('mouseup', function () {
    if (!_resizing) return;
    _resizing = false;
    bubble.classList.remove('soc-bubble--resizing');
    document.body.style.userSelect = '';
    localStorage.setItem('soc-bubble-size', JSON.stringify({ width: bubble.offsetWidth, height: bubble.offsetHeight }));
    localStorage.setItem('soc-bubble-pos', JSON.stringify({ left: bubble.offsetLeft, top: bubble.offsetTop }));
  });
}

// ─── Session Picker Modal ─────────────────────────────────────────────────

var _socSessionModeIcons = { general: '🐾', coder: '🔧', researcher: '🔍', writer: '✍️', therapist: '💬', creator: '🎬' };

function _socBubbleOpenSessionPicker() {
  var modal = document.getElementById('soc-bubble-session-modal');
  if (!modal) return;
  modal.style.display = 'flex';
  var searchInput = document.getElementById('soc-session-search');
  if (searchInput) searchInput.value = '';
  _socBubbleRenderSessionList();
  if (searchInput) searchInput.focus();
}

function _socBubbleCloseSessionPicker() {
  var modal = document.getElementById('soc-bubble-session-modal');
  if (modal) modal.style.display = 'none';
}

function _socBubbleRenderSessionList(filter) {
  var listEl = document.getElementById('soc-session-list');
  if (!listEl) return;

  var all = typeof sessions !== 'undefined' ? sessions : [];
  if (filter) {
    var f = filter.toLowerCase();
    all = all.filter(function (s) { return s.name && s.name.toLowerCase().indexOf(f) !== -1; });
  }

  var creatorSessions = all.filter(function (s) { return s.mode === 'creator'; })
    .sort(function (a, b) { return (b.updated_at || '').localeCompare(a.updated_at || ''); });
  var otherSessions = all.filter(function (s) { return s.mode !== 'creator'; })
    .sort(function (a, b) { return (b.updated_at || '').localeCompare(a.updated_at || ''); });

  if (!creatorSessions.length && !otherSessions.length) {
    listEl.innerHTML = '<div style="padding:12px;text-align:center;color:var(--text-muted);font-size:13px;">No sessions found</div>';
    return;
  }

  var html = '';
  if (creatorSessions.length) {
    html += '<div class="soc-session-picker__section-title">CREATOR SESSIONS</div>';
    html += _socBubbleBuildSessionRows(creatorSessions, false);
  }
  if (otherSessions.length) {
    html += '<div class="soc-session-picker__section-title">OTHER SESSIONS</div>';
    html += _socBubbleBuildSessionRows(otherSessions, true);
  }
  listEl.innerHTML = html;
}

function _socBubbleBuildSessionRows(list, dimmed) {
  var html = '';
  for (var i = 0; i < list.length; i++) {
    var s = list[i];
    var icon = _socSessionModeIcons[s.mode] || '🐾';
    var isActive = s.id === currentSessionId;
    var cls = 'soc-session-row' + (isActive ? ' active' : '') + (dimmed ? ' dimmed' : '');
    html += '<div class="' + cls + '" data-session-id="' + s.id + '">' +
      '<span class="soc-session-row__icon">' + icon + '</span>' +
      '<span class="soc-session-row__name">' + (s.name || 'Untitled') + '</span>' +
      '<span class="soc-session-row__time">' + _socTimeAgo(s.updated_at) + '</span>' +
      '</div>';
  }
  return html;
}

function _socBubbleInitSessionPicker() {
  if (_socBubbleSessionPickerInit) return;
  var modal = document.getElementById('soc-bubble-session-modal');
  if (!modal) return;
  _socBubbleSessionPickerInit = true;

  var swapBtn = document.getElementById('soc-bubble-swap');
  if (swapBtn) {
    swapBtn.addEventListener('click', function () { _socBubbleOpenSessionPicker(); });
  }

  var closeBtn = document.getElementById('soc-bubble-session-modal-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', function () { _socBubbleCloseSessionPicker(); });
  }

  modal.addEventListener('click', function (e) {
    if (e.target === modal) _socBubbleCloseSessionPicker();
  });

  var searchInput = document.getElementById('soc-session-search');
  if (searchInput) {
    searchInput.addEventListener('input', function () { _socBubbleRenderSessionList(searchInput.value); });
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && modal.style.display !== 'none' && modal.style.display !== '') {
      _socBubbleCloseSessionPicker();
    }
  });

  var listEl = document.getElementById('soc-session-list');
  if (listEl) {
    listEl.addEventListener('click', function (e) {
      var row = e.target.closest('.soc-session-row');
      if (!row) return;
      var sessionId = row.dataset.sessionId;
      if (!sessionId) return;
      _socBubbleCloseSessionPicker();
      switchSession(sessionId);
    });
  }
}

// ─── Minimize / Expand Toggle ─────────────────────────────────────────────

function _socBubbleInitMinimize() {
  if (_socBubbleMinimizeInit) return;
  var bubble = document.getElementById('soc-bubble');
  if (!bubble) return;
  _socBubbleMinimizeInit = true;

  var minBtn = document.getElementById('soc-bubble-minimize');
  if (minBtn) {
    minBtn.addEventListener('click', function () {
      var isMinimized = bubble.classList.toggle('soc-bubble--minimized');
      minBtn.textContent = isMinimized ? '\u25A2' : '\u2500'; // ▢ or ─
      localStorage.setItem('soc-bubble-minimized', isMinimized ? 'true' : 'false');
    });
  }

  var closeBtn = document.getElementById('soc-bubble-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', function () {
      _socBubbleHide();
      _socBubbleClosed = true;
    });
  }

  // Keep bubble in bounds on window resize
  window.addEventListener('resize', function () {
    if (!_socBubbleActive) return;
    var b = document.getElementById('soc-bubble');
    var parent = b ? b.parentElement : null;
    if (!b || !parent) return;
    var maxLeft = parent.clientWidth - b.offsetWidth;
    var maxTop = parent.clientHeight - b.offsetHeight;
    if (b.offsetLeft > maxLeft) b.style.left = Math.max(0, maxLeft) + 'px';
    if (b.offsetTop > maxTop) b.style.top = Math.max(0, maxTop) + 'px';
  });
}

// ─── Context-Aware Quick Actions ──────────────────────────────────────────

var _socBubbleActionMap = {
  'content-browse': ['Find trending content', 'Search ideas for my niche'],
  'create': ['Rewrite this draft', 'Add hashtags', 'Make it shorter'],
  'calendar': ['Schedule all drafts', 'Best posting times'],
};

function _socBubbleUpdateActions() {
  var actionsEl = document.getElementById('soc-bubble-actions');
  if (!actionsEl) return;

  var root = document.getElementById('social-view');
  var activeBtn = root ? root.querySelector('.soc-tab-btn.active') : null;
  var activeTab = activeBtn ? activeBtn.dataset.tab : '';
  var actions = _socBubbleActionMap[activeTab] || [];

  var html = '';
  for (var i = 0; i < actions.length; i++) {
    html += '<button class="soc-bubble__action-pill" data-action="' + actions[i] + '">' + actions[i] + '</button>';
  }
  actionsEl.innerHTML = html;

  // Attach click handlers
  actionsEl.querySelectorAll('.soc-bubble__action-pill').forEach(function (pill) {
    pill.addEventListener('click', function () {
      var actionText = pill.dataset.action;
      var input = document.getElementById('message-input');
      if (input) { input.value = actionText; input.focus(); }
      var sendBtn = document.getElementById('send-btn');
      if (sendBtn) sendBtn.click();
    });
  });
}

function _socBubbleUpdateSession() {
  var socialView = document.getElementById('social-view');
  if (!socialView || !socialView.classList.contains('active')) return;

  var sess = sessions.find(function (s) { return s.id === currentSessionId; });
  var mode = sess ? sess.mode : currentAgentMode;

  if (mode === 'creator') {
    // Update header name and ensure bubble is shown
    var nameEl = document.getElementById('soc-bubble-session-name');
    if (nameEl) nameEl.textContent = (sess && sess.name) || 'Session';
    if (!_socBubbleActive) _socBubbleShow();
  } else {
    _socBubbleHide();
  }
}

// ─── Show / Hide / Toggle ──────────────────────────────────────────────────

function showSocialPanel() {
  const chatView = document.getElementById('chat-view');
  const socialView = document.getElementById('social-view');
  if (!socialView) return;

  _dismissOtherPanels('social-view');

  chatView.classList.add('hidden');
  socialView.classList.add('active');

  const sidebarBtn = document.getElementById('sidebar-social-btn');
  if (sidebarBtn) sidebarBtn.classList.add('active');

  if (!_socInitialized) {
    _socInit();
    _socInitialized = true;
  }

  // Refresh the active tab's data on every show
  _socRefreshActiveTab();

  _socBubbleShow();
}

function hideSocialPanel() {
  const chatView = document.getElementById('chat-view');
  const socialView = document.getElementById('social-view');
  if (!socialView) return;

  _socBubbleHide();

  socialView.classList.remove('active');
  chatView.classList.remove('hidden');

  const sidebarBtn = document.getElementById('sidebar-social-btn');
  if (sidebarBtn) sidebarBtn.classList.remove('active');
}

function toggleSocialPanel() {
  const socialView = document.getElementById('social-view');
  if (socialView && socialView.classList.contains('active')) {
    hideSocialPanel();
  } else {
    showSocialPanel();
  }
}

// ─── Toast ─────────────────────────────────────────────────────────────────

function _socShowToast(message, type) {
  var validType = (type === 'error' || type === 'info') ? type : 'success';
  var icons = { success: '\u2713', error: '\u2717', info: '\u2139' };
  var duration = validType === 'error' ? 5000 : 3000;

  // Ensure container exists
  var container = document.querySelector('.soc-toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'soc-toast-container';
    document.body.appendChild(container);
  }

  var toast = document.createElement('div');
  toast.className = 'soc-toast soc-toast--' + validType;
  toast.innerHTML =
    '<span class="soc-toast__icon">' + icons[validType] + '</span>' +
    '<span class="soc-toast__msg">' + _socEscapeHtml(message) + '</span>' +
    '<button class="soc-toast__dismiss">&times;</button>' +
    '<div class="soc-toast__timer" style="width:100%"></div>';

  var timerEl = toast.querySelector('.soc-toast__timer');
  var dismissBtn = toast.querySelector('.soc-toast__dismiss');

  function removeToast() {
    if (toast._removed) return;
    toast._removed = true;
    clearTimeout(toast._timeout);
    toast.classList.add('soc-toast--exiting');
    setTimeout(function () { if (toast.parentNode) toast.remove(); }, 200);
  }

  dismissBtn.addEventListener('click', removeToast);

  container.appendChild(toast);

  // Start timer bar animation
  requestAnimationFrame(function () {
    timerEl.style.transitionDuration = duration + 'ms';
    timerEl.style.width = '0%';
  });

  toast._timeout = setTimeout(removeToast, duration);
}

function _socShowActionToast(message, type, actionLabel, actionFn) {
  var validType = (type === 'error' || type === 'info') ? type : 'success';
  var icons = { success: '\u2713', error: '\u2717', info: '\u2139' };
  var duration = validType === 'error' ? 5000 : 3000;

  var container = document.querySelector('.soc-toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'soc-toast-container';
    document.body.appendChild(container);
  }

  var toast = document.createElement('div');
  toast.className = 'soc-toast soc-toast--' + validType;
  toast.innerHTML =
    '<span class="soc-toast__icon">' + icons[validType] + '</span>' +
    '<span class="soc-toast__msg">' + _socEscapeHtml(message) + '</span>' +
    '<a class="soc-toast__action" href="#">' + _socEscapeHtml(actionLabel) + '</a>' +
    '<button class="soc-toast__dismiss">&times;</button>' +
    '<div class="soc-toast__timer" style="width:100%"></div>';

  var timerEl = toast.querySelector('.soc-toast__timer');
  var dismissBtn = toast.querySelector('.soc-toast__dismiss');
  var actionLink = toast.querySelector('.soc-toast__action');

  function removeToast() {
    if (toast._removed) return;
    toast._removed = true;
    clearTimeout(toast._timeout);
    toast.classList.add('soc-toast--exiting');
    setTimeout(function () { if (toast.parentNode) toast.remove(); }, 200);
  }

  dismissBtn.addEventListener('click', removeToast);
  actionLink.addEventListener('click', function (e) {
    e.preventDefault();
    removeToast();
    if (actionFn) actionFn();
  });

  container.appendChild(toast);

  requestAnimationFrame(function () {
    timerEl.style.transitionDuration = duration + 'ms';
    timerEl.style.width = '0%';
  });

  toast._timeout = setTimeout(removeToast, duration);
}

function _socShowScheduleSuccessToast(scheduledDate) {
  var dateLabel = scheduledDate instanceof Date ? scheduledDate.toLocaleString() : String(scheduledDate);
  var toast = document.createElement('div');
  toast.className = 'soc-schedule-toast';
  toast.innerHTML =
    '<span class="soc-success-check">\u2713</span>' +
    '<span>Scheduled for ' + _socEscapeHtml(dateLabel) + '</span>' +
    '<a href="#" class="soc-schedule-toast__link">View in Calendar</a>' +
    '<button class="soc-schedule-toast__close">&times;</button>';
  toast.querySelector('.soc-schedule-toast__link').addEventListener('click', function (e) {
    e.preventDefault();
    toast.remove();
    navigateToSocialTab('calendar');
    if (_socCalendarInitialized) _socCalendarRender();
  });
  toast.querySelector('.soc-schedule-toast__close').addEventListener('click', function () { toast.remove(); });
  document.body.appendChild(toast);
  setTimeout(function () { if (toast.parentNode) toast.remove(); }, 6000);
}

function _socRefreshAfterSchedule() {
  if (_socCalendarInitialized) _socCalendarRenderCurrentView();
}

// ─── Schedule Modal ─────────────────────────────────────────────────────────

function _socOpenScheduleModal(draftId) {
  var modal = document.getElementById('soc-schedule-modal');
  if (!modal) return;

  // Find draft to show platform label
  var draft = _socDraftsCache && _socDraftsCache.find(function (d) { return d.id === draftId; });
  var platformLabel = document.getElementById('soc-schedule-modal-platform');
  if (platformLabel && draft) {
    platformLabel.textContent = _socPlatformIcon(draft.platform) + ' ' + (draft.platform || 'Unknown').charAt(0).toUpperCase() + (draft.platform || '').slice(1) + ' draft';
  }

  // Reset toggle to Schedule
  _socScheduleModalMode = 'schedule';
  var toggleBtns = modal.querySelectorAll('.soc-schedule-toggle__option');
  toggleBtns.forEach(function (b) { b.classList.toggle('active', b.dataset.mode === 'schedule'); });

  // Show schedule details, reset pickers
  var details = document.getElementById('soc-schedule-details');
  if (details) details.style.display = '';
  var dateInput = document.getElementById('soc-schedule-date');
  var timeInput = document.getElementById('soc-schedule-time');
  if (dateInput) dateInput.value = '';
  if (timeInput) timeInput.value = '';

  // Update confirm button text
  _socUpdateScheduleConfirmBtn();

  modal.style.display = '';
}

function _socCloseScheduleModal() {
  var modal = document.getElementById('soc-schedule-modal');
  if (modal) modal.style.display = 'none';
  _socScheduleModalDraftId = null;
}

function _socUpdateScheduleConfirmBtn() {
  var btn = document.getElementById('soc-schedule-confirm');
  if (!btn) return;
  if (_socScheduleModalMode === 'now') {
    btn.textContent = 'Publish Now \u2192';
  } else if (_socScheduleModalMode === 'queue') {
    btn.textContent = 'Add to Queue \u2192';
  } else {
    btn.textContent = 'Schedule Post \u2192';
  }
}

function _socApplySchedulePreset(preset) {
  var now = new Date();
  var target = new Date(now);

  if (preset === 'tomorrow9') {
    target.setDate(target.getDate() + 1);
    target.setHours(9, 0, 0, 0);
  } else if (preset === 'tomorrow6') {
    target.setDate(target.getDate() + 1);
    target.setHours(18, 0, 0, 0);
  } else if (preset === 'nextmonday') {
    var day = target.getDay();
    var daysUntilMonday = day === 0 ? 1 : (8 - day);
    target.setDate(target.getDate() + daysUntilMonday);
    target.setHours(9, 0, 0, 0);
  }

  var dateInput = document.getElementById('soc-schedule-date');
  var timeInput = document.getElementById('soc-schedule-time');
  if (dateInput) {
    var y = target.getFullYear();
    var m = String(target.getMonth() + 1).padStart(2, '0');
    var d = String(target.getDate()).padStart(2, '0');
    dateInput.value = y + '-' + m + '-' + d;
  }
  if (timeInput) {
    var hh = String(target.getHours()).padStart(2, '0');
    var mm = String(target.getMinutes()).padStart(2, '0');
    timeInput.value = hh + ':' + mm;
  }
}

function _socScheduleModalConfirm() {
  var social = _socAPI();
  if (!social || !_socScheduleModalDraftId) return;

  var confirmBtn = document.getElementById('soc-schedule-confirm');
  var originalText = confirmBtn ? confirmBtn.textContent : '';
  if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.textContent = 'Scheduling...'; }

  function _restoreConfirmBtn() {
    if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.textContent = originalText; }
  }

  var draftId = _socScheduleModalDraftId;
  var draft = _socDraftsCache && _socDraftsCache.find(function (d) { return d.id === draftId; });
  if (!draft) { _socShowToast('Draft not found', 'error'); _restoreConfirmBtn(); return; }

  if (_socScheduleModalMode === 'now') {
    // Publish immediately
    social.updatePost(draftId, {
      content: draft.content,
      status: 'published',
    }).then(function (result) {
      if (result.success) {
        _socCloseScheduleModal();
        _socShowToast('Post published!', 'success');
        _socRefreshAfterSchedule();
        _socLoadDrafts();
      } else {
        _socShowToast(result.error || 'Publish failed', 'error');
      }
    }).catch(function () { _socShowToast('Publish error', 'error'); })
      .finally(_restoreConfirmBtn);
    return;
  }

  if (_socScheduleModalMode === 'queue') {
    // Add to queue (scheduled status, no specific time — backend handles queue)
    social.updatePost(draftId, {
      content: draft.content,
      status: 'queued',
    }).then(function (result) {
      if (result.success) {
        _socCloseScheduleModal();
        _socShowToast('Added to queue!', 'success');
        _socRefreshAfterSchedule();
        _socLoadDrafts();
      } else {
        _socShowToast(result.error || 'Queue failed', 'error');
      }
    }).catch(function () { _socShowToast('Queue error', 'error'); })
      .finally(_restoreConfirmBtn);
    return;
  }

  // Schedule mode — need date + time
  var dateInput = document.getElementById('soc-schedule-date');
  var timeInput = document.getElementById('soc-schedule-time');
  if (!dateInput || !dateInput.value || !timeInput || !timeInput.value) {
    _socShowToast('Pick a date and time', 'error');
    _restoreConfirmBtn();
    return;
  }

  var scheduleDate = new Date(dateInput.value + 'T' + timeInput.value);
  social.updatePost(draftId, {
    content: draft.content,
    status: 'scheduled',
    scheduled_at: scheduleDate.toISOString(),
  }).then(function (result) {
    if (result.success) {
      _socCloseScheduleModal();
      _socShowScheduleSuccessToast(scheduleDate);
      _socRefreshAfterSchedule();
      _socLoadDrafts();
    } else {
      _socShowToast(result.error || 'Schedule failed', 'error');
    }
  }).catch(function () { _socShowToast('Schedule error', 'error'); })
    .finally(_restoreConfirmBtn);
}

function _socInitScheduleModal() {
  var modal = document.getElementById('soc-schedule-modal');
  if (!modal) return;

  // Close button
  var closeBtn = document.getElementById('soc-schedule-modal-close');
  if (closeBtn) closeBtn.addEventListener('click', _socCloseScheduleModal);

  // Click overlay to close
  modal.addEventListener('click', function (e) {
    if (e.target === modal) _socCloseScheduleModal();
  });

  // Toggle buttons
  var toggleBtns = modal.querySelectorAll('.soc-schedule-toggle__option');
  toggleBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      _socScheduleModalMode = btn.dataset.mode;
      toggleBtns.forEach(function (b) { b.classList.toggle('active', b === btn); });
      var details = document.getElementById('soc-schedule-details');
      if (details) details.style.display = _socScheduleModalMode === 'schedule' ? '' : 'none';
      _socUpdateScheduleConfirmBtn();
    });
  });

  // Preset buttons
  var presetBtns = modal.querySelectorAll('.soc-schedule-preset-btn');
  presetBtns.forEach(function (btn) {
    btn.addEventListener('click', function () { _socApplySchedulePreset(btn.dataset.preset); });
  });

  // Confirm button
  var confirmBtn = document.getElementById('soc-schedule-confirm');
  if (confirmBtn) confirmBtn.addEventListener('click', _socScheduleModalConfirm);
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function _socEscapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function _socFormatNumber(n) {
  if (n == null) return '0';
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000)    return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

function _socTimeAgo(dateStr) {
  if (!dateStr) return '';
  const now  = Date.now();
  const d    = new Date(dateStr).getTime();
  const diff = now - d;
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return mins + 'm ago';
  const hours = Math.floor(mins / 60);
  if (hours < 24) return hours + 'h ago';
  const days = Math.floor(hours / 24);
  if (days < 30) return days + 'd ago';
  return new Date(dateStr).toLocaleDateString();
}

function _socIsImageItem(item) {
  if (!item) return false;
  // content_type 'image' with a URL-like output
  if (item.content_type === 'image' && item.output && /^https?:\/\//.test(item.output)) return true;
  return false;
}

function _socPlatformClass(platform) {
  if (!platform) return '';
  return platform.toLowerCase().replace(/\s+/g, '');
}

function _socPlatformIcon(platform) {
  const p = (platform || '').toLowerCase();
  const icons = {
    tiktok:    '♪',
    youtube:   '▶',
    instagram: '📷',
    twitter:   '𝕏',
    x:         '𝕏',
    linkedin:  'in',
    facebook:  'f',
    threads:   '@',
    pinterest: '📌',
  };
  return icons[p] || '●';
}

function _socMakePlatformBadge(platform) {
  return (
    '<span class="platform-badge ' + _socPlatformClass(platform) + '">' +
    _socPlatformIcon(platform) + ' ' + _socEscapeHtml(platform) +
    '</span>'
  );
}

function _socEngagementTier(item) {
  var total = (item.likes || 0) + (item.comments || 0) + (item.shares || 0) + (item.views || 0);

  // If viral_score is available, use it for tier + badge
  if (item.viral_score != null) {
    var score = Math.round(item.viral_score);
    var tier;
    if (score >= 80)      tier = { label: 'Viral',   cls: 'tier-viral' };
    else if (score >= 60) tier = { label: 'Hot',     cls: 'tier-hot' };
    else if (score >= 40) tier = { label: 'Trending', cls: 'tier-trend' };
    else if (score >= 20) tier = { label: 'Decent',  cls: 'tier-decent' };
    else                  tier = { label: 'Fresh',   cls: 'tier-fresh' };

    return {
      label: tier.label,
      cls: tier.cls,
      total: total,
      score: score,
      hasViralScore: true
    };
  }

  // Fallback: old sum-based tier for pre-existing data without viral_score
  if (total >= 50000) return { label: 'Viral',    cls: 'tier-viral',   total: total, score: null, hasViralScore: false };
  if (total >= 10000) return { label: 'Hot',      cls: 'tier-hot',     total: total, score: null, hasViralScore: false };
  if (total >= 1000)  return { label: 'Trending', cls: 'tier-trend',   total: total, score: null, hasViralScore: false };
  if (total >= 100)   return { label: 'Decent',   cls: 'tier-decent',  total: total, score: null, hasViralScore: false };
  return                     { label: 'Fresh',    cls: 'tier-fresh',   total: total, score: null, hasViralScore: false };
}

function _socViralScoreTooltip(item) {
  if (item.viral_score == null) return '';
  var likes = item.likes || 0;
  var comments = item.comments || 0;
  var shares = item.shares || 0;
  var views = item.views || 0;
  var total = likes + comments + shares + views;

  // Approximate breakdown for tooltip display
  var engRate = views > 0 ? (((likes + comments + shares) / views) * 100).toFixed(2) : '0.00';
  var qualScore = total > 0
    ? Math.min(100, Math.round(((comments * 3 + shares * 2 + likes) / total) * 50))
    : 0;

  return (
    '<div class="soc-viral-tooltip">' +
      '<div class="soc-viral-tooltip__title">Viral Score Breakdown</div>' +
      '<div class="soc-viral-tooltip__row"><span>Engagement Rate</span><span>' + engRate + '%</span></div>' +
      '<div class="soc-viral-tooltip__row"><span>Quality Score</span><span>' + qualScore + '</span></div>' +
      '<div class="soc-viral-tooltip__row"><span>Views</span><span>' + _socFormatNumber(views) + '</span></div>' +
      '<div class="soc-viral-tooltip__row"><span>Total Engagement</span><span>' + _socFormatNumber(total) + '</span></div>' +
    '</div>'
  );
}

function _socMakeStatusBadge(status) {
  return '<span class="status-badge ' + (status || 'draft') + '">' + _socEscapeHtml(status || 'draft') + '</span>';
}

/**
 * Render a rich content card used by both Discover (search) and Saved views.
 * @param {object} item        - Content item (DB row or search result)
 * @param {object} opts
 * @param {boolean} opts.showSave   - Show a Save button (search results)
 * @param {boolean} opts.showDelete - Show a Delete button (saved items)
 */
function _socRenderContentCard(item, opts) {
  opts = opts || {};
  var tier      = _socEngagementTier(item);
  var sourceUrl = item.source_url || item.url || '';
  var hasLink   = !!sourceUrl;
  var safeUrl   = _socEscapeHtml(sourceUrl).replace(/'/g, "\\'");
  var clickOpen = hasLink
    ? ' onclick="socPanelActions.openSavedUrl(\'' + safeUrl + '\')"'
    : '';
  var cardCls   = 'soc-content-card' + (hasLink ? ' soc-content-card--clickable' : '');

  var actionsHtml = '';
  if (opts.showSave) {
    actionsHtml +=
      '<button class="soc-btn soc-btn-sm soc-btn-secondary" onclick="event.stopPropagation(); socPanelActions.saveDiscovered(\'' + (item.id || '') + '\')">' +
        '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 7.8C5 6.12 6.34 4.8 8.02 4.8h7.96C17.66 4.8 19 6.12 19 7.8V18c0 .97-1.11 1.53-1.88.95L12 15l-5.12 3.95C6.11 19.53 5 18.97 5 18z"/></svg>' +
        ' Save' +
      '</button>';
  }
  if (opts.showCreatePost) {
    actionsHtml +=
      '<button class="soc-btn soc-btn-sm soc-btn-accent" onclick="event.stopPropagation(); socPanelActions.createFromSaved(\'' + item.id + '\')" title="Create a post from this content">' +
        '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 5v14m-7-7h14"/></svg>' +
        ' Create Post' +
      '</button>';
  }
  if (opts.showViewDrafts) {
    actionsHtml +=
      '<button class="soc-btn soc-btn-sm soc-btn-secondary" onclick="event.stopPropagation(); socPanelActions.viewDraftsForSource(\'' + item.id + '\')" title="View drafts from this content">' +
        '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><polyline fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" points="14 2 14 8 20 8"/></svg>' +
        ' View Drafts' +
      '</button>';
  }
  if (opts.showDelete) {
    actionsHtml +=
      '<button class="soc-icon-btn danger" onclick="event.stopPropagation(); socPanelActions.deleteSaved(\'' + item.id + '\')" title="Remove">' +
        '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.5" d="m19.5 5.5l-.62 10.025c-.158 2.561-.237 3.842-.88 4.763a4 4 0 0 1-1.2 1.128c-.957.584-2.24.584-4.806.584c-2.57 0-3.855 0-4.814-.585a4 4 0 0 1-1.2-1.13c-.642-.922-.72-2.205-.874-4.77L4.5 5.5M3 5.5h18m-4.944 0l-.683-1.408c-.453-.936-.68-1.403-1.071-1.695a2 2 0 0 0-.275-.172C13.594 2 13.074 2 12.035 2c-1.066 0-1.599 0-2.04.234a2 2 0 0 0-.278.18c-.395.303-.616.788-1.058 1.757L8.053 5.5"/></svg>' +
      '</button>';
  }

  // Inline create-post form (hidden by default)
  var inlineFormHtml = '';
  if (opts.showCreatePost) {
    inlineFormHtml =
      '<div class="soc-card-create-form" id="soc-card-create-' + (item.id || '') + '" style="display:none" onclick="event.stopPropagation()">' +
        '<div class="soc-card-create-form__platforms">' +
          '<label><input type="checkbox" value="tiktok"> TikTok</label>' +
          '<label><input type="checkbox" value="instagram"> Instagram</label>' +
          '<label><input type="checkbox" value="x"> X</label>' +
          '<label><input type="checkbox" value="linkedin"> LinkedIn</label>' +
          '<label><input type="checkbox" value="youtube"> YouTube</label>' +
        '</div>' +
        '<div class="soc-card-create-form__actions">' +
          '<button class="soc-btn soc-btn-sm soc-btn-secondary soc-card-create-form__video-btn" onclick="socPanelActions.pickVideoForCreate(\'' + (item.id || '') + '\')">' +
            '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>' +
            ' Choose Video' +
          '</button>' +
          '<span class="soc-card-create-form__video-name"></span>' +
          '<button class="soc-btn soc-btn-sm soc-btn-accent soc-card-create-form__generate-btn" onclick="socPanelActions.generateFromSaved(\'' + (item.id || '') + '\', this)">Generate</button>' +
        '</div>' +
      '</div>';
  }

  return (
    '<div class="' + cardCls + '" data-id="' + (item.id || '') + '"' + clickOpen + '>' +
      '<div class="soc-content-card__header">' +
        '<span class="soc-score-badge-wrap">' +
          (tier.hasViralScore
            ? '<span class="soc-score-badge ' + tier.cls + '">' + tier.score + '</span>'
            : '') +
          '<span class="soc-engagement-tier ' + tier.cls + '">' + tier.label + '</span>' +
          _socViralScoreTooltip(item) +
        '</span>' +
        '<span class="soc-engagement-total">' + _socFormatNumber(tier.total) + ' engagement</span>' +
      '</div>' +
      '<div class="soc-content-card__body">' +
        '<div class="soc-content-card__title">' + _socEscapeHtml(item.title || item.body || 'Untitled') + '</div>' +
        '<div class="soc-content-card__meta">' +
          _socMakePlatformBadge(item.platform) +
          (item.source_author || item.creatorUsername
            ? ' <span class="soc-content-card__author">by ' + _socEscapeHtml(item.source_author || item.creatorUsername || '') + '</span>'
            : '') +
        '</div>' +
        '<div class="soc-content-card__stats">' +
          '<div class="soc-stat-cell"><span class="soc-stat-value">' + _socFormatNumber(item.views)    + '</span><span class="soc-stat-label">Views</span></div>' +
          '<div class="soc-stat-cell"><span class="soc-stat-value">' + _socFormatNumber(item.likes)    + '</span><span class="soc-stat-label">Likes</span></div>' +
          '<div class="soc-stat-cell"><span class="soc-stat-value">' + _socFormatNumber(item.comments) + '</span><span class="soc-stat-label">Comments</span></div>' +
          '<div class="soc-stat-cell"><span class="soc-stat-value">' + _socFormatNumber(item.shares)   + '</span><span class="soc-stat-label">Shares</span></div>' +
        '</div>' +
      '</div>' +
      '<div class="soc-content-card__footer">' +
        '<span class="soc-content-card__time">' + _socTimeAgo(item.discovered_at || item.created_at) + '</span>' +
        (hasLink
          ? '<a class="soc-content-card__link" href="#" onclick="event.preventDefault(); event.stopPropagation(); socPanelActions.openSavedUrl(\'' + safeUrl + '\')" title="Open source">' +
              '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6m4-3h6v6m-11 5L21 3"/></svg>' +
            '</a>'
          : '') +
        actionsHtml +
      '</div>' +
      inlineFormHtml +
    '</div>'
  );
}

function _socSkeletonCards(count) {
  let html = '';
  for (let i = 0; i < count; i++) {
    html +=
      '<div class="soc-skeleton-card">' +
        '<div class="soc-skeleton soc-skeleton-thumb"></div>' +
        '<div class="soc-skeleton-body">' +
          '<div class="soc-skeleton soc-skeleton-line" style="width:80%"></div>' +
          '<div class="soc-skeleton soc-skeleton-line" style="width:55%"></div>' +
        '</div>' +
      '</div>';
  }
  return html;
}

var _socPlatformCharLimits = { x: 280, tiktok: 2200, instagram: 2200, linkedin: 3000, youtube: 5000 };

function _socToggleDraftCard(headerEl) {
  var card = headerEl.closest('.soc-draft-card');
  if (card) card.classList.toggle('collapsed');
}

function _socCopyDraft(btn) {
  var card = btn.closest('.soc-draft-card');
  var ta = card && card.querySelector('.soc-draft-card__textarea');
  if (!ta) return;
  navigator.clipboard.writeText(ta.value).then(function () {
    _socShowToast('Copied to clipboard!', 'success');
  }).catch(function() { _socShowToast('Copy failed — check permissions', 'error'); });
}

function _socScheduleDraft(btn, _platform, _sourceId) {
  var card = btn.closest('.soc-draft-card');
  var scheduleEl = card && card.querySelector('.soc-draft-card__schedule');
  if (scheduleEl) scheduleEl.style.display = 'flex';
}

function _socConfirmScheduleDraft(btn, platform, sourceId) {
  var card = btn.closest('.soc-draft-card');
  var ta = card && card.querySelector('.soc-draft-card__textarea');
  var dtInput = card && card.querySelector('.soc-draft-card__datetime');
  if (!ta || !dtInput || !dtInput.value) { _socShowToast('Pick a date/time', 'error'); return; }

  var social = _socAPI();
  if (!social) return;

  var scheduleDate = new Date(dtInput.value);
  var draftId = card && card.dataset.draftId;

  // If we have a persistent draft, update it instead of creating a new post
  var promise;
  if (draftId) {
    promise = social.updatePost(draftId, {
      content: ta.value,
      status: 'scheduled',
      scheduled_at: scheduleDate.toISOString(),
    });
  } else {
    promise = social.createPost({
      platform: platform,
      content: ta.value,
      status: 'scheduled',
      scheduled_at: scheduleDate.toISOString(),
      source_content_id: (sourceId && sourceId !== 'undefined' && sourceId !== 'null') ? sourceId : null,
    });
  }

  promise.then(function (result) {
    if (result.success) {
      _socShowScheduleSuccessToast(scheduleDate);
      _socRefreshAfterSchedule();
      var scheduleEl = card.querySelector('.soc-draft-card__schedule');
      if (scheduleEl) scheduleEl.style.display = 'none';
      // Update card to show scheduled state with checkmark animation
      var actionsEl = card.querySelector('.soc-draft-card__actions');
      if (actionsEl) {
        actionsEl.innerHTML = '<span class="soc-success-check">\u2713</span> <span class="soc-draft-card__scheduled-badge">Scheduled</span>';
      }
      ta.disabled = true;
    } else {
      _socShowToast(result.error || 'Schedule failed', 'error');
    }
  }).catch(function () {
    _socShowToast('Schedule error', 'error');
  });
}

function _socRegenerateDraft(btn, platform, sourceId) {
  var social = _socAPI();
  if (!social) return;
  var card = btn.closest('.soc-draft-card');
  var ta = card && card.querySelector('.soc-draft-card__textarea');
  if (!ta) return;

  btn.disabled = true;
  ta.value = '';
  ta.placeholder = 'Regenerating…';
  card.classList.add('soc-draft-card--generating');

  social.generateContent({
    content_type: 'repurpose',
    source_content_id: sourceId,
    target_platforms: [platform],
  }).then(function (result) {
    if (result.success && result.data) {
      var output = result.data.output || '';
      try {
        var parsed = JSON.parse(output);
        ta.value = (parsed[platform] && (parsed[platform].copy || parsed[platform].text)) || output;
      } catch (_e) {
        ta.value = output;
      }
      ta.dispatchEvent(new Event('input'));
      _socShowToast(platform.toUpperCase() + ' draft regenerated', 'success');
    } else {
      ta.value = '';
      _socShowToast('Regeneration failed — try again', 'error');
    }
  }).catch(function () {
    ta.value = '';
    _socShowToast('Regeneration failed — try again', 'error');
  }).finally(function () {
    btn.disabled = false;
    ta.placeholder = '';
    card.classList.remove('soc-draft-card--generating');
  });
}

// ─── Saved Batch Mode ────────────────────────────────────────────────────

var _socSavedSelectMode = false;
var _socSavedSelectedIds = new Set();

function _socToggleSavedSelectMode() {
  _socSavedSelectMode = !_socSavedSelectMode;
  _socSavedSelectedIds.clear();
  var root = document.getElementById('social-view');
  if (!root) return;
  var toggle = root.querySelector('#soc-saved-select-toggle');
  if (toggle) {
    toggle.textContent = _socSavedSelectMode ? 'Cancel Selection' : 'Select Multiple';
    toggle.classList.toggle('active', _socSavedSelectMode);
  }
  var toolbar = root.querySelector('#soc-saved-batch-toolbar');
  if (toolbar) toolbar.classList.toggle('active', _socSavedSelectMode);
  // Re-render saved to show/hide checkboxes
  root.querySelectorAll('#soc-saved-results .soc-content-card').forEach(function (card) {
    card.classList.toggle('soc-selectable', _socSavedSelectMode);
    card.classList.remove('soc-selected');
  });
  _socUpdateSavedBatchCount();
}

function _socToggleSavedItem(id) {
  if (_socSavedSelectedIds.has(id)) {
    _socSavedSelectedIds.delete(id);
  } else {
    _socSavedSelectedIds.add(id);
  }
  var root = document.getElementById('social-view');
  var el = root && root.querySelector('#soc-saved-results .soc-content-card[data-id="' + id + '"]');
  if (el) el.classList.toggle('soc-selected', _socSavedSelectedIds.has(id));
  _socUpdateSavedBatchCount();
}

function _socSelectAllSaved() {
  var root = document.getElementById('social-view');
  if (!root) return;
  root.querySelectorAll('#soc-saved-results .soc-content-card[data-id]').forEach(function (el) {
    var id = el.dataset.id;
    if (id) { _socSavedSelectedIds.add(id); el.classList.add('soc-selected'); }
  });
  _socUpdateSavedBatchCount();
}

function _socDeselectAllSaved() {
  _socSavedSelectedIds.clear();
  var root = document.getElementById('social-view');
  if (!root) return;
  root.querySelectorAll('#soc-saved-results .soc-content-card.soc-selected').forEach(function (el) {
    el.classList.remove('soc-selected');
  });
  _socUpdateSavedBatchCount();
}

function _socUpdateSavedBatchCount() {
  var root = document.getElementById('social-view');
  var countEl = root && root.querySelector('#soc-saved-batch-count');
  if (countEl) countEl.textContent = _socSavedSelectedIds.size + ' selected';
  var createBtn = root && root.querySelector('#soc-saved-batch-create');
  if (createBtn) createBtn.disabled = _socSavedSelectedIds.size === 0;
}

// ─── Init ──────────────────────────────────────────────────────────────────

function _socInit() {
  const root = document.getElementById('social-view');
  if (!root) return;

  // ── Tab switching ──
  root.querySelectorAll('.soc-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.tab;
      root.querySelectorAll('.soc-tab-btn').forEach(b => b.classList.remove('active'));
      root.querySelectorAll('.soc-tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      const el = root.querySelector('#soc-tab-' + target);
      if (el) el.classList.add('active');

      // Reset gallery select mode when switching away
      if (target !== 'gallery') galPanelResetSelect();

      // Lazy-load each tab's data
      if (target === 'content-browse') { _socLoadDiscovered(); _socMaybeAutoDetectTrends(); }
      if (target === 'gallery') galPanelLoad();
      if (target === 'calendar') showCalendarPanel();
      if (target === 'create') {
        var filterEl = root.querySelector('#soc-drafts-filter');
        if (filterEl) filterEl.value = _socDraftsFilterValue;
        _socLoadDrafts();
        _socLoadSources();
      }

      // Update bubble quick actions for new tab
      _socBubbleUpdateActions();
    });
  });

  // ── Accounts modal ──
  var modalOverlay = document.getElementById('soc-accounts-modal');
  var modalCloseBtn = document.getElementById('soc-accounts-modal-close');
  if (modalOverlay) {
    if (modalCloseBtn) modalCloseBtn.addEventListener('click', _socCloseAccountsModal);
    modalOverlay.addEventListener('click', function (e) {
      if (e.target === modalOverlay) _socCloseAccountsModal();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && modalOverlay.style.display !== 'none') _socCloseAccountsModal();
    });
  }

  // ── Schedule modal ──
  _socInitScheduleModal();

  // ── Create sub-tabs (inside scratch panel) ──
  root.querySelectorAll('#soc-create-scratch-panel .soc-sub-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.panel;
      root.querySelectorAll('#soc-create-scratch-panel .soc-sub-tab').forEach(b => b.classList.remove('active'));
      root.querySelectorAll('#soc-create-scratch-panel .soc-create-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      const el = root.querySelector('#soc-panel-' + target);
      if (el) el.classList.add('active');
    });
  });

  // ── Entry point buttons ──
  _socInitEntryPoints(root);

  // ── News Sources watcher section ──
  _socInitNewsSources(root);

  // ── Gallery (delegated to gallery-panel.js) ──
  galPanelInit(root);

  // ── Discover sub-tab switching (Search / Saved) ──
  root.querySelectorAll('.soc-discover-sub-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.discoverView;
      root.querySelectorAll('.soc-discover-sub-tab').forEach(b => b.classList.remove('active'));
      root.querySelectorAll('.soc-discover-view').forEach(v => v.classList.remove('active'));
      btn.classList.add('active');
      const el = root.querySelector('#soc-discover-view-' + target);
      if (el) el.classList.add('active');

      // Search cache persists until user clears it or app restarts
      if (target === 'saved') _socLoadSavedContent();
      if (target === 'trends') _socLoadTrends();
    });
  });

  // ── Trends card click-to-expand ──
  root.addEventListener('click', function (e) {
    var card = e.target.closest('.soc-trend-card');
    if (!card || e.target.closest('.soc-trend-dismiss')) return;
    var samplesEl = card.querySelector('.soc-trend-card__samples');
    if (!samplesEl) return;
    if (samplesEl.style.display === 'none' || !samplesEl.style.display) {
      var trendId = card.dataset.trendId;
      var trend = _socTrendsCache && _socTrendsCache.find(function (t) { return t.id === trendId; });
      if (trend && trend.sampleContent && trend.sampleContent.length) {
        var html = '<div class="soc-trend-samples-list">';
        trend.sampleContent.forEach(function (sample) {
          var text = sample.title || sample.content || sample.text || '';
          if (text.length > 120) text = text.substring(0, 120) + '…';
          html += '<div class="soc-trend-sample-item">' + _socEscapeHtml(text) + '</div>';
        });
        html += '</div>';
        samplesEl.innerHTML = html;
      }
      samplesEl.style.display = 'block';
    } else {
      samplesEl.style.display = 'none';
    }
  });

  // ── Saved content controls ──
  const savedPlatformFilter = root.querySelector('#soc-saved-platform-filter');
  const savedSort           = root.querySelector('#soc-saved-sort');
  if (savedPlatformFilter) savedPlatformFilter.addEventListener('change', () => { _socSavedCache = null; _socLoadSavedContent(); });
  if (savedSort)           savedSort.addEventListener('change',           () => _socRenderSavedResults());

  // ── Saved batch mode ──
  const savedSelectToggle = root.querySelector('#soc-saved-select-toggle');
  if (savedSelectToggle) savedSelectToggle.addEventListener('click', _socToggleSavedSelectMode);
  const savedBatchSelectAll = root.querySelector('#soc-saved-batch-select-all');
  if (savedBatchSelectAll) savedBatchSelectAll.addEventListener('click', _socSelectAllSaved);
  const savedBatchDeselect = root.querySelector('#soc-saved-batch-deselect');
  if (savedBatchDeselect) savedBatchDeselect.addEventListener('click', _socDeselectAllSaved);

  // ── Drafts filter ──
  var draftsFilter = root.querySelector('#soc-drafts-filter');
  if (draftsFilter) draftsFilter.addEventListener('change', function () { _socDraftsFilterValue = draftsFilter.value; _socLoadDrafts(); });

  // ── Discover search ──
  const discoverSearch    = root.querySelector('#soc-discover-search');
  const discoverPlatform  = root.querySelector('#soc-discover-platform');
  const discoverSearchBtn = root.querySelector('#soc-discover-search-btn');

  function _runSearch() {
    const query = discoverSearch ? discoverSearch.value.trim() : '';
    if (!query) {
      _socDiscoverCache = null; // clear cache to reload from DB
      _socDiscoverSearchCache = null;
      _socLoadDiscovered();
      return;
    }
    const platform = discoverPlatform ? (discoverPlatform.value || undefined) : undefined;
    _socDiscoverCache = null; // clear cache before new search
    _socDiscoverSearch(query, platform);
  }

  if (discoverSearchBtn)  discoverSearchBtn.addEventListener('click', _runSearch);
  if (discoverSearch)     discoverSearch.addEventListener('keydown', e => { if (e.key === 'Enter') _runSearch(); });

  // ── Generate (Create tab) ──
  const genBtn    = root.querySelector('#soc-create-generate-btn');
  const genOutput = root.querySelector('#soc-create-output');
  if (genBtn) {
    genBtn.addEventListener('click', () => {
      const social = _socAPI();
      if (!social) return;
      const contentType = (root.querySelector('#soc-create-content-type') || {}).value || 'caption';
      const platform    = (root.querySelector('#soc-create-platform')     || {}).value || '';
      const prompt      = ((root.querySelector('#soc-create-prompt')      || {}).value || '').trim();

      if (!prompt) { _socShowToast('Enter a prompt or topic', 'error'); return; }
      if (genOutput) {
        genOutput.textContent = 'Generating…';
        genOutput.classList.add('soc-draft-card--generating');
      }
      genBtn.disabled = true;

      social.generateContent({ content_type: contentType, platform: platform || null, prompt_used: prompt })
        .then(result => {
          if (result.success && result.data) {
            if (genOutput) genOutput.textContent = result.data.output || 'Generated content will appear here';
            _socShowToast('Content generated!', 'success');
          } else {
            if (genOutput) genOutput.textContent = result.error || 'Generation failed';
            _socShowToast('Generation failed', 'error');
          }
        })
        .catch(err => {
          console.error('[Social] Generate failed:', err);
          if (genOutput) genOutput.textContent = 'Error generating content';
          _socShowToast('Generation error', 'error');
        })
        .finally(() => {
          genBtn.disabled = false;
          if (genOutput) genOutput.classList.remove('soc-draft-card--generating');
        });
    });
  }


  // ── Image generate (Kie.ai) ──
  const imageGenBtn = root.querySelector('#soc-image-gen-btn');
  if (imageGenBtn) {
    imageGenBtn.addEventListener('click', () => {
      const social   = _socAPI();
      if (!social) return;
      const promptEl  = root.querySelector('#soc-image-prompt');
      const outputEl  = root.querySelector('#soc-image-output');
      const modelEl   = root.querySelector('#soc-image-model');
      const aspectEl  = root.querySelector('#soc-image-aspect');
      const qualityEl = root.querySelector('#soc-image-quality');

      const prompt = promptEl ? promptEl.value.trim() : '';
      if (!prompt) { _socShowToast('Describe the image you want', 'error'); return; }

      const model       = modelEl   ? modelEl.value   : 'nano-banana-2';
      const aspectRatio = aspectEl  ? aspectEl.value  : '1:1';
      const quality     = qualityEl ? qualityEl.value : '1K';

      // Show spinner
      if (outputEl) {
        outputEl.innerHTML =
          '<div class="soc-image-spinner">' +
            '<div class="soc-spinner"></div>' +
            '<div class="soc-spinner-text">Generating image…</div>' +
            '<div class="soc-spinner-hint">This may take up to 60 seconds</div>' +
          '</div>';
      }
      imageGenBtn.disabled = true;

      social.generateImage({ prompt, model, aspectRatio, quality })
        .then(result => {
          if (result.success && result.imageUrl) {
            if (outputEl) {
              outputEl.innerHTML =
                '<img class="soc-generated-image" src="' + _socEscapeHtml(result.imageUrl) + '" />' +
                '<div class="soc-image-actions">' +
                  '<span class="soc-image-model-tag">' + _socEscapeHtml(model) + ' · ' + _socEscapeHtml(aspectRatio) + '</span>' +
                '</div>';
            }
            galPanelRefresh();
            var galleryTab = root.querySelector('.soc-tab-btn[data-tab="gallery"].active');
            if (!galleryTab) {
              _socShowToast('Image ready — check Gallery tab', 'success');
            } else {
              _socShowToast('Image generated!', 'success');
            }
          } else {
            if (outputEl) {
              outputEl.innerHTML = '<div class="soc-image-placeholder">' + _socEscapeHtml(result.error || 'Generation failed') + '</div>';
            }
            _socShowToast(result.error || 'Image generation failed', 'error');
          }
        })
        .catch(err => {
          console.error('[Social] Image gen failed:', err);
          if (outputEl) {
            outputEl.innerHTML = '<div class="soc-image-placeholder">Error generating image</div>';
          }
          _socShowToast('Image error', 'error');
        })
        .finally(() => { imageGenBtn.disabled = false; });
    });
  }

  // ── Quick Post toggle ──
  const quickPostToggle = root.querySelector('#soc-quick-post-toggle');
  if (quickPostToggle) {
    quickPostToggle.addEventListener('click', () => {
      const body = root.querySelector('#soc-quick-post-body');
      const qp = root.querySelector('#soc-quick-post');
      if (body) {
        const open = body.style.display !== 'none';
        body.style.display = open ? 'none' : '';
        if (qp) qp.classList.toggle('open', !open);
      }
    });
  }

  // ── Post composer ──
  const postCreateBtn = root.querySelector('#soc-post-create-btn');
  if (postCreateBtn) {
    postCreateBtn.addEventListener('click', () => {
      const social    = _socAPI();
      if (!social) return;
      const content   = ((root.querySelector('#soc-post-content')   || {}).value || '').trim();
      const platform  = ((root.querySelector('#soc-post-platform')  || {}).value || 'tiktok');
      const status    = ((root.querySelector('#soc-post-status')    || {}).value || 'draft');
      const schedAt   = ((root.querySelector('#soc-post-schedule')  || {}).value || null);

      if (!content) { _socShowToast('Write some content first', 'error'); return; }
      postCreateBtn.disabled = true;

      social.createPost({ platform, content, status, scheduled_at: schedAt || null })
        .then(result => {
          if (result.success) {
            _socShowToast('Post created!', 'success');
            const ta = root.querySelector('#soc-post-content');
            if (ta) ta.value = '';
            _socCalendarRenderCurrentView();
          } else {
            _socShowToast(result.error || 'Failed to create post', 'error');
          }
        })
        .catch(err => {
          console.error('[Social] Create post failed:', err);
          _socShowToast('Failed to create post', 'error');
        })
        .finally(() => { postCreateBtn.disabled = false; });
    });
  }

  const postsFilter = root.querySelector('#soc-posts-filter');
  if (postsFilter) postsFilter.addEventListener('change', _socLoadPosts);

  // ── Lightbox ──
  // Lightbox event binding moved to gallery-panel.js (galPanelInit)

  // ── Save brand ──
  const saveBrandBtn = root.querySelector('#soc-save-brand-btn');
  if (saveBrandBtn) {
    saveBrandBtn.addEventListener('click', () => {
      const social = _socAPI();
      if (!social) return;
      const fields = [
        ['name',               'soc-brand-name'],
        ['voice',              'soc-brand-voice'],
        ['tone',               'soc-brand-tone'],
        ['target_audience',    'soc-brand-target-audience'],
        ['themes',             'soc-brand-themes'],
        ['hashtags',           'soc-brand-hashtags'],
        ['posting_guidelines', 'soc-brand-posting-guidelines'],
        ['visual_style',       'soc-brand-visual-style'],
        ['dos',                'soc-brand-dos'],
        ['donts',              'soc-brand-donts'],
        ['example_posts',      'soc-brand-example-posts'],
      ];
      const data = {};
      fields.forEach(([key, id]) => {
        const el = root.querySelector('#' + id);
        if (el) data[key] = el.value.trim() || null;
      });

      saveBrandBtn.disabled = true;
      social.saveBrand(data)
        .then(result => {
          if (result.success) _socShowToast('Brand saved!', 'success');
          else _socShowToast(result.error || 'Failed to save brand', 'error');
        })
        .catch(err => {
          console.error('[Social] Save brand failed:', err);
          _socShowToast('Failed to save brand', 'error');
        })
        .finally(() => { saveBrandBtn.disabled = false; });
    });
  }

  // ── Platform field toggle ──
  const platformSelect = root.querySelector('#soc-account-platform');
  if (platformSelect) {
    platformSelect.addEventListener('change', () => _socTogglePlatformFields(root, platformSelect.value));
    // Run once to set initial state
    _socTogglePlatformFields(root, platformSelect.value);
  }

  // ── Account save (add / edit) ──
  const accountSaveBtn = root.querySelector('#soc-account-save-btn');
  if (accountSaveBtn) {
    accountSaveBtn.addEventListener('click', () => {
      const social = _socAPI();
      if (!social) return;

      const platform        = (root.querySelector('#soc-account-platform')           || {}).value || 'tiktok';
      const username        = (root.querySelector('#soc-account-username')           || {}).value || '';
      const displayName     = (root.querySelector('#soc-account-display')            || {}).value || '';
      const accessToken     = (root.querySelector('#soc-account-access-token')       || {}).value || '';
      const consumerKey     = (root.querySelector('#soc-account-consumer-key')       || {}).value || '';
      const consumerSecret  = (root.querySelector('#soc-account-consumer-secret')    || {}).value || '';
      const accessTokenSecret = (root.querySelector('#soc-account-access-token-secret') || {}).value || '';
      const pageId          = (root.querySelector('#soc-account-page-id')            || {}).value || '';
      const igId            = (root.querySelector('#soc-account-ig-id')              || {}).value || '';
      const clientId        = (root.querySelector('#soc-account-client-id')          || {}).value || '';
      const clientSecret    = (root.querySelector('#soc-account-client-secret')      || {}).value || '';

      if (!username.trim()) { _socShowToast('Enter a username', 'error'); return; }

      const metadata = {};
      if (accessToken) metadata.accessToken = accessToken;
      if (platform === 'twitter') {
        if (consumerKey)        metadata.consumerKey        = consumerKey;
        if (consumerSecret)     metadata.consumerSecret     = consumerSecret;
        if (accessTokenSecret)  metadata.accessTokenSecret  = accessTokenSecret;
      }
      if (platform === 'instagram') {
        if (pageId) metadata.pageId = pageId;
        if (igId)   metadata.instagramAccountId = igId;
      }
      if (platform === 'tiktok' || platform === 'youtube') {
        if (clientId)     metadata.clientId     = clientId;
        if (clientSecret) metadata.clientSecret = clientSecret;
      }

      const payload = {
        platform,
        account_name: username.trim(),
        display_name: displayName.trim() || null,
        metadata: Object.keys(metadata).length ? JSON.stringify(metadata) : null,
      };

      accountSaveBtn.disabled = true;

      const isEditing = _socEditingAccountId !== null;
      const apiCall = isEditing
        ? social.updateAccount(_socEditingAccountId, payload)
        : social.addAccount(payload);

      apiCall
        .then(result => {
          if (result.success) {
            _socShowToast(isEditing ? 'Account updated!' : 'Account added!', 'success');
            _socResetAccountForm(root);
            _socLoadAccounts();
          } else {
            _socShowToast(result.error || (isEditing ? 'Failed to update account' : 'Failed to add account'), 'error');
          }
        })
        .catch(err => {
          console.error('[Social] Save account failed:', err);
          _socShowToast('Failed to save account', 'error');
        })
        .finally(() => { accountSaveBtn.disabled = false; });
    });
  }

  // ── Account cancel ──
  const accountCancelBtn = root.querySelector('#soc-account-cancel-btn');
  if (accountCancelBtn) {
    accountCancelBtn.addEventListener('click', () => _socResetAccountForm(root));
  }

  // ── Scraping keys ──
  const settings = window.neonPost && window.neonPost.settings;

  // Load masked values
  if (settings) {
    settings.get('apify.apiKey').then(val => {
      const el = root.querySelector('#soc-apify-key');
      if (el && val) el.placeholder = '••••••••';
    }).catch(() => {});
    settings.get('rapidapi.apiKey').then(val => {
      const el = root.querySelector('#soc-rapidapi-key');
      if (el && val) el.placeholder = '••••••••';
    }).catch(() => {});
    settings.get('kie.apiKey').then(val => {
      const el = root.querySelector('#soc-kie-key');
      if (el && val) el.placeholder = '••••••••';
    }).catch(() => {});
    settings.get('assembly.apiKey').then(val => {
      const el = root.querySelector('#soc-assembly-key');
      if (el && val) el.placeholder = '••••••••';
    }).catch(() => {});
  }

  // Apify test
  const apifyTestBtn = root.querySelector('#soc-apify-test-btn');
  if (apifyTestBtn) {
    apifyTestBtn.addEventListener('click', () => {
      const key = (root.querySelector('#soc-apify-key') || {}).value || '';
      const statusEl = root.querySelector('#soc-apify-status');
      apifyTestBtn.disabled = true;
      if (statusEl) statusEl.textContent = 'Testing…';
      const social = _socAPI();
      const testFn = social && social.validateApifyKey
        ? social.validateApifyKey(key)
        : Promise.reject(new Error('validateApifyKey not available'));
      testFn
        .then(result => {
          if (statusEl) { statusEl.textContent = result.valid ? '✓ Valid' : '✗ Invalid'; statusEl.className = 'soc-key-status ' + (result.valid ? 'valid' : 'invalid'); }
          if (result.valid) {
            if (key && settings) {
              settings.set('apify.apiKey', key).then(() => {
                _socShowToast('Apify key valid & saved!', 'success');
                const el = root.querySelector('#soc-apify-key');
                if (el) { el.value = ''; el.placeholder = '••••••••'; }
              }).catch(() => _socShowToast('Key valid but failed to save', 'error'));
            } else {
              _socShowToast('Apify key is valid!', 'success');
            }
          } else {
            _socShowToast('Apify key invalid', 'error');
          }
        })
        .catch(() => {
          if (statusEl) { statusEl.textContent = '✗ Error'; statusEl.className = 'soc-key-status invalid'; }
          _socShowToast('Test failed', 'error');
        })
        .finally(() => { apifyTestBtn.disabled = false; });
    });
  }

  // Apify save
  const apifySaveBtn = root.querySelector('#soc-apify-save-btn');
  if (apifySaveBtn) {
    apifySaveBtn.addEventListener('click', () => {
      const key = (root.querySelector('#soc-apify-key') || {}).value || '';
      if (!key) { _socShowToast('Enter a key to save', 'error'); return; }
      if (!settings) { _socShowToast('Settings unavailable', 'error'); return; }
      apifySaveBtn.disabled = true;
      settings.set('apify.apiKey', key)
        .then(() => {
          _socShowToast('Apify key saved!', 'success');
          const el = root.querySelector('#soc-apify-key');
          if (el) { el.value = ''; el.placeholder = '••••••••'; }
        })
        .catch(() => _socShowToast('Failed to save key', 'error'))
        .finally(() => { apifySaveBtn.disabled = false; });
    });
  }

  // RapidAPI test
  const rapidTestBtn = root.querySelector('#soc-rapidapi-test-btn');
  if (rapidTestBtn) {
    rapidTestBtn.addEventListener('click', () => {
      const key = (root.querySelector('#soc-rapidapi-key') || {}).value || '';
      const statusEl = root.querySelector('#soc-rapidapi-status');
      rapidTestBtn.disabled = true;
      if (statusEl) statusEl.textContent = 'Testing…';
      const social = _socAPI();
      const testFn = social && social.validateRapidAPIKey
        ? social.validateRapidAPIKey(key)
        : Promise.reject(new Error('validateRapidAPIKey not available'));
      testFn
        .then(result => {
          if (statusEl) { statusEl.textContent = result.valid ? '✓ Valid' : '✗ Invalid'; statusEl.className = 'soc-key-status ' + (result.valid ? 'valid' : 'invalid'); }
          if (result.valid) {
            if (key && settings) {
              settings.set('rapidapi.apiKey', key).then(() => {
                _socShowToast('RapidAPI key valid & saved!', 'success');
                const el = root.querySelector('#soc-rapidapi-key');
                if (el) { el.value = ''; el.placeholder = '••••••••'; }
              }).catch(() => _socShowToast('Key valid but failed to save', 'error'));
            } else {
              _socShowToast('RapidAPI key is valid!', 'success');
            }
          } else {
            _socShowToast('RapidAPI key invalid', 'error');
          }
        })
        .catch(() => {
          if (statusEl) { statusEl.textContent = '✗ Error'; statusEl.className = 'soc-key-status invalid'; }
          _socShowToast('Test failed', 'error');
        })
        .finally(() => { rapidTestBtn.disabled = false; });
    });
  }

  // RapidAPI save
  const rapidSaveBtn = root.querySelector('#soc-rapidapi-save-btn');
  if (rapidSaveBtn) {
    rapidSaveBtn.addEventListener('click', () => {
      const key = (root.querySelector('#soc-rapidapi-key') || {}).value || '';
      if (!key) { _socShowToast('Enter a key to save', 'error'); return; }
      if (!settings) { _socShowToast('Settings unavailable', 'error'); return; }
      rapidSaveBtn.disabled = true;
      settings.set('rapidapi.apiKey', key)
        .then(() => {
          _socShowToast('RapidAPI key saved!', 'success');
          const el = root.querySelector('#soc-rapidapi-key');
          if (el) { el.value = ''; el.placeholder = '••••••••'; }
        })
        .catch(() => _socShowToast('Failed to save key', 'error'))
        .finally(() => { rapidSaveBtn.disabled = false; });
    });
  }

  // Kie.ai test
  const kieTestBtn = root.querySelector('#soc-kie-test-btn');
  if (kieTestBtn) {
    kieTestBtn.addEventListener('click', () => {
      const key = (root.querySelector('#soc-kie-key') || {}).value || '';
      const statusEl = root.querySelector('#soc-kie-status');
      kieTestBtn.disabled = true;
      if (statusEl) statusEl.textContent = 'Testing…';
      const social = _socAPI();
      const testFn = social && social.validateKieKey
        ? social.validateKieKey(key)
        : Promise.reject(new Error('validateKieKey not available'));
      testFn
        .then(result => {
          if (statusEl) { statusEl.textContent = result.valid ? '✓ Valid' : '✗ Invalid'; statusEl.className = 'soc-key-status ' + (result.valid ? 'valid' : 'invalid'); }
          if (result.valid) {
            if (key && settings) {
              settings.set('kie.apiKey', key).then(() => {
                _socShowToast('Kie.ai key valid & saved!', 'success');
                const el = root.querySelector('#soc-kie-key');
                if (el) { el.value = ''; el.placeholder = '••••••••'; }
              }).catch(() => _socShowToast('Key valid but failed to save', 'error'));
            } else {
              _socShowToast('Kie.ai key is valid!', 'success');
            }
          } else {
            _socShowToast('Kie.ai key invalid', 'error');
          }
        })
        .catch(() => {
          if (statusEl) { statusEl.textContent = '✗ Error'; statusEl.className = 'soc-key-status invalid'; }
          _socShowToast('Test failed', 'error');
        })
        .finally(() => { kieTestBtn.disabled = false; });
    });
  }

  // Kie.ai save
  const kieSaveBtn = root.querySelector('#soc-kie-save-btn');
  if (kieSaveBtn) {
    kieSaveBtn.addEventListener('click', () => {
      const key = (root.querySelector('#soc-kie-key') || {}).value || '';
      if (!key) { _socShowToast('Enter a key to save', 'error'); return; }
      if (!settings) { _socShowToast('Settings unavailable', 'error'); return; }
      kieSaveBtn.disabled = true;
      settings.set('kie.apiKey', key)
        .then(() => {
          _socShowToast('Kie.ai key saved!', 'success');
          const el = root.querySelector('#soc-kie-key');
          if (el) { el.value = ''; el.placeholder = '••••••••'; }
        })
        .catch(() => _socShowToast('Failed to save key', 'error'))
        .finally(() => { kieSaveBtn.disabled = false; });
    });
  }

  // AssemblyAI test
  const assemblyTestBtn = root.querySelector('#soc-assembly-test-btn');
  if (assemblyTestBtn) {
    assemblyTestBtn.addEventListener('click', () => {
      const key = (root.querySelector('#soc-assembly-key') || {}).value || '';
      const statusEl = root.querySelector('#soc-assembly-status');
      assemblyTestBtn.disabled = true;
      if (statusEl) statusEl.textContent = 'Testing…';
      const social = _socAPI();
      const testFn = social && social.validateAssemblyKey
        ? social.validateAssemblyKey(key)
        : Promise.reject(new Error('validateAssemblyKey not available'));
      testFn
        .then(result => {
          if (statusEl) { statusEl.textContent = result.valid ? '✓ Valid' : '✗ Invalid'; statusEl.className = 'soc-key-status ' + (result.valid ? 'valid' : 'invalid'); }
          if (result.valid) {
            if (key && settings) {
              settings.set('assembly.apiKey', key).then(() => {
                _socShowToast(result.warning ? 'Key saved! ' + result.warning : 'AssemblyAI key valid & saved!', result.warning ? 'warning' : 'success');
                const el = root.querySelector('#soc-assembly-key');
                if (el) { el.value = ''; el.placeholder = '••••••••'; }
                if (result.warning && statusEl) statusEl.textContent = '✓ Valid (CLI not installed)';
              }).catch(() => _socShowToast('Key valid but failed to save', 'error'));
            } else {
              _socShowToast('AssemblyAI key is valid!', 'success');
            }
          } else {
            _socShowToast('AssemblyAI key invalid: ' + (result.error || ''), 'error');
          }
        })
        .catch(() => {
          if (statusEl) { statusEl.textContent = '✗ Error'; statusEl.className = 'soc-key-status invalid'; }
          _socShowToast('Test failed', 'error');
        })
        .finally(() => { assemblyTestBtn.disabled = false; });
    });
  }

  // AssemblyAI save
  const assemblySaveBtn = root.querySelector('#soc-assembly-save-btn');
  if (assemblySaveBtn) {
    assemblySaveBtn.addEventListener('click', () => {
      const key = (root.querySelector('#soc-assembly-key') || {}).value || '';
      if (!key) { _socShowToast('Enter a key to save', 'error'); return; }
      if (!settings) { _socShowToast('Settings unavailable', 'error'); return; }
      assemblySaveBtn.disabled = true;
      settings.set('assembly.apiKey', key)
        .then(() => {
          _socShowToast('AssemblyAI key saved!', 'success');
          const el = root.querySelector('#soc-assembly-key');
          if (el) { el.value = ''; el.placeholder = '••••••••'; }
        })
        .catch(() => _socShowToast('Failed to save key', 'error'))
        .finally(() => { assemblySaveBtn.disabled = false; });
    });
  }

  // ── Content type filter ──
  const discoverTypeFilter = root.querySelector('#soc-discover-type-filter');
  if (discoverTypeFilter) {
    discoverTypeFilter.addEventListener('change', () => {
      _socDiscoverTypeFilter = discoverTypeFilter.value;
      if (_socDiscoverCache) {
        _socRenderDiscoverResults(_socDiscoverCache);
      }
    });
  }

  // ── Platform filter (also filters displayed results, not just search) ──
  const discoverPlatformFilter = root.querySelector('#soc-discover-platform');
  if (discoverPlatformFilter) {
    discoverPlatformFilter.addEventListener('change', () => {
      if (_socDiscoverCache) {
        _socRenderDiscoverResults(_socDiscoverCache);
      }
    });
  }

  // ── Clear search results button ──
  const discoverClearBtn = root.querySelector('#soc-discover-clear-btn');
  if (discoverClearBtn) {
    discoverClearBtn.addEventListener('click', () => {
      _socDiscoverCache = null;
      _socDiscoverSearchCache = null;
      _socDiscoverTypeFilter = '';
      const searchInput = root.querySelector('#soc-discover-search');
      if (searchInput) searchInput.value = '';
      const typeFilter = root.querySelector('#soc-discover-type-filter');
      if (typeFilter) typeFilter.value = '';
      _socLoadDiscovered();
      _socShowToast('Search results cleared', 'success');
    });
  }

  // Initial data load for the first visible tab
  _socLoadDiscovered();

}

// ─── Platform field toggle ─────────────────────────────────────────────────

function _socTogglePlatformFields(root, platform) {
  const twitterGroup   = root.querySelector('.soc-cred-twitter');
  const instagramGroup = root.querySelector('.soc-cred-instagram');
  const clientGroup    = root.querySelector('.soc-cred-client');

  if (twitterGroup)   twitterGroup.style.display   = 'none';
  if (instagramGroup) instagramGroup.style.display  = 'none';
  if (clientGroup)    clientGroup.style.display     = 'none';

  if (platform === 'twitter') {
    if (twitterGroup) twitterGroup.style.display = '';
  } else if (platform === 'instagram') {
    if (instagramGroup) instagramGroup.style.display = '';
  } else if (platform === 'tiktok' || platform === 'youtube') {
    if (clientGroup) clientGroup.style.display = '';
  }
  // linkedin: just access token, no extras
}

// ─── Reset account form ────────────────────────────────────────────────────

function _socResetAccountForm(root) {
  _socEditingAccountId = null;

  const titleEl     = root.querySelector('#soc-account-form-title');
  const saveBtn     = root.querySelector('#soc-account-save-btn');
  const cancelBtn   = root.querySelector('#soc-account-cancel-btn');

  if (titleEl)  titleEl.textContent  = 'Add Account';
  if (saveBtn)  saveBtn.textContent  = 'Add Account';
  if (cancelBtn) cancelBtn.style.display = 'none';

  const fields = ['#soc-account-username', '#soc-account-display', '#soc-account-access-token',
    '#soc-account-consumer-key', '#soc-account-consumer-secret', '#soc-account-access-token-secret',
    '#soc-account-page-id', '#soc-account-ig-id', '#soc-account-client-id', '#soc-account-client-secret'];
  fields.forEach(sel => {
    const el = root.querySelector(sel);
    if (el) el.value = '';
  });

  const platformSel = root.querySelector('#soc-account-platform');
  if (platformSel) {
    platformSel.value = 'tiktok';
    _socTogglePlatformFields(root, 'tiktok');
  }
}

// ─── API reference ─────────────────────────────────────────────────────────

function _socAPI() {
  return (window.neonPost && window.neonPost.social) || null;
}

// ─── Refresh active tab ────────────────────────────────────────────────────

function _socRefreshActiveTab() {
  const root = document.getElementById('social-view');
  if (!root) return;
  const activeBtn = root.querySelector('.soc-tab-btn.active');
  if (!activeBtn) return;
  const tab = activeBtn.dataset.tab;
  if (tab === 'content-browse') _socLoadDiscovered();
  if (tab === 'calendar') _socCalendarRenderCurrentView();
  if (tab === 'create')   _socLoadDrafts();
}

// ─── Targeted refresh functions (called from init.js event listeners) ───────

// eslint-disable-next-line no-unused-vars
function _socRefreshCalendar() {
  if (_socCalendarInitialized) _socCalendarRenderCurrentView();
}

// eslint-disable-next-line no-unused-vars
function _socRefreshPosts() {
  _socLoadPosts();
}

// eslint-disable-next-line no-unused-vars
function _socRefreshDiscoverSaved() {
  _socSavedCache = null;
  var root = document.getElementById('social-view');
  var savedBtn = root && root.querySelector('.soc-discover-sub-tab[data-discover-view="saved"].active');
  if (savedBtn) _socLoadSavedContent();
}

// ─── Discover Tab ──────────────────────────────────────────────────────────

function _socLoadDiscovered() {
  const root    = document.getElementById('social-view');
  const results = root && root.querySelector('#soc-discover-results');
  if (!results) return;

  // If we have cached results, re-render from cache without hitting API
  if (_socDiscoverCache) {
    _socRenderDiscoverResults(_socDiscoverCache);
    return;
  }

  const social = _socAPI();
  results.innerHTML = '<div class="soc-card-grid">' + _socSkeletonCards(6) + '</div>';

  if (!social) { results.innerHTML = '<div class="soc-empty"><p>Social API unavailable</p></div>'; return; }

  social.getDiscovered(50)
    .then(items => {
      _socDiscoverCache = items;
      _socDiscoverSearchCache = null; // DB items, no raw search data
      _socRenderDiscoverResults(items);
    })
    .catch(err => {
      console.error('[Social] Failed to load discovered:', err);
      results.innerHTML = '<div class="soc-empty"><p>Failed to load content</p></div>';
    });
}

function _socDiscoverSearch(query, platform) {
  const social  = _socAPI();
  const root    = document.getElementById('social-view');
  const results = root && root.querySelector('#soc-discover-results');
  if (!results || !social) return;

  var searchBtn = root && root.querySelector('#soc-discover-search-btn');
  if (searchBtn) searchBtn.disabled = true;

  results.innerHTML = '<div class="soc-card-grid">' + _socSkeletonCards(6) + '</div>';

  social.searchContent(query, platform)
    .then(items => {
      // Assign stable IDs so save buttons can look up items from the cache
      if (items && items.length) {
        items.forEach((item, idx) => {
          if (!item.id) item.id = item.externalId || ('search-' + idx);
        });
      }
      // Cache search results so they persist across tab switches
      _socDiscoverCache = items;
      // Store raw search items for the Save button mapping
      _socDiscoverSearchCache = {};
      if (items && items.length) {
        items.forEach((item) => {
          _socDiscoverSearchCache[item.id] = item;
        });
      }
      _socRenderDiscoverResults(items);
    })
    .catch(err => {
      console.error('[Social] Search failed:', err);
      _socShowToast('Search failed', 'error');
    })
    .finally(function () {
      if (searchBtn) searchBtn.disabled = false;
    });
}

function _socNormalizeContentType(raw) {
  if (!raw) return 'other';
  var t = raw.toLowerCase().trim();
  if (t === 'video' || t === 'reel' || t === 'short' || t === 'shorts') return 'video';
  if (t === 'image' || t === 'photo' || t === 'picture') return 'image';
  if (t === 'carousel' || t === 'sidecar' || t === 'slideshow' || t === 'album') return 'carousel';
  if (t === 'text' || t === 'tweet' || t === 'post' || t === 'article') return 'text';
  return 'other';
}

var _socPlatformLabels = {
  tiktok: 'TikTok', youtube: 'YouTube', instagram: 'Instagram',
  twitter: 'Twitter/X', linkedin: 'LinkedIn'
};

function _socComputeDistribution(items) {
  var counts = {};
  var total = 0;
  (items || []).forEach(function (item) {
    var ct = _socNormalizeContentType(item.content_type);
    counts[ct] = (counts[ct] || 0) + 1;
    total++;
  });
  if (total === 0) return [];
  var dist = [];
  ['video', 'image', 'carousel', 'text', 'other'].forEach(function (key) {
    if (counts[key]) {
      dist.push({ type: key, count: counts[key], pct: Math.round((counts[key] / total) * 100) });
    }
  });
  return dist;
}

function _socRenderDistribution(items) {
  var root = document.getElementById('social-view');
  var bar = root && root.querySelector('#soc-discover-distribution');
  if (!bar) return;
  var dist = _socComputeDistribution(items);
  if (!dist.length) {
    bar.classList.remove('active');
    bar.innerHTML = '';
    return;
  }
  var html = '';
  dist.forEach(function (d) {
    var label = d.type.charAt(0).toUpperCase() + d.type.slice(1);
    html += '<span class="soc-distribution-pill soc-distribution-pill--' + d.type + '">' +
      label + ' ' + d.pct + '%</span>';
  });
  bar.innerHTML = html;
  bar.classList.add('active');
}

function _socFilterDiscoverByType(items) {
  if (!_socDiscoverTypeFilter) return items;
  return (items || []).filter(function (item) {
    return _socNormalizeContentType(item.content_type) === _socDiscoverTypeFilter;
  });
}

function _socFilterDiscoverByPlatform(items) {
  var root = document.getElementById('social-view');
  var platformEl = root && root.querySelector('#soc-discover-platform');
  var plat = platformEl ? platformEl.value : '';
  if (!plat) return items;
  return (items || []).filter(function (item) {
    return (item.platform || '').toLowerCase() === plat.toLowerCase();
  });
}

var _socDiscoverPageSize = 12;
var _socDiscoverShown = 12;

function _socRenderDiscoverResults(items) {
  const root    = document.getElementById('social-view');
  const results = root && root.querySelector('#soc-discover-results');
  if (!results) return;

  // Reset page count on new results
  _socDiscoverShown = _socDiscoverPageSize;

  // Compute and render distribution from full (unfiltered) set
  _socRenderDistribution(items);

  // Apply platform + content type filters
  var filtered = _socFilterDiscoverByPlatform(_socFilterDiscoverByType(items));

  if (!items || items.length === 0) {
    results.innerHTML =
      '<div class="soc-empty">' +
      '<p>No content discovered yet</p>' +
      '<p class="hint">Search for content or let your agent discover trending posts</p>' +
      '</div>';
    return;
  }

  // Determine if these are search results (have save button) or DB items
  const isSearch = !!_socDiscoverSearchCache;

  // Show hint if filter reduced count
  var hintHtml = '';
  if (_socDiscoverTypeFilter && filtered.length < items.length) {
    var typeName = _socDiscoverTypeFilter.charAt(0).toUpperCase() + _socDiscoverTypeFilter.slice(1);
    var platformEl = root.querySelector('#soc-discover-platform');
    var platformKey = platformEl ? platformEl.value : '';
    var platformName = _socPlatformLabels[platformKey] || 'this platform';
    hintHtml = '<div class="soc-discover-filter-hint">Showing ' + filtered.length + '/' + items.length +
      ' \u2014 ' + typeName + ' posts are rare on ' + platformName + '</div>';
  }

  if (filtered.length === 0) {
    var typeName2 = _socDiscoverTypeFilter.charAt(0).toUpperCase() + _socDiscoverTypeFilter.slice(1);
    results.innerHTML = hintHtml +
      '<div class="soc-empty"><p>No ' + typeName2 + ' content in these results</p></div>';
    return;
  }

  _socRenderDiscoverPage(results, filtered, isSearch, hintHtml);
}

function _socRenderDiscoverPage(results, filtered, isSearch, hintHtml) {
  var visible = filtered.slice(0, _socDiscoverShown);
  var remaining = filtered.length - visible.length;

  var html = hintHtml + '<div class="soc-card-grid">';
  visible.forEach(function (item) {
    html += _socRenderContentCard(item, { showSave: isSearch });
  });
  html += '</div>';

  if (remaining > 0) {
    html += '<div style="text-align:center;padding:var(--sp-16,16px) 0">' +
      '<button class="soc-btn soc-btn-secondary" id="soc-discover-load-more">' +
      'Show more (' + remaining + ' remaining)</button></div>';
  }

  results.innerHTML = html;

  // Wire up load-more button
  var loadMoreBtn = results.querySelector('#soc-discover-load-more');
  if (loadMoreBtn) {
    loadMoreBtn.addEventListener('click', function () {
      _socDiscoverShown += _socDiscoverPageSize;
      _socRenderDiscoverPage(results, filtered, isSearch, hintHtml);
    });
  }
}

// ─── Saved Content (Discover → Saved sub-tab) ─────────────────────────────

function _socLoadSavedContent() {
  const root    = document.getElementById('social-view');
  const results = root && root.querySelector('#soc-saved-results');
  if (!results) return;

  // Re-render from cache if available
  if (_socSavedCache) {
    _socRenderSavedResults();
    return;
  }

  const social = _socAPI();
  results.innerHTML = '<div class="soc-card-grid">' + _socSkeletonCards(6) + '</div>';

  if (!social) { results.innerHTML = '<div class="soc-empty"><p>Social API unavailable</p></div>'; return; }

  social.getDiscovered(200)
    .then(items => {
      // Apply platform filter
      const root2      = document.getElementById('social-view');
      const filterEl   = root2 && root2.querySelector('#soc-saved-platform-filter');
      const filterPlat = filterEl ? filterEl.value : '';
      if (filterPlat) {
        _socSavedCache = (items || []).filter(i => (i.platform || '').toLowerCase() === filterPlat);
      } else {
        _socSavedCache = items || [];
      }
      _socRenderSavedResults();
    })
    .catch(err => {
      console.error('[Social] Failed to load saved content:', err);
      results.innerHTML = '<div class="soc-empty"><p>Failed to load saved content</p></div>';
    });
}

function _socRenderSavedResults() {
  const root    = document.getElementById('social-view');
  const results = root && root.querySelector('#soc-saved-results');
  if (!results || !_socSavedCache) return;

  // Sort
  const sortEl   = root.querySelector('#soc-saved-sort');
  const sortMode = sortEl ? sortEl.value : 'recency';

  const sorted = [..._socSavedCache];
  if (sortMode === 'engagement') {
    sorted.sort((a, b) => {
      const engA = (a.likes || 0) + (a.comments || 0) + (a.shares || 0) + (a.views || 0);
      const engB = (b.likes || 0) + (b.comments || 0) + (b.shares || 0) + (b.views || 0);
      return engB - engA;
    });
  } else {
    sorted.sort((a, b) => {
      const da = new Date(a.discovered_at || a.created_at || 0).getTime();
      const db = new Date(b.discovered_at || b.created_at || 0).getTime();
      return db - da;
    });
  }

  if (sorted.length === 0) {
    results.innerHTML =
      '<div class="soc-empty">' +
      '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M5 7.8C5 6.12 6.34 4.8 8.02 4.8h7.96C17.66 4.8 19 6.12 19 7.8V18c0 .97-1.11 1.53-1.88.95L12 15l-5.12 3.95C6.11 19.53 5 18.97 5 18z"/></svg>' +
      '<p>No saved content yet</p>' +
      '<p class="hint">Save content from the Search tab to build your library</p>' +
      '</div>';
    return;
  }

  // Load drafts to check which saved items have existing drafts
  var social = _socAPI();
  var draftSourceIds = new Set();
  var _socSavedShown = _socDiscoverPageSize;
  var renderCards = function () {
    var visible = sorted.slice(0, _socSavedShown);
    var remaining = sorted.length - visible.length;
    var html2 = '<div class="soc-card-grid">';
    visible.forEach(function (item) {
      html2 += _socRenderContentCard(item, {
        showDelete: true,
        showCreatePost: true,
        showViewDrafts: draftSourceIds.has(item.id),
      });
    });
    html2 += '</div>';
    if (remaining > 0) {
      html2 += '<div style="text-align:center;padding:16px 0">' +
        '<button class="soc-btn soc-btn-secondary" id="soc-saved-load-more">' +
        'Show more (' + remaining + ' remaining)</button></div>';
    }
    results.innerHTML = html2;

    var loadMoreBtn = results.querySelector('#soc-saved-load-more');
    if (loadMoreBtn) {
      loadMoreBtn.addEventListener('click', function () {
        _socSavedShown += _socDiscoverPageSize;
        renderCards();
      });
    }

    // Apply select mode state if active
    if (_socSavedSelectMode) {
      results.querySelectorAll('.soc-content-card').forEach(function (card) {
        card.classList.add('soc-selectable');
        if (_socSavedSelectedIds.has(card.dataset.id)) card.classList.add('soc-selected');
      });
    }

    // Attach click handler for select mode
    results.addEventListener('click', function (e) {
      if (!_socSavedSelectMode) return;
      var card = e.target.closest('.soc-content-card[data-id]');
      if (!card) return;
      if (e.target.closest('button') || e.target.closest('a') || e.target.closest('.soc-card-create-form')) return;
      e.preventDefault();
      e.stopPropagation();
      _socToggleSavedItem(card.dataset.id);
    }, true);
  };

  if (social) {
    social.getDrafts().then(function (drafts) {
      (drafts || []).forEach(function (d) {
        if (d.source_content_id) draftSourceIds.add(d.source_content_id);
      });
      renderCards();
    }).catch(function () { renderCards(); });
  } else {
    renderCards();
  }
}


// ─── Trends (Discover → Trends sub-tab) ───────────────────────────────────

function _socMaybeAutoDetectTrends() {
  if (Date.now() - _socTrendsLastDetect > 5 * 60 * 1000) {
    const social = _socAPI();
    if (social) {
      _socTrendsLastDetect = Date.now();
      social.detectTrends().catch(function (err) {
        console.error('[Social] Auto-detect trends failed:', err);
        _socShowToast('Trend detection unavailable', 'error');
      });
    }
  }
}

function _socLoadTrends() {
  const social  = _socAPI();
  const root    = document.getElementById('social-view');
  const results = root && root.querySelector('#soc-trends-results');
  if (!results) return;

  if (_socTrendsCache) {
    _socRenderTrends(_socTrendsCache);
    return;
  }

  results.innerHTML = '<div class="soc-card-grid">' + _socSkeletonCards(4) + '</div>';
  if (!social) { results.innerHTML = '<div class="soc-empty"><p>Social API unavailable</p></div>'; return; }

  // Run detection first, then fetch
  var detect = (Date.now() - _socTrendsLastDetect > 5 * 60 * 1000)
    ? (function () { _socTrendsLastDetect = Date.now(); return social.detectTrends(); })()
    : Promise.resolve();

  detect
    .then(function () { return social.getTrends(); })
    .then(function (trends) {
      _socTrendsCache = trends;
      _socRenderTrends(trends);
    })
    .catch(function (err) {
      console.error('[Social] Failed to load trends:', err);
      results.innerHTML = '<div class="soc-empty"><p>Failed to load trends</p></div>';
    });
}

function _socRenderTrends(trends) {
  var root    = document.getElementById('social-view');
  var results = root && root.querySelector('#soc-trends-results');
  if (!results) return;

  if (!trends || trends.length === 0) {
    results.innerHTML =
      '<div class="soc-empty">' +
      '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M2 20h20M5 20V10m4 10V4m4 16v-8m4 8V8"/></svg>' +
      '<p>No trends detected yet</p>' +
      '<p class="hint">Save some content in the Discover tab and trends will appear here</p>' +
      '</div>';
    return;
  }

  var html = '<div class="soc-trends-list">';
  trends.forEach(function (trend) {
    html += _socRenderTrendCard(trend);
  });
  html += '</div>';
  results.innerHTML = html;
}

function _socRenderTrendCard(trend) {
  var statusClass = 'soc-trend-status--' + (trend.status || 'emerging').toLowerCase();
  var statusLabel = trend.status || 'Emerging';
  var score = trend.score != null ? trend.score : 0;
  var platform = trend.platform || 'Cross-platform';
  var sampleCount = (trend.sampleContent && trend.sampleContent.length) || 0;
  var firstSeen = trend.firstSeen ? _socTimeAgo(trend.firstSeen) : '';

  var keywords = '';
  if (trend.keywords && trend.keywords.length) {
    keywords = '<div class="soc-trend-keywords">';
    trend.keywords.forEach(function (kw) {
      keywords += '<span class="soc-trend-keyword">' + _socEscapeHtml(kw) + '</span>';
    });
    keywords += '</div>';
  }

  var html =
    '<div class="soc-trend-card" data-trend-id="' + (trend.id || '') + '">' +
      '<div class="soc-trend-card__header">' +
        '<span class="soc-trend-status ' + statusClass + '">' + _socEscapeHtml(statusLabel) + '</span>' +
        '<span class="soc-trend-score">Score: ' + score + '</span>' +
        '<button class="soc-trend-create" onclick="event.stopPropagation(); socPanelActions.createFromTrend(this)" title="Create content from this trend">' +
          '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 5v14M5 12h14"/></svg>' +
        '</button>' +
        '<button class="soc-trend-dismiss" onclick="event.stopPropagation(); socPanelActions.dismissTrend(\'' + (trend.id || '') + '\')" title="Dismiss trend">' +
          '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18 6L6 18M6 6l12 12"/></svg>' +
        '</button>' +
      '</div>' +
      '<div class="soc-trend-card__topic">' + _socEscapeHtml(trend.topic || trend.keyword || '') + '</div>' +
      keywords +
      '<div class="soc-trend-card__meta">' +
        '<span class="soc-trend-platform">' + _socEscapeHtml(platform) + '</span>' +
        (sampleCount ? '<span class="soc-trend-samples">' + sampleCount + ' sample' + (sampleCount !== 1 ? 's' : '') + '</span>' : '') +
        (firstSeen ? '<span class="soc-trend-first-seen">' + firstSeen + '</span>' : '') +
      '</div>' +
      (sampleCount ? '<div class="soc-trend-card__samples" style="display:none"></div>' : '') +
    '</div>';

  return html;
}

// ─── Entry Points (Create tab) ────────────────────────────────────────────

function _socInitEntryPoints(root) {
  var entrySaved = root.querySelector('#soc-entry-saved');
  var entryVideo = root.querySelector('#soc-entry-video');
  var entryScratch = root.querySelector('#soc-entry-scratch');
  var savedPicker = root.querySelector('#soc-create-saved-picker');
  var savedPickerClose = root.querySelector('#soc-create-saved-picker-close');
  var videoAttach = root.querySelector('#soc-create-video-attach');
  var videoAttachClose = root.querySelector('#soc-create-video-attach-close');
  var scratchPanel = root.querySelector('#soc-create-scratch-panel');

  function hideAllPanels() {
    if (savedPicker) savedPicker.style.display = 'none';
    if (videoAttach) videoAttach.style.display = 'none';
    if (scratchPanel) scratchPanel.style.display = 'none';
  }

  if (entrySaved) {
    entrySaved.addEventListener('click', function () {
      hideAllPanels();
      if (savedPicker) savedPicker.style.display = '';
      _socRenderSavedPicker();
    });
  }

  if (entryVideo) {
    entryVideo.addEventListener('click', function () {
      var social = _socAPI();
      if (!social) { _socShowToast('Social API unavailable', 'error'); return; }
      social.pickVideoFile().then(function (result) {
        if (!result.success) return;
        hideAllPanels();
        if (videoAttach) videoAttach.style.display = '';
        var filenameEl = root.querySelector('#soc-create-video-filename');
        if (filenameEl) filenameEl.textContent = result.fileName || result.filePath.split(/[\\/]/).pop();
        videoAttach.dataset.videoPath = result.filePath;
      });
    });
  }

  // "Create Draft" button inside video attach panel
  var createVideoDraftBtn = root.querySelector('#soc-create-video-draft-btn');
  if (createVideoDraftBtn) {
    createVideoDraftBtn.addEventListener('click', function () {
      var social = _socAPI();
      if (!social) return;
      var filePath = videoAttach && videoAttach.dataset.videoPath;
      if (!filePath) { _socShowToast('No video selected', 'error'); return; }
      var platformEl = root.querySelector('#soc-create-video-platform');
      var platform = platformEl ? platformEl.value : 'tiktok';

      createVideoDraftBtn.disabled = true;
      createVideoDraftBtn.textContent = 'Creating…';

      social.createPost({ platform: platform, content: '', status: 'draft' })
        .then(function (res) {
          if (!res.success) {
            _socShowToast(res.error || 'Failed to create draft', 'error');
            return;
          }
          return social.uploadVideo(res.id, filePath).then(function (uploadRes) {
            if (uploadRes.success) {
              _socShowToast('Draft created with video!', 'success');
              _socLoadDrafts();
              if (videoAttach) {
                videoAttach.style.display = 'none';
                delete videoAttach.dataset.videoPath;
              }
            } else {
              _socShowToast(uploadRes.error || 'Video attach failed', 'error');
            }
          });
        })
        .catch(function (err) {
          console.error('[Social] Create video draft error:', err);
          _socShowToast('Failed to create draft', 'error');
        })
        .finally(function () {
          createVideoDraftBtn.disabled = false;
          createVideoDraftBtn.textContent = 'Create Draft';
        });
    });
  }

  if (entryScratch) {
    entryScratch.addEventListener('click', function () {
      hideAllPanels();
      if (scratchPanel) scratchPanel.style.display = '';
    });
  }

  if (savedPickerClose) {
    savedPickerClose.addEventListener('click', function () {
      if (savedPicker) savedPicker.style.display = 'none';
    });
  }

  if (videoAttachClose) {
    videoAttachClose.addEventListener('click', function () {
      if (videoAttach) {
        videoAttach.style.display = 'none';
        delete videoAttach.dataset.videoPath;
      }
    });
  }
}

function _socRenderSavedPicker() {
  var root = document.getElementById('social-view');
  var listEl = root && root.querySelector('#soc-create-saved-picker-list');
  if (!listEl) return;

  // If cached, render immediately
  if (_socSavedCache && _socSavedCache.length) {
    _socRenderSavedPickerItems(listEl, _socSavedCache);
    return;
  }

  listEl.innerHTML = '<p class="hint" style="text-align:center;padding:16px">Loading saved content…</p>';

  var social = _socAPI();
  if (!social) {
    listEl.innerHTML = '<p class="hint" style="text-align:center;padding:16px">Social API unavailable</p>';
    return;
  }

  social.getSavedContent()
    .then(function (items) {
      _socSavedCache = items;
      _socRenderSavedPickerItems(listEl, items);
    })
    .catch(function () {
      listEl.innerHTML = '<p class="hint" style="text-align:center;padding:16px;color:var(--error)">Failed to load saved content</p>';
    });
}

function _socRenderSavedPickerItems(listEl, items) {
  if (!items || items.length === 0) {
    listEl.innerHTML = '<p class="hint" style="text-align:center;padding:16px">No saved content yet. Discover and save content first.</p>';
    return;
  }

  listEl.innerHTML = items.map(function (item) {
    var title = item.title || item.source_url || '(Untitled)';
    var platform = (item.platform || 'unknown').toUpperCase();
    var preview = (item.transcript || item.body || '').substring(0, 80);
    if (preview.length === 80) preview += '…';

    return '<div class="soc-saved-picker-item" data-id="' + item.id + '">' +
      '<span class="soc-draft-card__platform platform--' + (item.platform || 'unknown') + '">' + _socEscapeHtml(platform) + '</span>' +
      '<div class="soc-saved-picker-item__text">' +
        '<div class="soc-saved-picker-item__title">' + _socEscapeHtml(title) + '</div>' +
        (preview ? '<div class="soc-saved-picker-item__preview">' + _socEscapeHtml(preview) + '</div>' : '') +
      '</div>' +
    '</div>';
  }).join('');

  // Wire click → pre-fill generate form with saved content as source
  listEl.querySelectorAll('.soc-saved-picker-item').forEach(function (el) {
    el.addEventListener('click', function () {
      var id = el.dataset.id;
      var item = _socSavedCache && _socSavedCache.find(function (i) { return i.id === id; });
      if (!item) return;
      var picker = document.getElementById('soc-create-saved-picker');
      if (picker) picker.style.display = 'none';
      // Pre-fill the generate textarea with source content
      var root = document.getElementById('social-view');
      var genPrompt = root && root.querySelector('#soc-gen-prompt');
      if (genPrompt) {
        var text = item.transcript || item.body || item.title || '';
        genPrompt.value = text.substring(0, 2000);
      }
      _socShowToast('Content loaded into generator', 'success');
    });
  });
}

// ─── Drafts Tab ───────────────────────────────────────────────────────────

let _socDraftsCache = null;

function _socLoadDrafts() {
  var social = _socAPI();
  var root = document.getElementById('social-view');
  var listEl = root && root.querySelector('#soc-drafts-list');
  if (!listEl) return;

  if (!social) {
    listEl.innerHTML = '<p class="hint" style="text-align:center;padding:24px">Social API unavailable</p>';
    return;
  }

  var filterEl = root.querySelector('#soc-drafts-filter');
  var platform = filterEl ? filterEl.value : undefined;
  if (!platform) platform = undefined;

  social.getDrafts(platform)
    .then(function (drafts) {
      _socDraftsCache = drafts;
      _socRenderDraftsList(drafts);
    })
    .catch(function (err) {
      console.error('[Social] Failed to load drafts:', err);
      listEl.innerHTML = '<p class="hint" style="text-align:center;color:var(--error)">Failed to load drafts</p>';
    });
}

function _socRenderDraftsList(drafts) {
  var root = document.getElementById('social-view');
  var listEl = root && root.querySelector('#soc-drafts-list');
  if (!listEl) return;

  if (!drafts || drafts.length === 0) {
    listEl.innerHTML =
      '<div class="soc-drafts-empty">' +
        '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><polyline fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" points="14 2 14 8 20 8"/><line fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" x1="16" y1="13" x2="8" y2="13"/><line fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" x1="16" y1="17" x2="8" y2="17"/></svg>' +
        '<p>No drafts yet</p>' +
        '<p class="hint">Repurpose saved content or create from video to generate drafts</p>' +
      '</div>';
    return;
  }

  // Sort: scheduled first (by scheduled_at), then drafts (by created_at desc)
  var scheduled = drafts.filter(function (d) { return d.status === 'scheduled'; });
  var draftItems = drafts.filter(function (d) { return d.status !== 'scheduled'; });
  scheduled.sort(function (a, b) {
    return new Date(a.scheduled_at || 0).getTime() - new Date(b.scheduled_at || 0).getTime();
  });
  draftItems.sort(function (a, b) {
    return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
  });

  var html = '';
  if (scheduled.length > 0) {
    html += '<div class="soc-section-title" style="margin-bottom:8px;font-size:var(--font-sm,12px);color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em">Scheduled (' + scheduled.length + ')</div>';
  }
  var sortedAll = scheduled.concat(draftItems);
  var showedDraftHeader = false;

  listEl.innerHTML = sortedAll.map(function (draft, idx) {
    var groupHtml = '';
    if (!showedDraftHeader && draft.status !== 'scheduled' && scheduled.length > 0) {
      showedDraftHeader = true;
      groupHtml = '<div class="soc-section-title" style="margin:16px 0 8px;font-size:var(--font-sm,12px);color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em">Drafts (' + draftItems.length + ')</div>';
    }

    var p = draft.platform || 'unknown';
    var charLimit = _socPlatformCharLimits[p] || 5000;
    var content = draft.content || '';
    var charCount = content.length;
    var videoPath = draft.video_path || '';
    var videoName = videoPath ? videoPath.split(/[\\/]/).pop() : '';
    var mediaItems = [];
    try { if (draft.media_items) mediaItems = JSON.parse(draft.media_items); } catch (_e2) { /* ignore */ }
    var sourceUrl = draft.source_content_id ? '(from repurpose)' : '';
    var createdAt = draft.created_at ? _socTimeAgo(draft.created_at) : '';

    var metadata = {};
    try { if (draft.metadata) metadata = JSON.parse(draft.metadata); } catch (_e) { /* ignore */ }
    var hashtags = metadata.hashtags || [];
    var hashtagStr = Array.isArray(hashtags) ? hashtags.map(function (h) { return h.startsWith('#') ? h : '#' + h; }).join(' ') : '';
    var sourceTitle = metadata.source_title || '';

    var headerPreview = content
      ? _socEscapeHtml(content.slice(0, 60))
      : '<span style="color:var(--text-muted);font-style:italic">(no content yet)</span>';

    // Video info block (shown when video_path exists)
    var videoInfoHtml = '';
    if (videoPath) {
      videoInfoHtml =
        '<div class="soc-draft-video-info">' +
          '<div class="soc-draft-video-info__thumb">' +
            '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>' +
          '</div>' +
          '<span class="soc-draft-video-info__name">' + _socEscapeHtml(videoName) + '</span>' +
        '</div>';
    }

    // "Generate Copy from Video" button (only when video exists but no content)
    var generateFromVideoHtml = '';
    if (videoPath && !content) {
      generateFromVideoHtml =
        '<button class="soc-btn soc-generate-from-video-btn" data-draft-id="' + draft.id + '">' +
          '\u2728 Generate Copy from Video' +
        '</button>' +
        '<div class="soc-video-progress" data-draft-id="' + draft.id + '" style="display:none">' +
          '<span class="soc-video-progress__step" data-step="upload">\u2713 Upload</span>' +
          '<span class="soc-video-progress__arrow">\u2192</span>' +
          '<span class="soc-video-progress__step" data-step="transcribing">\u25CB Transcribing</span>' +
          '<span class="soc-video-progress__arrow">\u2192</span>' +
          '<span class="soc-video-progress__step" data-step="generating">\u25CB Generate</span>' +
        '</div>';
    }

    return groupHtml + '<div class="soc-draft-card collapsed" data-draft-id="' + draft.id + '" data-platform="' + p + '">' +
      '<div class="soc-draft-card__header" onclick="_socToggleDraftCard(this)">' +
        '<span class="soc-draft-card__platform platform--' + p + '">' + _socEscapeHtml(p.toUpperCase()) + '</span>' +
        '<span style="flex:1;font-size:12px;color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + headerPreview + '</span>' +
        '<span class="soc-draft-card__char-count ' + (charCount > charLimit ? 'over' : '') + '">' + charCount + '/' + charLimit + '</span>' +
        '<svg class="soc-draft-card__chevron" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m6 9 6 6 6-6"/></svg>' +
      '</div>' +
      '<div class="soc-draft-card__body">' +
        '<textarea class="soc-draft-card__textarea soc-drafts-tab-textarea" data-draft-id="' + draft.id + '" data-platform="' + p + '" data-limit="' + charLimit + '">' + _socEscapeHtml(content) + '</textarea>' +
        (hashtagStr ? '<div class="soc-draft-card__hashtags">' + _socEscapeHtml(hashtagStr) + '</div>' : '') +
        videoInfoHtml +
        generateFromVideoHtml +
        // Media strip + attach button
        '<div class="soc-media-strip-row">' +
          _socRenderMediaThumbnails(mediaItems, draft.id) +
          '<button class="soc-btn soc-btn-sm soc-btn-secondary soc-draft-attach-media-btn" data-draft-id="' + draft.id + '">+ Attach Media</button>' +
        '</div>' +
        _socRenderPlatformWarning(p, mediaItems) +
        // Source & meta
        '<div class="soc-draft-card-meta">' +
          (sourceTitle
            ? '<span class="soc-draft-source-link">from: ' + _socEscapeHtml(sourceTitle) + '</span>'
            : (draft.source_content_id ? '<span class="soc-draft-source-link">from: repurposed content</span>' : '')) +
          (createdAt ? '<span>' + createdAt + '</span>' : '') +
        '</div>' +
        // Actions
        '<div class="soc-draft-card__actions">' +
          (content ? '<button class="soc-btn soc-btn-sm soc-btn-primary" onclick="socPanelActions.draftSchedule(\'' + draft.id + '\', this)">Schedule</button>' : '') +
          (content ? '<button class="soc-btn soc-btn-sm soc-btn-secondary" onclick="socPanelActions.draftCopy(\'' + draft.id + '\')">Copy</button>' : '') +
          (content ? '<button class="soc-btn soc-btn-sm soc-btn-secondary soc-draft-preview-btn" data-draft-id="' + draft.id + '" data-platform="' + p + '">Preview \u25BC</button>' : '') +
          (videoPath && content ? '<button class="soc-btn soc-btn-sm soc-btn-accent soc-draft-refine-btn" data-draft-id="' + draft.id + '">Refine with Video</button>' : '') +
          '<button class="soc-btn soc-btn-sm soc-btn-danger" onclick="socPanelActions.draftDelete(\'' + draft.id + '\')">Delete</button>' +
        '</div>' +
        '<div class="soc-draft-card__preview" data-draft-id="' + draft.id + '" style="display:none"></div>' +
        '<div class="soc-draft-card__schedule" style="display:none">' +
          '<input type="datetime-local" class="soc-draft-card__datetime">' +
          '<button class="soc-btn soc-btn-sm soc-btn-accent" onclick="socPanelActions.draftConfirmSchedule(\'' + draft.id + '\', this)">Confirm</button>' +
          '<button class="soc-btn soc-btn-sm soc-btn-secondary" onclick="this.parentElement.style.display=\'none\'">Cancel</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }).join('');

  // Attach inline edit (blur saves)
  listEl.querySelectorAll('.soc-drafts-tab-textarea').forEach(function (ta) {
    ta.addEventListener('input', function () {
      var card = ta.closest('.soc-draft-card');
      var countEl = card && card.querySelector('.soc-draft-card__char-count');
      var limit = parseInt(ta.dataset.limit, 10) || 5000;
      if (countEl) {
        countEl.textContent = ta.value.length + '/' + limit;
        countEl.classList.toggle('over', ta.value.length > limit);
      }
    });
    ta.addEventListener('blur', function () {
      var draftId = ta.dataset.draftId;
      var social = _socAPI();
      if (!social || !draftId) return;
      social.updateDraft(draftId, { content: ta.value })
        .then(function (res) {
          if (!res.success) console.error('[Social] updateDraft failed:', res.error);
        })
        .catch(function (err) { console.error('[Social] updateDraft error:', err); });
    });
  });

  // Attach media buttons
  listEl.querySelectorAll('.soc-draft-attach-media-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var draftId = btn.dataset.draftId;
      _socPickMediaForDraft(draftId);
    });
  });

  // Attach media remove buttons
  listEl.querySelectorAll('.soc-media-thumb__remove').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var draftId = btn.dataset.draftId;
      var idx = parseInt(btn.dataset.mediaIdx, 10);
      _socRemoveMediaItem(draftId, idx);
    });
  });

  // Attach refine-with-video buttons
  listEl.querySelectorAll('.soc-draft-refine-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var draftId = btn.dataset.draftId;
      _socRefineWithVideo(draftId, btn);
    });
  });

  // Attach generate-from-video buttons
  listEl.querySelectorAll('.soc-generate-from-video-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var draftId = btn.dataset.draftId;
      _socGenerateFromVideo(draftId, btn);
    });
  });

  // Attach preview toggle buttons
  listEl.querySelectorAll('.soc-draft-preview-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var draftId = btn.dataset.draftId;
      var platform = btn.dataset.platform;
      var card = btn.closest('.soc-draft-card');
      var previewEl = card && card.querySelector('.soc-draft-card__preview[data-draft-id="' + draftId + '"]');
      if (!previewEl) return;

      var isOpen = previewEl.style.display !== 'none';
      if (isOpen) {
        previewEl.style.display = 'none';
        btn.textContent = 'Preview \u25BC';
        return;
      }

      // Get current content from textarea
      var ta = card.querySelector('.soc-draft-card__textarea');
      var content = ta ? ta.value : '';
      var mediaItems = [];
      try {
        var mediaJson = card.getAttribute('data-media-items');
        if (mediaJson) mediaItems = JSON.parse(mediaJson);
      } catch (_e) { /* ignore */ }

      // Find first media image URL
      var imageUrl = '';
      var thumbs = card.querySelectorAll('.soc-media-thumb img');
      if (thumbs.length > 0) imageUrl = thumbs[0].src || '';

      var mockupData = {
        username: 'youraccount',
        caption: content,
        imageUrl: imageUrl
      };

      // Build mockup HTML
      var mockupClass = 'soc-mockup soc-mockup-' + (platform === 'twitter' ? 'tw' : platform === 'tiktok' ? 'tt' : platform === 'instagram' ? 'ig' : platform === 'facebook' ? 'fb' : platform === 'linkedin' ? 'li' : 'tw');
      previewEl.innerHTML =
        '<div style="display:flex;flex-direction:column;align-items:center">' +
          '<div class="' + mockupClass + '" id="soc-draft-mockup-' + draftId + '"></div>' +
        '</div>';

      // Render mockup using existing renderer
      var mockupEl = previewEl.querySelector('#soc-draft-mockup-' + draftId);
      if (mockupEl) {
        if (platform === 'instagram') _socRenderIGMockup(mockupEl, mockupData);
        else if (platform === 'tiktok') _socRenderTTMockup(mockupEl, mockupData);
        else if (platform === 'twitter') _socRenderTWMockup(mockupEl, mockupData);
        else if (platform === 'facebook') _socRenderFBMockup(mockupEl, mockupData);
        else if (platform === 'linkedin') _socRenderLIMockup(mockupEl, mockupData);
      }

      previewEl.style.display = 'block';
      btn.textContent = 'Preview \u25B2';
    });
  });
}

function _socRefineWithVideo(draftId, btn) {
  var social = _socAPI();
  if (!social) return;

  var card = btn.closest('.soc-draft-card');
  var ta = card && card.querySelector('.soc-draft-card__textarea');
  var originalText = ta ? ta.value : '';

  // Show loading state
  btn.disabled = true;
  btn.textContent = 'Refining...';

  social.refineWithVideo(draftId)
    .then(function (res) {
      btn.disabled = false;
      btn.textContent = 'Refine with Video';
      if (!res.success) {
        _socShowToast(res.error || 'Refine failed', 'error');
        return;
      }

      if (!ta) return;

      // Show refined copy and allow accept/undo
      ta.value = res.refinedCopy;
      ta.dispatchEvent(new Event('input'));

      // Replace actions with accept/undo
      var actionsEl = card.querySelector('.soc-draft-card__actions');
      if (!actionsEl) return;
      var origHtml = actionsEl.innerHTML;
      actionsEl.innerHTML =
        '<span style="font-size:12px;color:var(--text-secondary)">Refined copy — </span>' +
        '<button class="soc-btn soc-btn-sm soc-btn-primary soc-refine-accept-btn">Accept</button>' +
        '<button class="soc-btn soc-btn-sm soc-btn-secondary soc-refine-undo-btn">Undo</button>';

      actionsEl.querySelector('.soc-refine-accept-btn').addEventListener('click', function () {
        // Save the refined copy
        social.updateDraft(draftId, { content: res.refinedCopy });
        _socShowToast('Refined copy accepted', 'success');
        actionsEl.innerHTML = origHtml;
        // Re-attach refine button listener
        var newRefineBtn = actionsEl.querySelector('.soc-draft-refine-btn');
        if (newRefineBtn) {
          newRefineBtn.addEventListener('click', function () { _socRefineWithVideo(draftId, newRefineBtn); });
        }
      });

      actionsEl.querySelector('.soc-refine-undo-btn').addEventListener('click', function () {
        // Restore original
        ta.value = originalText;
        ta.dispatchEvent(new Event('input'));
        actionsEl.innerHTML = origHtml;
        // Re-attach refine button listener
        var newRefineBtn = actionsEl.querySelector('.soc-draft-refine-btn');
        if (newRefineBtn) {
          newRefineBtn.addEventListener('click', function () { _socRefineWithVideo(draftId, newRefineBtn); });
        }
      });
    })
    .catch(function () {
      btn.disabled = false;
      btn.textContent = 'Refine with Video';
      _socShowToast('Refine error', 'error');
    });
}

function _socGenerateFromVideo(draftId, btn) {
  var social = _socAPI();
  if (!social) return;

  var card = btn.closest('.soc-draft-card');
  var progressEl = card && card.querySelector('.soc-video-progress[data-draft-id="' + draftId + '"]');

  btn.disabled = true;
  btn.textContent = 'Generating…';
  if (progressEl) {
    progressEl.style.display = 'flex';
    // Mark upload as done (file already attached)
    var uploadStep = progressEl.querySelector('[data-step="upload"]');
    if (uploadStep) { uploadStep.textContent = '\u2713 Upload'; uploadStep.classList.add('done'); }
  }

  social.generateFromVideo(draftId)
    .then(function (res) {
      if (res.success) {
        _socShowToast('Copy generated from video!', 'success');
        _socLoadDrafts();
      } else {
        _socShowToast(res.error || 'Generation failed', 'error');
        btn.disabled = false;
        btn.textContent = '\u2728 Generate Copy from Video';
        if (progressEl) progressEl.style.display = 'none';
      }
    })
    .catch(function (err) {
      console.error('[Social] Generate from video error:', err);
      _socShowToast('Generation failed', 'error');
      btn.disabled = false;
      btn.textContent = '\u2728 Generate Copy from Video';
      if (progressEl) progressEl.style.display = 'none';
    });
}

function _socRenderMediaThumbnails(mediaItems, draftId) {
  if (!mediaItems || !mediaItems.length) return '';
  return '<div class="soc-media-strip">' +
    mediaItems.map(function (item, idx) {
      var isVideo = item.type === 'video';
      var label = isVideo ? '\uD83C\uDFAC' : '';
      return '<div class="soc-media-thumb soc-media-thumb--entering" title="' + _socEscapeHtml(item.name) + '">' +
        (isVideo
          ? '<div class="soc-media-thumb__video-icon">' + label + '</div>'
          : '<img src="file://' + _socEscapeHtml(item.path.replace(/\\/g, '/')) + '" alt="' + _socEscapeHtml(item.name) + '" />') +
        '<button class="soc-media-thumb__remove" data-draft-id="' + draftId + '" data-media-idx="' + idx + '">\u2715</button>' +
      '</div>';
    }).join('') +
  '</div>';
}

function _socRenderPlatformWarning(platform, mediaItems) {
  if (!mediaItems || !mediaItems.length) return '';
  var hasVideo = mediaItems.some(function (i) { return i.type === 'video'; });
  var hasImage = mediaItems.some(function (i) { return i.type === 'image'; });
  var imageCount = mediaItems.filter(function (i) { return i.type === 'image'; }).length;
  var warnings = [];

  if (platform === 'tiktok' && !hasVideo) {
    warnings.push('TikTok requires a video');
  }
  if (platform === 'instagram' && imageCount > 10) {
    warnings.push('Instagram allows up to 10 images');
  }
  if (platform === 'instagram' && hasVideo && hasImage) {
    warnings.push('Instagram: mix video and images in separate posts');
  }
  if ((platform === 'x' || platform === 'twitter') && imageCount > 4) {
    warnings.push('X allows up to 4 images per post');
  }
  if ((platform === 'x' || platform === 'twitter') && hasVideo && hasImage) {
    warnings.push('X: cannot mix video and images');
  }
  if (platform === 'linkedin' && imageCount > 9) {
    warnings.push('LinkedIn allows up to 9 images');
  }

  if (!warnings.length) return '';
  return warnings.map(function (w) {
    return '<div class="soc-platform-warning">\u26A0 ' + _socEscapeHtml(w) + '</div>';
  }).join('');
}

function _socPickMediaForDraft(draftId) {
  var social = _socAPI();
  if (!social) return;

  social.pickMediaFiles().then(function (result) {
    if (!result.success || !result.files || !result.files.length) return;

    // Show progress bar in the draft card
    var card = document.querySelector('.soc-draft-card[data-draft-id="' + draftId + '"]');
    var progressBar = null;
    if (card) {
      var body = card.querySelector('.soc-draft-card__body');
      if (body) {
        progressBar = document.createElement('div');
        progressBar.className = 'soc-progress-bar';
        progressBar.innerHTML = '<div class="soc-progress-fill" style="width:20%"></div>';
        body.insertBefore(progressBar, body.firstChild);
      }
    }

    // Simulate progress steps
    var fill = progressBar && progressBar.querySelector('.soc-progress-fill');
    if (fill) setTimeout(function () { fill.style.width = '60%'; }, 300);

    social.attachMedia(draftId, result.files)
      .then(function (res) {
        if (fill) fill.style.width = '100%';
        setTimeout(function () {
          if (progressBar && progressBar.parentNode) progressBar.remove();
          if (res.success) {
            _socShowToast('Media attached!', 'success');
            _socLoadDrafts();
          } else {
            _socShowToast(res.error || 'Attach failed', 'error');
          }
        }, 300);
      })
      .catch(function () {
        if (progressBar && progressBar.parentNode) progressBar.remove();
        _socShowToast('Media attach error', 'error');
      });
  });
}

function _socRemoveMediaItem(draftId, idx) {
  var social = _socAPI();
  if (!social) return;

  // Find the draft in cache to get current media_items
  var draft = null;
  if (_socDraftsCache) {
    draft = _socDraftsCache.find(function (d) { return d.id === draftId; });
  }
  if (!draft) return;

  var mediaItems = [];
  try { if (draft.media_items) mediaItems = JSON.parse(draft.media_items); } catch (_e) { /* ignore */ }
  mediaItems.splice(idx, 1);

  social.updateDraft(draftId, { media_items: JSON.stringify(mediaItems) })
    .then(function (res) {
      if (res.success) {
        _socShowToast('Media removed', 'success');
        _socLoadDrafts();
      }
    })
    .catch(function () { _socShowToast('Remove failed', 'error'); });
}

function _socPickVideoForDraft(draftId) {
  var social = _socAPI();
  if (!social) return;

  social.pickVideoFile().then(function (result) {
    if (!result.success) return;

    // Show progress bar in the draft card
    var card = document.querySelector('.soc-draft-card[data-draft-id="' + draftId + '"]');
    var progressBar = null;
    if (card) {
      var body = card.querySelector('.soc-draft-card__body');
      if (body) {
        progressBar = document.createElement('div');
        progressBar.className = 'soc-progress-bar';
        progressBar.innerHTML = '<div class="soc-progress-fill" style="width:10%"></div>';
        body.insertBefore(progressBar, body.firstChild);
      }
    }

    // Simulate upload progress steps
    var fill = progressBar && progressBar.querySelector('.soc-progress-fill');
    if (fill) {
      setTimeout(function () { fill.style.width = '40%'; }, 500);
      setTimeout(function () { fill.style.width = '70%'; }, 1200);
    }

    social.uploadVideo(draftId, result.filePath)
      .then(function (res) {
        if (fill) fill.style.width = '100%';
        setTimeout(function () {
          if (progressBar && progressBar.parentNode) progressBar.remove();
          if (res.success) {
            _socShowToast('Video attached!', 'success');
            _socLoadDrafts();
          } else {
            _socShowToast(res.error || 'Upload failed', 'error');
          }
        }, 300);
      })
      .catch(function () {
        if (progressBar && progressBar.parentNode) progressBar.remove();
        _socShowToast('Video upload error', 'error');
      });
  });
}

function _socSetStep(stepId, state) {
  var el = document.getElementById(stepId);
  if (!el) return;
  el.classList.remove('active', 'done');
  if (state === 'active') el.classList.add('active');
  else if (state === 'done') {
    el.classList.add('done');
    var icon = el.querySelector('.soc-step__icon');
    if (icon) icon.textContent = '\u2713';
  }
}

function _socResetSteps() {
  ['soc-step-upload', 'soc-step-transcribe', 'soc-step-generate'].forEach(function (id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('active', 'done');
    var icon = el.querySelector('.soc-step__icon');
    if (icon) icon.textContent = id === 'soc-step-upload' ? '1' : id === 'soc-step-transcribe' ? '2' : '3';
  });
}

function _socInitColdUpload() {
  var root = document.getElementById('social-view');
  if (!root) return;

  var uploadBtn = root.querySelector('#soc-cold-upload-btn');
  var filenameEl = root.querySelector('#soc-cold-upload-filename');
  var progressEl = root.querySelector('#soc-cold-upload-progress');
  var platformEl = root.querySelector('#soc-cold-upload-platform');
  var dropzone = root.querySelector('#soc-video-dropzone');

  if (!uploadBtn) return;

  function startUpload() {
    var social = _socAPI();
    if (!social) return;

    social.pickVideoFile().then(function (result) {
      if (!result.success) return;
      var selectedFilePath = result.filePath;
      filenameEl.textContent = result.fileName;

      var platform = platformEl ? platformEl.value : 'tiktok';
      if (!selectedFilePath) return;

      progressEl.style.display = 'flex';
      _socResetSteps();
      _socSetStep('soc-step-upload', 'active');
      uploadBtn.disabled = true;

      // Simulate upload step completing, then transcribe
      setTimeout(function () {
        _socSetStep('soc-step-upload', 'done');
        _socSetStep('soc-step-transcribe', 'active');
      }, 500);

      social.coldUpload(selectedFilePath, platform)
        .then(function (res) {
          if (res.success) {
            _socSetStep('soc-step-transcribe', 'done');
            _socSetStep('soc-step-generate', 'done');
            _socShowToast('Draft created from video!', 'success');
            _socLoadDrafts();

            // Auto-scroll to the newest draft card
            setTimeout(function () {
              var list = root.querySelector('#soc-drafts-list');
              if (list) {
                var firstCard = list.querySelector('.soc-draft-card');
                if (firstCard) firstCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
              }
            }, 300);

            setTimeout(function () {
              progressEl.style.display = 'none';
              filenameEl.textContent = '';
              uploadBtn.disabled = false;
              _socResetSteps();
            }, 2500);
          } else {
            _socResetSteps();
            progressEl.style.display = 'none';
            _socShowToast(res.error || 'Create from video failed', 'error');
            uploadBtn.disabled = false;
          }
        })
        .catch(function (err) {
          console.error('[Social] Create from video error:', err);
          _socResetSteps();
          progressEl.style.display = 'none';
          _socShowToast('Create from video failed', 'error');
          uploadBtn.disabled = false;
        });
    });
  }

  uploadBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    startUpload();
  });

  if (dropzone) {
    dropzone.addEventListener('click', function (e) {
      // Don't trigger if clicking the button or select directly
      if (e.target.closest('button') || e.target.closest('select')) return;
      startUpload();
    });
  }
}

// eslint-disable-next-line no-unused-vars
function _socRefreshDrafts() {
  _socLoadDrafts();
}

// ─── Posts Tab ─────────────────────────────────────────────────────────────

function _socLoadPosts() {
  const social = _socAPI();
  const root   = document.getElementById('social-view');
  const tbody  = root && root.querySelector('#soc-posts-table-body');
  if (!tbody) return;

  if (!social) { tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:24px">Social API unavailable</td></tr>'; return; }

  const filterEl = root.querySelector('#soc-posts-filter');
  let filterStatus = filterEl ? filterEl.value : undefined;
  if (filterStatus === 'all') filterStatus = undefined;

  social.listPosts(filterStatus)
    .then(posts => {
      if (!posts || posts.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:28px;color:var(--text-muted)">No posts yet. Compose your first post above!</td></tr>';
        return;
      }
      tbody.innerHTML = posts.map(post =>
        '<tr data-id="' + post.id + '">' +
          '<td>' + _socMakePlatformBadge(post.platform) + '</td>' +
          '<td><div class="content-preview">' + _socEscapeHtml(post.content) + '</div></td>' +
          '<td>' + _socMakeStatusBadge(post.status) + '</td>' +
          '<td style="font-size:11px;color:var(--text-muted)">' + (post.scheduled_at ? new Date(post.scheduled_at).toLocaleString() : '—') + '</td>' +
          '<td style="font-size:11px;color:var(--text-muted)">' + _socTimeAgo(post.created_at) + '</td>' +
          '<td class="actions-cell">' +
            '<button class="soc-icon-btn danger" onclick="socPanelActions.deletePost(\'' + post.id + '\')" title="Delete">' +
              '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.5" d="m19.5 5.5l-.62 10.025c-.158 2.561-.237 3.842-.88 4.763a4 4 0 0 1-1.2 1.128c-.957.584-2.24.584-4.806.584c-2.57 0-3.855 0-4.814-.585a4 4 0 0 1-1.2-1.13c-.642-.922-.72-2.205-.874-4.77L4.5 5.5M3 5.5h18m-4.944 0l-.683-1.408c-.453-.936-.68-1.403-1.071-1.695a2 2 0 0 0-.275-.172C13.594 2 13.074 2 12.035 2c-1.066 0-1.599 0-2.04.234a2 2 0 0 0-.278.18c-.395.303-.616.788-1.058 1.757L8.053 5.5"/></svg>' +
            '</button>' +
          '</td>' +
        '</tr>'
      ).join('');
    })
    .catch(err => {
      console.error('[Social] Failed to load posts:', err);
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--error)">Failed to load posts</td></tr>';
    });
}

// ─── Calendar Tab ─────────────────────────────────────────────────────────

let _socCalendarView = localStorage.getItem('soc-calendar-view') || 'month';

function showCalendarPanel() {
  if (_socCalendarInitialized) return;
  _socCalendarInitialized = true;

  const root = document.getElementById('social-view');
  if (!root) return;

  const prevBtn  = root.querySelector('#soc-calendar-prev');
  const nextBtn  = root.querySelector('#soc-calendar-next');
  const todayBtn = root.querySelector('#soc-calendar-today');
  const closeBtn = root.querySelector('#soc-calendar-sidebar-close');

  if (prevBtn)  prevBtn.addEventListener('click', () => _socCalendarNavigate(-1));
  if (nextBtn)  nextBtn.addEventListener('click', () => _socCalendarNavigate(1));
  if (todayBtn) todayBtn.addEventListener('click', _socCalendarGoToday);
  if (closeBtn) closeBtn.addEventListener('click', _socCalendarCloseSidebar);

  // View switcher
  root.querySelectorAll('.soc-calendar-view-btn').forEach(function (btn) {
    if (btn.dataset.view === _socCalendarView) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
    btn.addEventListener('click', function () {
      root.querySelectorAll('.soc-calendar-view-btn').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      _socCalendarView = btn.dataset.view;
      localStorage.setItem('soc-calendar-view', _socCalendarView);
      _socCalendarSwitchView();
    });
  });

  // Set initial view visibility and render
  _socCalendarSwitchView();
  _socCalendarGoToday();
}

let _socCalendarYear  = new Date().getFullYear();
let _socCalendarMonth = new Date().getMonth();

// Week view tracks start-of-week date (Monday)
let _socCalendarWeekStart = (function () {
  var d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); d.setHours(0, 0, 0, 0); return d;
})();

function _socCalendarNavigate(delta) {
  if (_socCalendarView === 'week') {
    _socCalendarWeekStart = new Date(_socCalendarWeekStart);
    _socCalendarWeekStart.setDate(_socCalendarWeekStart.getDate() + delta * 7);
    _socCalendarRenderCurrentView();
    return;
  }
  // Month / agenda navigate by month
  _socCalendarMonth += delta;
  if (_socCalendarMonth > 11) { _socCalendarMonth = 0; _socCalendarYear++; }
  if (_socCalendarMonth < 0)  { _socCalendarMonth = 11; _socCalendarYear--; }
  _socCalendarRenderCurrentView();
}

function _socCalendarGoToday() {
  var now = new Date();
  _socCalendarYear  = now.getFullYear();
  _socCalendarMonth = now.getMonth();
  _socCalendarWeekStart = new Date(now);
  _socCalendarWeekStart.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  _socCalendarWeekStart.setHours(0, 0, 0, 0);
  _socCalendarRenderCurrentView();
}

function _socCalendarSwitchView() {
  var root = document.getElementById('social-view');
  if (!root) return;
  var monthGrid  = root.querySelector('#soc-calendar-grid');
  var weekdays   = root.querySelector('.soc-calendar-weekdays');
  var weekView   = root.querySelector('#soc-calendar-week-view');
  var agendaView = root.querySelector('#soc-calendar-agenda-view');
  var postsView  = root.querySelector('#soc-calendar-posts-view');

  if (monthGrid)  monthGrid.style.display  = _socCalendarView === 'month' ? '' : 'none';
  if (weekdays)   weekdays.style.display   = _socCalendarView === 'month' ? '' : 'none';
  if (weekView)   weekView.style.display   = _socCalendarView === 'week' ? '' : 'none';
  if (agendaView) agendaView.style.display = _socCalendarView === 'agenda' ? '' : 'none';
  if (postsView)  postsView.style.display  = _socCalendarView === 'posts' ? '' : 'none';

  _socCalendarCloseSidebar();
  _socCalendarRenderCurrentView();
}

function _socCalendarRenderCurrentView() {
  if (_socCalendarView === 'week') {
    _socRenderWeekView(_socCalendarWeekStart);
  } else if (_socCalendarView === 'agenda') {
    _socRenderAgendaView();
  } else if (_socCalendarView === 'posts') {
    _socLoadPosts();
  } else {
    _socCalendarRender();
  }
  _socCalendarUpdateLabel();
}

function _socCalendarUpdateLabel() {
  var root = document.getElementById('social-view');
  if (!root) return;
  var label = root.querySelector('#soc-calendar-month-label');
  if (!label) return;
  var monthNames = ['January','February','March','April','May','June',
    'July','August','September','October','November','December'];

  if (_socCalendarView === 'posts') {
    label.textContent = 'All Posts';
  } else if (_socCalendarView === 'week') {
    var end = new Date(_socCalendarWeekStart);
    end.setDate(end.getDate() + 6);
    var sMonth = monthNames[_socCalendarWeekStart.getMonth()].substring(0, 3);
    var eMonth = monthNames[end.getMonth()].substring(0, 3);
    if (_socCalendarWeekStart.getMonth() === end.getMonth()) {
      label.textContent = sMonth + ' ' + _socCalendarWeekStart.getDate() + ' – ' + end.getDate() + ', ' + end.getFullYear();
    } else {
      label.textContent = sMonth + ' ' + _socCalendarWeekStart.getDate() + ' – ' + eMonth + ' ' + end.getDate() + ', ' + end.getFullYear();
    }
  } else {
    label.textContent = monthNames[_socCalendarMonth] + ' ' + _socCalendarYear;
  }
}

// Platform colors for calendar chips
const _socCalendarPlatformColors = {
  tiktok:    '#ff2d55',
  youtube:   '#ff0000',
  instagram: '#c13584',
  twitter:   '#1da1f2',
  x:         '#1da1f2',
  linkedin:  '#0077b5',
  facebook:  '#1877f2',
  threads:   '#000000',
  pinterest: '#e60023',
};

// Cached posts keyed by date string (YYYY-MM-DD)
let _socCalendarPostsByDay = {};
let _socDragPostStatus = null; // tracks status of chip being dragged

function _socCalendarDateStr(date) {
  var y = date.getFullYear();
  var m = String(date.getMonth() + 1).padStart(2, '0');
  var d = String(date.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + d;
}

function _socCalendarRender() {
  var root = document.getElementById('social-view');
  if (!root) return;

  var grid  = root.querySelector('#soc-calendar-grid');
  if (!grid) return;

  _socCalendarUpdateLabel();

  // Build 42-cell date array (6 weeks x 7 days, Mon-based)
  var firstDay = new Date(_socCalendarYear, _socCalendarMonth, 1).getDay();
  var startOffset = (firstDay + 6) % 7; // Mon=0
  var daysInMonth = new Date(_socCalendarYear, _socCalendarMonth + 1, 0).getDate();

  // Start date = first visible day (may be in prev month)
  var startDate = new Date(_socCalendarYear, _socCalendarMonth, 1 - startOffset);
  var cells = [];
  for (var i = 0; i < 42; i++) {
    var d = new Date(startDate);
    d.setDate(d.getDate() + i);
    cells.push(d);
  }

  var rangeStart = _socCalendarDateStr(cells[0]);
  var rangeEnd   = _socCalendarDateStr(cells[41]);

  // Show skeleton while loading
  grid.innerHTML = '<div class="soc-calendar-loading">Loading posts…</div>';

  var social = _socAPI();
  if (!social) {
    _socCalendarRenderGrid(root, grid, cells, {});
    return;
  }

  social.getCalendarPosts(rangeStart, rangeEnd)
    .then(function (posts) {
      // Group posts by date
      var byDay = {};
      (posts || []).forEach(function (post) {
        var dateKey = (post.scheduled_at || post.created_at || '').substring(0, 10);
        if (!dateKey) return;
        if (!byDay[dateKey]) byDay[dateKey] = [];
        byDay[dateKey].push(post);
      });
      _socCalendarPostsByDay = byDay;
      _socCalendarRenderGrid(root, grid, cells, byDay);
    })
    .catch(function (err) {
      console.error('[Social] Calendar fetch failed:', err);
      _socCalendarPostsByDay = {};
      _socCalendarRenderGrid(root, grid, cells, {});
    });
}

function _socCalendarRenderGrid(root, grid, cells, postsByDay) {
  var today = new Date();
  var todayStr = _socCalendarDateStr(today);
  var html = '';

  for (var i = 0; i < cells.length; i++) {
    var date = cells[i];
    var dateStr = _socCalendarDateStr(date);
    var isOutside = date.getMonth() !== _socCalendarMonth;
    var isToday = dateStr === todayStr;
    var dayPosts = postsByDay[dateStr] || [];
    html += _socRenderCalendarDay(date, dateStr, dayPosts, isToday, isOutside);
  }

  grid.innerHTML = html;

  // Click handlers for all day cells
  grid.querySelectorAll('.soc-calendar-cell').forEach(function (cell) {
    cell.addEventListener('click', function () {
      grid.querySelectorAll('.soc-calendar-cell').forEach(function (c) {
        c.classList.remove('soc-calendar-cell-selected');
      });
      cell.classList.add('soc-calendar-cell-selected');
      _socCalendarShowDay(cell.dataset.date);
    });

    // Drop handlers for drag-to-reschedule
    cell.addEventListener('dragover', function (e) {
      e.preventDefault();
      var postStatus = e.dataTransfer.types.includes('text/plain') ? 'unknown' : '';
      var dateStr = cell.dataset.date;
      var todayStr = _socCalendarDateStr(new Date());
      if (dateStr < todayStr && _socDragPostStatus === 'scheduled') {
        cell.classList.add('soc-calendar-cell-drop-invalid');
      } else {
        cell.classList.add('soc-calendar-cell-drop-target');
      }
    });

    cell.addEventListener('dragleave', function () {
      cell.classList.remove('soc-calendar-cell-drop-target');
      cell.classList.remove('soc-calendar-cell-drop-invalid');
    });

    cell.addEventListener('drop', function (e) {
      e.preventDefault();
      cell.classList.remove('soc-calendar-cell-drop-target');
      cell.classList.remove('soc-calendar-cell-drop-invalid');
      var postId = e.dataTransfer.getData('text/plain');
      var dateStr = cell.dataset.date;
      var todayStr = _socCalendarDateStr(new Date());
      if (!postId) return;
      if (dateStr < todayStr && _socDragPostStatus === 'scheduled') {
        _socShowToast('Cannot move scheduled posts to past dates', 'error');
        return;
      }
      _socReschedulePost(postId, dateStr);
    });
  });

  // Drag handlers on chips
  grid.querySelectorAll('.soc-calendar-chip--draggable').forEach(function (chip) {
    chip.addEventListener('dragstart', function (e) {
      e.stopPropagation();
      e.dataTransfer.setData('text/plain', chip.dataset.postId);
      e.dataTransfer.effectAllowed = 'move';
      _socDragPostStatus = chip.dataset.postStatus || 'draft';
      chip.classList.add('soc-calendar-chip--dragging');
    });
    chip.addEventListener('dragend', function () {
      chip.classList.remove('soc-calendar-chip--dragging');
      _socDragPostStatus = null;
      grid.querySelectorAll('.soc-calendar-cell').forEach(function (c) {
        c.classList.remove('soc-calendar-cell-drop-target');
        c.classList.remove('soc-calendar-cell-drop-invalid');
      });
    });
  });
}

function _socRenderCalendarDay(date, dateStr, posts, isToday, isOutside) {
  var cls = 'soc-calendar-cell';
  if (isToday)   cls += ' soc-calendar-cell-today';
  if (isOutside) cls += ' soc-calendar-cell-outside';

  var dayNum = date.getDate();
  var html = '<div class="' + cls + '" data-date="' + dateStr + '">';
  html += '<span class="soc-calendar-day-num">' + dayNum + '</span>';

  // Render up to 3 post chips
  var maxChips = 3;
  var shown = Math.min(posts.length, maxChips);
  for (var i = 0; i < shown; i++) {
    var post = posts[i];
    var platform = (post.platform || '').toLowerCase();
    var color = _socCalendarPlatformColors[platform] || 'var(--text-secondary)';
    var time = '';
    var schedStr = post.scheduled_at || post.created_at || '';
    if (schedStr && schedStr.length > 10) {
      var d = new Date(schedStr);
      var h = d.getHours();
      var m = String(d.getMinutes()).padStart(2, '0');
      var ampm = h >= 12 ? 'p' : 'a';
      time = (h % 12 || 12) + ':' + m + ampm;
    }
    var chipTitle = _socEscapeHtml(post.title || post.body || post.content || 'Untitled');
    if (chipTitle.length > 20) chipTitle = chipTitle.substring(0, 20) + '…';
    var isDraggable = post.status === 'draft' || post.status === 'scheduled';
    html +=
      '<div class="soc-calendar-chip' + (isDraggable ? ' soc-calendar-chip--draggable' : '') + '"' +
        ' style="border-left-color:' + color + '"' +
        ' title="' + _socEscapeHtml(post.title || post.body || '') + '"' +
        (isDraggable ? ' draggable="true" data-post-id="' + _socEscapeHtml(post.id || '') + '" data-post-status="' + post.status + '"' : '') +
      '>' +
        (time ? '<span class="soc-calendar-chip-time">' + time + '</span>' : '') +
        '<span class="soc-calendar-chip-title">' + chipTitle + '</span>' +
      '</div>';
  }

  // Overflow indicator
  if (posts.length > maxChips) {
    html += '<div class="soc-calendar-more">+' + (posts.length - maxChips) + ' more</div>';
  }

  html += '</div>';
  return html;
}

function _socCalendarShowDay(dateStr) {
  var root = document.getElementById('social-view');
  if (!root) return;
  var sidebar  = root.querySelector('#soc-calendar-sidebar');
  var titleEl  = root.querySelector('#soc-calendar-sidebar-title');
  var postsEl  = root.querySelector('#soc-calendar-sidebar-posts');
  if (!sidebar || !titleEl || !postsEl) return;

  var parts = dateStr.split('-');
  var monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  titleEl.textContent = monthNames[parseInt(parts[1], 10) - 1] + ' ' + parseInt(parts[2], 10) + ', ' + parts[0];
  sidebar.classList.add('open');
  sidebar.dataset.selectedDate = dateStr;

  var dayPosts = _socCalendarPostsByDay[dateStr] || [];

  // Quick Schedule button (always shown)
  var html = '<button class="soc-btn soc-btn-accent soc-calendar-quick-schedule-btn" onclick="socPanelActions.calendarQuickScheduleToggle()">' +
    '+ Quick Schedule</button>';

  // Quick Schedule form (hidden by default)
  html += '<div class="soc-calendar-quick-form" id="soc-calendar-quick-form" style="display:none;">' +
    '<select id="soc-calendar-quick-platform">' +
      '<option value="tiktok">TikTok</option>' +
      '<option value="youtube">YouTube</option>' +
      '<option value="instagram">Instagram</option>' +
      '<option value="twitter">X / Twitter</option>' +
      '<option value="linkedin">LinkedIn</option>' +
      '<option value="facebook">Facebook</option>' +
    '</select>' +
    '<textarea id="soc-calendar-quick-content" placeholder="Post content..." rows="3"></textarea>' +
    '<input type="time" id="soc-calendar-quick-time" value="12:00" />' +
    '<div class="soc-calendar-quick-actions">' +
      '<button class="soc-btn soc-btn-accent" onclick="socPanelActions.calendarQuickScheduleSave()">Schedule</button>' +
      '<button class="soc-btn soc-btn-secondary" onclick="socPanelActions.calendarQuickScheduleToggle()">Cancel</button>' +
    '</div>' +
  '</div>';

  if (dayPosts.length === 0) {
    html += '<p class="soc-calendar-empty">No posts scheduled for this day</p>';
    postsEl.innerHTML = html;
    return;
  }

  dayPosts.forEach(function (post) {
    var platform = (post.platform || '').toLowerCase();
    var color = _socCalendarPlatformColors[platform] || 'var(--text-secondary)';
    var time = '';
    var schedStr = post.scheduled_at || post.created_at || '';
    if (schedStr && schedStr.length > 10) {
      var d = new Date(schedStr);
      var h = d.getHours();
      var m = String(d.getMinutes()).padStart(2, '0');
      var ampm = h >= 12 ? 'PM' : 'AM';
      time = (h % 12 || 12) + ':' + m + ' ' + ampm;
    }
    var rawContent = post.title || post.body || post.content || 'Untitled';
    var preview = rawContent.length > 50 ? _socEscapeHtml(rawContent.substring(0, 50)) + '…' : _socEscapeHtml(rawContent);
    var postId = _socEscapeHtml(post.id || '');
    html +=
      '<div class="soc-calendar-sidebar-post" style="border-left: 3px solid ' + color + '" data-post-id="' + postId + '">' +
        '<div class="soc-calendar-sidebar-post-header">' +
          _socMakePlatformBadge(post.platform || 'unknown') +
          ' ' + _socMakeStatusBadge(post.status) +
        '</div>' +
        '<div class="soc-calendar-sidebar-post-title">' + preview + '</div>' +
        (time ? '<div class="soc-calendar-sidebar-post-time">' + time + '</div>' : '') +
        '<div class="soc-calendar-sidebar-post-actions">' +
          '<button class="soc-btn soc-btn-sm soc-btn-secondary" onclick="socPanelActions.calendarReschedule(\'' + postId + '\')" title="Reschedule">' +
            '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l2 2"/></g></svg>' +
            ' Reschedule' +
          '</button>' +
          '<button class="soc-icon-btn danger" onclick="socPanelActions.calendarDeletePost(\'' + postId + '\', \'' + _socEscapeHtml(dateStr) + '\')" title="Delete">' +
            '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.5" d="m19.5 5.5l-.62 10.025c-.158 2.561-.237 3.842-.88 4.763a4 4 0 0 1-1.2 1.128c-.957.584-2.24.584-4.806.584c-2.57 0-3.855 0-4.814-.585a4 4 0 0 1-1.2-1.13c-.642-.922-.72-2.205-.874-4.77L4.5 5.5M3 5.5h18m-4.944 0l-.683-1.408c-.453-.936-.68-1.403-1.071-1.695a2 2 0 0 0-.275-.172C13.594 2 13.074 2 12.035 2c-1.066 0-1.599 0-2.04.234a2 2 0 0 0-.278.18c-.395.303-.616.788-1.058 1.757L8.053 5.5"/></svg>' +
          '</button>' +
        '</div>' +
        '<div class="soc-calendar-reschedule-picker" id="soc-calendar-reschedule-' + postId + '" style="display:none;">' +
          '<input type="datetime-local" class="soc-calendar-reschedule-input" />' +
          '<div class="soc-calendar-quick-actions">' +
            '<button class="soc-btn soc-btn-sm soc-btn-accent" onclick="socPanelActions.calendarRescheduleSave(\'' + postId + '\', \'' + _socEscapeHtml(dateStr) + '\')">Save</button>' +
            '<button class="soc-btn soc-btn-sm soc-btn-secondary" onclick="socPanelActions.calendarRescheduleCancel(\'' + postId + '\')">Cancel</button>' +
          '</div>' +
        '</div>' +
      '</div>';
  });
  postsEl.innerHTML = html;
}

function _socReschedulePost(postId, newDateStr) {
  var social = _socAPI();
  if (!social) { _socShowToast('Social API unavailable', 'error'); return; }

  // Add loading state to the dragged chip
  var root = document.getElementById('social-view');
  var chipEl = root && root.querySelector('.soc-calendar-chip--draggable[data-post-id="' + postId + '"]');
  if (chipEl) chipEl.classList.add('soc-reschedule-loading');

  // Find the post to preserve its original time
  var originalTime = '12:00:00';
  Object.keys(_socCalendarPostsByDay).forEach(function (dayKey) {
    (_socCalendarPostsByDay[dayKey] || []).forEach(function (post) {
      if (String(post.id) === String(postId)) {
        var schedStr = post.scheduled_at || post.created_at || '';
        if (schedStr && schedStr.length > 10) {
          var d = new Date(schedStr);
          var h = String(d.getHours()).padStart(2, '0');
          var m = String(d.getMinutes()).padStart(2, '0');
          var s = String(d.getSeconds()).padStart(2, '0');
          originalTime = h + ':' + m + ':' + s;
        }
      }
    });
  });

  var newScheduledAt = newDateStr + 'T' + originalTime;

  social.reschedulePost(postId, newScheduledAt)
    .then(function (result) {
      if (result.success) {
        _socShowToast('Post rescheduled!', 'success');
        _socCalendarRender();
      } else {
        _socShowToast(result.error || 'Failed to reschedule', 'error');
      }
    })
    .catch(function () { _socShowToast('Failed to reschedule', 'error'); })
    .finally(function () {
      if (chipEl) chipEl.classList.remove('soc-reschedule-loading');
    });
}

function _socCalendarCloseSidebar() {
  const root = document.getElementById('social-view');
  if (!root) return;
  const sidebar = root.querySelector('#soc-calendar-sidebar');
  if (sidebar) sidebar.classList.remove('open');
  const grid = root.querySelector('#soc-calendar-grid');
  if (grid) grid.querySelectorAll('.soc-calendar-cell').forEach(c => c.classList.remove('soc-calendar-cell-selected'));
}

// ─── Calendar: Shared fetch helper ────────────────────────────────────────

function _socCalendarFetchRange(rangeStart, rangeEnd, callback) {
  var social = _socAPI();
  if (!social) { callback({}); return; }
  social.getCalendarPosts(rangeStart, rangeEnd)
    .then(function (posts) {
      var byDay = {};
      (posts || []).forEach(function (post) {
        var dateKey = (post.scheduled_at || post.created_at || '').substring(0, 10);
        if (!dateKey) return;
        if (!byDay[dateKey]) byDay[dateKey] = [];
        byDay[dateKey].push(post);
      });
      _socCalendarPostsByDay = byDay;
      callback(byDay);
    })
    .catch(function (err) {
      console.error('[Social] Calendar fetch failed:', err);
      _socCalendarPostsByDay = {};
      callback({});
    });
}

// ─── Calendar: Week View ──────────────────────────────────────────────────

function _socRenderWeekView(startDate) {
  var root = document.getElementById('social-view');
  if (!root) return;
  var container = root.querySelector('#soc-calendar-week-view');
  if (!container) return;

  _socCalendarUpdateLabel();

  // Build 7 days starting from startDate (Mon)
  var days = [];
  for (var i = 0; i < 7; i++) {
    var d = new Date(startDate);
    d.setDate(d.getDate() + i);
    days.push(d);
  }

  var rangeStart = _socCalendarDateStr(days[0]);
  var rangeEnd   = _socCalendarDateStr(days[6]);

  container.innerHTML = '<div class="soc-calendar-loading">Loading posts…</div>';

  _socCalendarFetchRange(rangeStart, rangeEnd, function (byDay) {
    var todayStr = _socCalendarDateStr(new Date());
    var dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    var html = '<div class="soc-week-grid">';

    for (var i = 0; i < 7; i++) {
      var date = days[i];
      var dateStr = _socCalendarDateStr(date);
      var isToday = dateStr === todayStr;
      var dayPosts = byDay[dateStr] || [];

      html += '<div class="soc-week-column' + (isToday ? ' soc-week-column-today' : '') + '" data-date="' + dateStr + '">';
      html += '<div class="soc-week-day-header">';
      html += '<span class="soc-week-day-name">' + dayNames[date.getDay()] + '</span>';
      html += '<span class="soc-week-day-num' + (isToday ? ' soc-week-day-num-today' : '') + '">' + date.getDate() + '</span>';
      html += '</div>';
      html += '<div class="soc-week-day-posts">';

      if (dayPosts.length === 0) {
        html += '<div class="soc-week-empty">No posts</div>';
      } else {
        dayPosts.forEach(function (post) {
          var platform = (post.platform || '').toLowerCase();
          var color = _socCalendarPlatformColors[platform] || 'var(--text-secondary)';
          var time = '';
          var schedStr = post.scheduled_at || post.created_at || '';
          if (schedStr && schedStr.length > 10) {
            var dt = new Date(schedStr);
            var h = dt.getHours();
            var m = String(dt.getMinutes()).padStart(2, '0');
            var ampm = h >= 12 ? 'PM' : 'AM';
            time = (h % 12 || 12) + ':' + m + ' ' + ampm;
          }
          var content = post.title || post.body || post.content || 'Untitled';
          var preview = content.length > 60 ? _socEscapeHtml(content.substring(0, 60)) + '…' : _socEscapeHtml(content);

          html +=
            '<div class="soc-week-card" style="border-left-color:' + color + '">' +
              '<div class="soc-week-card-header">' +
                _socMakePlatformBadge(post.platform || 'unknown') +
                ' ' + _socMakeStatusBadge(post.status) +
              '</div>' +
              (time ? '<div class="soc-week-card-time">' + time + '</div>' : '') +
              '<div class="soc-week-card-content">' + preview + '</div>' +
            '</div>';
        });
      }

      html += '</div></div>';
    }

    html += '</div>';
    container.innerHTML = html;
  });
}

// ─── Calendar: Agenda View ────────────────────────────────────────────────

function _socAgendaDateLabel(dateStr, todayStr) {
  var today = new Date(todayStr + 'T00:00:00');
  var tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  var tomorrowStr = _socCalendarDateStr(tomorrow);
  if (dateStr === todayStr) return 'Today';
  if (dateStr === tomorrowStr) return 'Tomorrow';
  var d = new Date(dateStr + 'T00:00:00');
  var dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  var monthNames = ['January','February','March','April','May','June',
    'July','August','September','October','November','December'];
  return dayNames[d.getDay()] + ', ' + monthNames[d.getMonth()] + ' ' + d.getDate();
}

function _socAgendaPlatformIcon(platform) {
  var p = (platform || '').toLowerCase();
  var color = _socCalendarPlatformColors[p] || 'var(--text-secondary)';
  var label = (p === 'twitter' || p === 'x') ? 'X' : p.charAt(0).toUpperCase();
  return '<span class="soc-agenda-platform-icon" style="background:' + color + '" title="' + _socEscapeHtml(platform || '') + '">' + label + '</span>';
}

function _socAgendaStatusBadge(status) {
  var s = (status || 'draft').toLowerCase();
  var cls = 'soc-agenda-status-badge soc-agenda-status-' + s;
  var label = s.charAt(0).toUpperCase() + s.slice(1);
  return '<span class="' + cls + '">' + label + '</span>';
}

function _socRenderAgendaView() {
  var root = document.getElementById('social-view');
  if (!root) return;
  var container = root.querySelector('#soc-calendar-agenda-view');
  if (!container) return;

  _socCalendarUpdateLabel();

  // Fetch the full month range
  var firstDay = new Date(_socCalendarYear, _socCalendarMonth, 1).getDay();
  var startOffset = (firstDay + 6) % 7;
  var startDate = new Date(_socCalendarYear, _socCalendarMonth, 1 - startOffset);
  var endDate = new Date(_socCalendarYear, _socCalendarMonth + 1, 0);
  var endOffset = (7 - ((endDate.getDay() + 6) % 7 + 1)) % 7;
  endDate.setDate(endDate.getDate() + endOffset);

  var rangeStart = _socCalendarDateStr(startDate);
  var rangeEnd   = _socCalendarDateStr(endDate);

  container.innerHTML = '<div class="soc-calendar-loading">Loading posts…</div>';

  _socCalendarFetchRange(rangeStart, rangeEnd, function (byDay) {
    // Collect all posts, sort chronologically
    var allPosts = [];
    Object.keys(byDay).sort().forEach(function (dateStr) {
      byDay[dateStr].forEach(function (post) {
        allPosts.push({ dateStr: dateStr, post: post });
      });
    });

    if (allPosts.length === 0) {
      container.innerHTML = '<div class="soc-agenda-empty">No posts scheduled this month</div>';
      return;
    }

    allPosts.sort(function (a, b) {
      var aTime = a.post.scheduled_at || a.post.created_at || '';
      var bTime = b.post.scheduled_at || b.post.created_at || '';
      return aTime.localeCompare(bTime);
    });

    // Group by date with counts
    var todayStr = _socCalendarDateStr(new Date());
    var grouped = {};
    var groupOrder = [];
    allPosts.forEach(function (entry) {
      if (!grouped[entry.dateStr]) {
        grouped[entry.dateStr] = [];
        groupOrder.push(entry.dateStr);
      }
      grouped[entry.dateStr].push(entry.post);
    });

    var html = '';

    groupOrder.forEach(function (dateStr) {
      var posts = grouped[dateStr];
      var label = _socAgendaDateLabel(dateStr, todayStr);
      var isToday = dateStr === todayStr;
      var countLabel = posts.length === 1 ? '1 post' : posts.length + ' posts';

      html += '<div class="soc-agenda-day-header' + (isToday ? ' soc-agenda-day-header-today' : '') + '">' +
        '<span class="soc-agenda-day-label">' + label + '</span>' +
        '<span class="soc-agenda-day-count">' + countLabel + '</span>' +
      '</div>';

      posts.forEach(function (post) {
        var time = '';
        var schedStr = post.scheduled_at || post.created_at || '';
        if (schedStr && schedStr.length > 10) {
          var dt = new Date(schedStr);
          var h = dt.getHours();
          var m = String(dt.getMinutes()).padStart(2, '0');
          var ampm = h >= 12 ? 'PM' : 'AM';
          time = (h % 12 || 12) + ':' + m + ' ' + ampm;
        }
        var content = post.title || post.body || post.content || 'Untitled';
        var preview = content.length > 100 ? _socEscapeHtml(content.substring(0, 100)) + '…' : _socEscapeHtml(content);

        // Thumbnail: use media_url if available, else show emoji
        var thumb = '';
        if (post.media_url) {
          thumb = '<img class="soc-agenda-post-thumb" src="' + _socEscapeHtml(post.media_url) + '" alt="" />';
        } else {
          var emoji = (post.content_type === 'video' || (post.media_type || '').includes('video')) ? '🎬' : '📝';
          thumb = '<span class="soc-agenda-post-thumb soc-agenda-post-thumb-emoji">' + emoji + '</span>';
        }

        // Platform icons as overlapping circles
        var platforms = (post.platforms || [post.platform]).filter(Boolean);
        var iconsHtml = '<div class="soc-agenda-platform-icons">';
        platforms.forEach(function (pl) { iconsHtml += _socAgendaPlatformIcon(pl); });
        iconsHtml += '</div>';

        html +=
          '<div class="soc-agenda-post">' +
            thumb +
            '<div class="soc-agenda-post-body">' +
              '<div class="soc-agenda-post-content">' + preview + '</div>' +
              '<div class="soc-agenda-post-meta">' +
                iconsHtml +
                '<span class="soc-agenda-post-time">' + (time || '—') + '</span>' +
              '</div>' +
              _socAgendaStatusBadge(post.status) +
            '</div>' +
          '</div>';
      });
    });

    container.innerHTML = html;
  });
}

// ─── Gallery Tab — delegated to gallery-panel.js ─────────────────────────

// Gallery functions (stats, filters, select mode) moved to gallery-panel.js

// ─── Accounts Modal ───────────────────────────────────────────────────────

// eslint-disable-next-line no-unused-vars
function _socOpenAccountsModal() {
  var modal = document.getElementById('soc-accounts-modal');
  if (!modal) return;
  modal.style.display = '';
  _socLoadAccounts();
  _socLoadBrand();
}

// eslint-disable-next-line no-unused-vars
function _socCloseAccountsModal() {
  var modal = document.getElementById('soc-accounts-modal');
  if (modal) modal.style.display = 'none';
}

// ─── Accounts & Brand ──────────────────────────────────────────────────────

function _socLoadAccounts() {
  const social = _socAPI();
  const root   = document.getElementById('social-view');
  const list   = root && root.querySelector('#soc-accounts-list');
  if (!list) return;

  if (!social) { list.innerHTML = '<div class="soc-empty"><p>Social API unavailable</p></div>'; return; }

  social.listAccounts()
    .then(accounts => {
      if (!accounts || accounts.length === 0) {
        list.innerHTML =
          '<div class="soc-empty" style="padding:20px"><p>No connected accounts</p><p class="hint">Add a social media account to get started</p></div>';
        return;
      }
      list.innerHTML = accounts.map(acc => {
        const hasCreds = !!acc.hasCredentials;
        const statusDot  = hasCreds
          ? '<span class="soc-account-status connected" title="Has credentials">●</span>'
          : '<span class="soc-account-status no-creds" title="No credentials">●</span>';
        const statusText = hasCreds
          ? '<span class="soc-cred-label connected">Connected</span>'
          : '<span class="soc-cred-label no-creds">No credentials</span>';
        return (
          '<div class="soc-account-row" data-id="' + acc.id + '">' +
            _socMakePlatformBadge(acc.platform) +
            '<div class="soc-account-info">' +
              '<div class="soc-account-name">' + _socEscapeHtml(acc.display_name || acc.account_name) + '</div>' +
              '<div class="soc-account-handle">@' + _socEscapeHtml(acc.account_name) + '</div>' +
            '</div>' +
            '<div class="soc-account-cred-status">' + statusDot + statusText + '</div>' +
            '<button class="soc-icon-btn" onclick="socPanelActions.editAccount(\'' + acc.id + '\')" title="Edit">' +
              '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="m15.214 5.982l1.402-1.401a1.982 1.982 0 0 1 2.803 2.803l-1.401 1.402m-2.804-2.804L6.98 14.216c-1.045 1.046-1.568 1.568-1.924 2.205S4.342 18.561 4 20c1.438-.342 2.942-.7 3.579-1.056s1.16-.879 2.205-1.924l8.234-8.234m-2.804-2.804l2.804 2.804"/></svg>' +
            '</button>' +
            '<button class="soc-btn soc-btn-sm soc-btn-danger" onclick="socPanelActions.removeAccount(\'' + acc.id + '\')">Remove</button>' +
          '</div>'
        );
      }).join('');
    })
    .catch(err => {
      console.error('[Social] Failed to load accounts:', err);
      list.innerHTML = '<div class="soc-empty"><p>Failed to load accounts</p></div>';
    });
}

function _socLoadBrand() {
  const social = _socAPI();
  const root   = document.getElementById('social-view');
  if (!social || !root) return;

  social.getBrand()
    .then(brand => {
      if (!brand) return;
      const fields = ['name', 'voice', 'tone', 'target_audience', 'themes', 'hashtags', 'posting_guidelines', 'visual_style', 'dos', 'donts', 'example_posts'];
      fields.forEach(field => {
        const el = root.querySelector('#soc-brand-' + field.replace(/_/g, '-'));
        if (el && brand[field]) el.value = brand[field];
      });
    })
    .catch(err => console.error('[Social] Failed to load brand:', err));
}

// ─── Lightbox Navigation Helper ─────────────────────────────────────────────

// Lightbox functions moved to gallery-panel.js

// ─── Global Actions (callable from inline onclick) ─────────────────────────

window.socPanelActions = {
  copyImageUrl(url) { galActions.copyImageUrl(url); },

  saveDiscovered(id) {
    const social = _socAPI();
    if (!social) { _socShowToast('Social API unavailable', 'error'); return; }

    // Disable all save buttons for this item to prevent double-clicks
    var root = document.getElementById('social-view');
    var saveBtns = root ? root.querySelectorAll('button[onclick*="saveDiscovered(\\\'' + id + '\\\')"]') : [];
    saveBtns.forEach(function (b) { b.disabled = true; });

    // Look up the raw search result from cache
    const item = _socDiscoverSearchCache && _socDiscoverSearchCache[id];
    if (!item) {
      // Already a DB item (from getDiscovered), nothing to save
      saveBtns.forEach(function (b) { b.disabled = false; });
      _socShowToast('Content already saved', 'success');
      return;
    }

    // Map ContentResult → CreateDiscoveredContentInput
    const payload = {
      platform:     item.platform || 'unknown',
      content_type: 'post',
      source_url:   item.url || null,
      source_author: item.creatorUsername || null,
      title:        item.title || null,
      body:         item.caption || null,
      likes:        item.likes || 0,
      comments:     item.comments || 0,
      shares:       item.shares || 0,
      views:        item.views || 0,
    };

    social.saveDiscovered(payload)
      .then(result => {
        if (result.success) {
          _socSavedCache = null; // invalidate so Saved tab reloads from DB
          _socShowActionToast('Saved to library', 'success', 'View \u2192', function() {
            var root = document.getElementById('social-view');
            if (!root) return;
            root.querySelectorAll('.soc-discover-sub-tab').forEach(function(t) { t.classList.remove('active'); });
            root.querySelectorAll('.soc-discover-view').forEach(function(v) { v.classList.remove('active'); });
            var savedBtn = root.querySelector('.soc-discover-sub-tab[data-discover-view="saved"]');
            var savedView = root.querySelector('#soc-discover-view-saved');
            if (savedBtn) savedBtn.classList.add('active');
            if (savedView) savedView.classList.add('active');
            _socLoadSaved();
          });
        } else {
          _socShowToast(result.error || 'Failed to save content', 'error');
        }
      })
      .catch(err => {
        console.error('[Social] Save discovered failed:', err);
        _socShowToast('Failed to save content', 'error');
      })
      .finally(function () {
        saveBtns.forEach(function (b) { b.disabled = false; });
      });
  },

  deleteSaved(id) {
    const social = _socAPI();
    if (!social || !confirm('Remove this saved content?')) return;
    social.deleteDiscovered(id)
      .then(result => {
        if (result.success) {
          // Remove from cache & re-render
          if (_socSavedCache) {
            _socSavedCache = _socSavedCache.filter(i => i.id !== id);
          }
          _socRenderSavedResults();
          _socShowToast('Content removed', 'success');
        } else {
          _socShowToast(result.error || 'Failed to remove', 'error');
        }
      })
      .catch(() => _socShowToast('Failed to remove', 'error'));
  },

  dismissTrend(id) {
    const social = _socAPI();
    if (!social || !id) return;
    social.dismissTrend(id)
      .then(function () {
        if (_socTrendsCache) {
          _socTrendsCache = _socTrendsCache.filter(function (t) { return t.id !== id; });
        }
        _socRenderTrends(_socTrendsCache || []);
        _socShowToast('Trend dismissed', 'success');
      })
      .catch(function () { _socShowToast('Failed to dismiss trend', 'error'); });
  },

  createFromTrend(btn) {
    const card = btn.closest('.soc-trend-card');
    if (!card) return;

    const topicEl = card.querySelector('.soc-trend-card__topic');
    const topic = topicEl ? topicEl.textContent.trim() : '';
    const platformEl = card.querySelector('.soc-trend-platform');
    const platform = platformEl ? platformEl.textContent.trim() : '';
    const keywordSpans = card.querySelectorAll('.soc-trend-keyword');
    var keywords = [];
    keywordSpans.forEach(function (sp) { keywords.push(sp.textContent.trim()); });

    const root = document.getElementById('social-view');
    if (!root) return;

    // Switch to Create tab
    const createTabBtn = root.querySelector('.soc-tab-btn[data-tab="create"]');
    if (createTabBtn) createTabBtn.click();

    // Switch to Generate sub-tab
    const generateSubTab = root.querySelector('.soc-sub-tab[data-panel="generate"]');
    if (generateSubTab) generateSubTab.click();

    // Pre-fill prompt
    const promptEl = root.querySelector('#soc-create-prompt');
    if (promptEl) {
      var promptText = 'Create a ' + platform + ' post about: ' + topic;
      if (keywords.length) promptText += '. Keywords: ' + keywords.join(', ');
      promptEl.value = promptText;
      promptEl.focus();
    }

    // Set platform dropdown
    const platformSelect = root.querySelector('#soc-create-platform');
    if (platformSelect) {
      var val = platform.toLowerCase();
      for (var i = 0; i < platformSelect.options.length; i++) {
        if (platformSelect.options[i].value.toLowerCase() === val) {
          platformSelect.value = platformSelect.options[i].value;
          break;
        }
      }
    }
  },

  openSavedUrl(url) {
    if (url && window.neonPost && window.neonPost.app) {
      window.neonPost.app.openExternal(url);
    }
  },

  deletePost(id) {
    var social = _socAPI();
    if (!social || !confirm('Delete this post?')) return;
    social.deletePost(id)
      .then(function (result) {
        if (result.success) {
          var row = document.querySelector('#social-view tr[data-id="' + id + '"]');
          if (row) row.remove();
          _socShowToast('Post removed', 'success');
          _socLoadPosts();
        } else {
          _socShowToast(result.error || 'Failed to delete', 'error');
        }
      })
      .catch(function () { _socShowToast('Failed to delete post', 'error'); });
  },

  calendarQuickScheduleToggle() {
    var form = document.getElementById('soc-calendar-quick-form');
    if (!form) return;
    form.style.display = form.style.display === 'none' ? 'block' : 'none';
  },

  calendarQuickScheduleSave() {
    var social = _socAPI();
    if (!social) { _socShowToast('Social API unavailable', 'error'); return; }
    var sidebar = document.getElementById('soc-calendar-sidebar');
    var dateStr = sidebar ? sidebar.dataset.selectedDate : '';
    if (!dateStr) return;

    var platform = (document.getElementById('soc-calendar-quick-platform') || {}).value || 'tiktok';
    var content  = (document.getElementById('soc-calendar-quick-content') || {}).value || '';
    var time     = (document.getElementById('soc-calendar-quick-time') || {}).value || '12:00';

    if (!content.trim()) { _socShowToast('Write some content first', 'error'); return; }

    var scheduledAt = dateStr + 'T' + time + ':00';

    social.createPost({ platform: platform, content: content.trim(), status: 'scheduled', scheduled_at: scheduledAt })
      .then(function (result) {
        if (result.success) {
          _socShowToast('Post scheduled!', 'success');
          var form = document.getElementById('soc-calendar-quick-form');
          if (form) form.style.display = 'none';
          var ta = document.getElementById('soc-calendar-quick-content');
          if (ta) ta.value = '';
          _socCalendarRender();
        } else {
          _socShowToast(result.error || 'Failed to schedule', 'error');
        }
      })
      .catch(function () { _socShowToast('Failed to schedule post', 'error'); });
  },

  calendarReschedule(postId) {
    var picker = document.getElementById('soc-calendar-reschedule-' + postId);
    if (!picker) return;
    picker.style.display = picker.style.display === 'none' ? 'block' : 'none';
  },

  calendarRescheduleCancel(postId) {
    var picker = document.getElementById('soc-calendar-reschedule-' + postId);
    if (picker) picker.style.display = 'none';
  },

  calendarRescheduleSave(postId, dateStr) {
    var social = _socAPI();
    if (!social) { _socShowToast('Social API unavailable', 'error'); return; }
    var picker = document.getElementById('soc-calendar-reschedule-' + postId);
    if (!picker) return;
    var input = picker.querySelector('.soc-calendar-reschedule-input');
    if (!input || !input.value) { _socShowToast('Pick a new date/time', 'error'); return; }

    social.reschedulePost(postId, input.value)
      .then(function (result) {
        if (result.success) {
          _socShowToast('Post rescheduled!', 'success');
          _socCalendarRender();
        } else {
          _socShowToast(result.error || 'Failed to reschedule', 'error');
        }
      })
      .catch(function () { _socShowToast('Failed to reschedule', 'error'); });
  },

  calendarDeletePost(postId, dateStr) {
    var social = _socAPI();
    if (!social || !confirm('Delete this post?')) return;
    social.deletePost(postId)
      .then(function (result) {
        if (result.success) {
          _socShowToast('Post deleted', 'success');
          _socCalendarRender();
        } else {
          _socShowToast(result.error || 'Failed to delete', 'error');
        }
      })
      .catch(function () { _socShowToast('Failed to delete post', 'error'); });
  },

  // Gallery actions delegated to galActions (gallery-panel.js)
  deleteGenerated(id) { galActions.deleteGenerated(id); },
  toggleSelectItem(id) { galActions.toggleSelectItem(id); },
  toggleFavorite(id, rating) { galActions.toggleFavorite(id, rating); },

  editAccount(id) {
    const social = _socAPI();
    const root   = document.getElementById('social-view');
    if (!social || !root) return;

    const getAccount = social.getAccount
      ? social.getAccount(id)
      : social.listAccounts().then(list => (list || []).find(a => a.id === id));

    getAccount
      .then(acc => {
        if (!acc) { _socShowToast('Account not found', 'error'); return; }

        _socEditingAccountId = id;

        // Populate form
        const platformSel = root.querySelector('#soc-account-platform');
        const usernameEl  = root.querySelector('#soc-account-username');
        const displayEl   = root.querySelector('#soc-account-display');
        const titleEl     = root.querySelector('#soc-account-form-title');
        const saveBtn     = root.querySelector('#soc-account-save-btn');
        const cancelBtn   = root.querySelector('#soc-account-cancel-btn');

        if (platformSel) { platformSel.value = acc.platform || 'tiktok'; _socTogglePlatformFields(root, platformSel.value); }
        if (usernameEl)  usernameEl.value  = acc.account_name || '';
        if (displayEl)   displayEl.value   = acc.display_name || '';
        if (titleEl)     titleEl.textContent  = 'Edit Account';
        if (saveBtn)     saveBtn.textContent  = 'Save Changes';
        if (cancelBtn)   cancelBtn.style.display = '';

        // Populate credential fields from metadata if available
        if (acc.metadata) {
          try {
            const meta = typeof acc.metadata === 'string' ? JSON.parse(acc.metadata) : acc.metadata;
            const setVal = (sel, val) => { const el = root.querySelector(sel); if (el && val) el.value = val; };
            setVal('#soc-account-access-token', meta.accessToken);
            setVal('#soc-account-consumer-key', meta.consumerKey);
            setVal('#soc-account-consumer-secret', meta.consumerSecret);
            setVal('#soc-account-access-token-secret', meta.accessTokenSecret);
            setVal('#soc-account-page-id', meta.pageId);
            setVal('#soc-account-ig-id', meta.instagramAccountId);
            setVal('#soc-account-client-id', meta.clientId);
            setVal('#soc-account-client-secret', meta.clientSecret);
          } catch (e) { /* ignore parse errors */ }
        }

        // Scroll the form into view
        const formEl = root.querySelector('#soc-account-form');
        if (formEl) formEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      })
      .catch(err => {
        console.error('[Social] Failed to load account for edit:', err);
        _socShowToast('Failed to load account', 'error');
      });
  },

  removeAccount(id) {
    const social = _socAPI();
    if (!social || !confirm('Remove this account?')) return;
    social.removeAccount(id)
      .then(result => {
        if (result.success) {
          _socLoadAccounts();
          _socShowToast('Account removed', 'success');
        } else {
          _socShowToast('Failed to remove', 'error');
        }
      })
      .catch(() => _socShowToast('Failed to remove', 'error'));
  },

  downloadImage(id) { galActions.downloadImage(id); },
  openLightbox(id) { galActions.openLightbox(id); },

  // ── Draft actions ──

  draftSchedule(id) {
    _socScheduleModalDraftId = id;
    _socScheduleModalMode = 'schedule';
    _socOpenScheduleModal(id);
  },

  draftConfirmSchedule(id) {
    // Legacy inline confirm — redirect to modal
    _socScheduleModalDraftId = id;
    _socScheduleModalMode = 'schedule';
    _socOpenScheduleModal(id);
  },

  draftCopy(id) {
    var draft = _socDraftsCache && _socDraftsCache.find(function (d) { return d.id === id; });
    if (!draft) return;
    navigator.clipboard.writeText(draft.content || '').then(function () {
      _socShowToast('Copied to clipboard!', 'success');
    }).catch(function() { _socShowToast('Copy failed — check permissions', 'error'); });
  },

  draftDelete(id) {
    var social = _socAPI();
    if (!social || !confirm('Delete this draft?')) return;
    social.deleteDraft(id)
      .then(function (res) {
        if (res.success) {
          _socShowToast('Draft deleted', 'success');
          if (_socDraftsCache) {
            _socDraftsCache = _socDraftsCache.filter(function (d) { return d.id !== id; });
          }
          _socRenderDraftsList(_socDraftsCache || []);
        } else {
          _socShowToast(res.error || 'Delete failed', 'error');
        }
      })
      .catch(function () { _socShowToast('Delete failed', 'error'); });
  },

  // ── Saved card: Create Post inline form ──

  createFromSaved(id) {
    var formEl = document.getElementById('soc-card-create-' + id);
    if (!formEl) return;
    // Toggle visibility
    var isVisible = formEl.style.display !== 'none';
    // Close any other open create forms first
    document.querySelectorAll('.soc-card-create-form').forEach(function (f) {
      f.style.display = 'none';
    });
    formEl.style.display = isVisible ? 'none' : '';
  },

  pickVideoForCreate(id) {
    var social = _socAPI();
    if (!social) return;
    social.pickVideoFile().then(function (result) {
      if (!result.success) return;
      var formEl = document.getElementById('soc-card-create-' + id);
      if (!formEl) return;
      formEl.dataset.videoPath = result.filePath;
      var nameEl = formEl.querySelector('.soc-card-create-form__video-name');
      if (nameEl) nameEl.textContent = result.fileName || result.filePath.split(/[\\/]/).pop();
      _socShowToast('Video selected', 'success');
    });
  },

  generateFromSaved(id, btn) {
    var social = _socAPI();
    if (!social) { _socShowToast('Social API unavailable', 'error'); return; }

    var formEl = document.getElementById('soc-card-create-' + id);
    if (!formEl) return;

    // Gather selected platforms
    var platforms = [];
    formEl.querySelectorAll('input[type="checkbox"]:checked').forEach(function (cb) {
      platforms.push(cb.value);
    });
    if (platforms.length === 0) {
      _socShowToast('Select at least one platform', 'error');
      return;
    }

    var videoPath = formEl.dataset.videoPath || '';
    btn.disabled = true;
    btn.textContent = 'Generating…';

    if (videoPath) {
      // Video flow: coldUpload with source linkage
      social.coldUpload(videoPath, platforms[0]).then(function (res) {
        if (res.success) {
          // Now generate repurpose drafts for remaining platforms linked to source
          if (platforms.length > 1) {
            social.generateContent({
              content_type: 'repurpose',
              source_content_id: id,
              target_platforms: platforms.slice(1),
            }).then(function () {
              _socShowToast('Drafts created from video!', 'success');
              _socLoadDrafts();
              formEl.style.display = 'none';
            }).catch(function () {
              _socShowToast('Video draft created, but extra platforms failed', 'error');
              _socLoadDrafts();
            });
          } else {
            _socShowToast('Draft created from video!', 'success');
            _socLoadDrafts();
            formEl.style.display = 'none';
          }
        } else {
          _socShowToast(res.error || 'Video upload failed', 'error');
        }
      }).catch(function () {
        _socShowToast('Video processing error', 'error');
      }).finally(function () {
        btn.disabled = false;
        btn.textContent = 'Generate';
      });
    } else {
      // Standard repurpose flow
      social.generateContent({
        content_type: 'repurpose',
        source_content_id: id,
        target_platforms: platforms,
      }).then(function (result) {
        if (result.success) {
          _socShowToast('Drafts created!', 'success');
          _socLoadDrafts();
          formEl.style.display = 'none';
          // Re-render saved to show "View Drafts" button
          _socRenderSavedResults();
        } else {
          _socShowToast(result.error || 'Generation failed', 'error');
        }
      }).catch(function () {
        _socShowToast('Generation error', 'error');
      }).finally(function () {
        btn.disabled = false;
        btn.textContent = 'Generate';
      });
    }
  },

  viewDraftsForSource(sourceId) {
    // Navigate to Create tab (drafts live there now)
    navigateToSocialTab('create');

    // Load drafts and filter by source_content_id
    var social = _socAPI();
    if (!social) return;
    social.getDrafts().then(function (drafts) {
      var filtered = (drafts || []).filter(function (d) { return d.source_content_id === sourceId; });
      _socDraftsCache = filtered;
      _socRenderDraftsList(filtered);
      if (filtered.length === 0) {
        _socShowToast('No drafts found for this content', 'info');
      } else {
        _socShowToast('Showing ' + filtered.length + ' draft(s) from this content', 'success');
      }
    }).catch(function () {
      _socShowToast('Failed to load drafts', 'error');
    });
  },

  onSessionChanged() {
    _socBubbleUpdateSession();
  },
};

// ══════════════════════════════════════════════════════════════════════
// PREVIEW TAB — Platform Mockup Renderers
// ══════════════════════════════════════════════════════════════════════

function _socFormatCount(n) {
  if (!n || n <= 0) return '0';
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return n.toString();
}

function _socEscHtml(s) {
  var d = document.createElement('div');
  d.textContent = s || '';
  return d.innerHTML;
}

function _socMediaHtml(imageUrl, fallbackEmoji) {
  if (imageUrl) return '<img src="' + _socEscHtml(imageUrl) + '" alt="media">';
  return fallbackEmoji || '📷';
}

function _socRenderIGMockup(el, data) {
  var user = _socEscHtml(data.username || 'youraccount');
  var initials = (data.username || 'YA').slice(0, 2).toUpperCase();
  var caption = _socEscHtml(data.caption || '');
  var img = data.imageUrl;

  el.innerHTML =
    '<div class="mockup-header">' +
      '<div class="mockup-avatar"><div class="mockup-avatar-inner">' +
        (data.avatarUrl ? '<img src="' + _socEscHtml(data.avatarUrl) + '">' : '<div class="mockup-avatar-fallback">' + initials + '</div>') +
      '</div></div>' +
      '<span class="mockup-username">' + user + '</span>' +
      '<span class="mockup-more">•••</span>' +
    '</div>' +
    '<div class="mockup-media">' + _socMediaHtml(img, '📷') + '</div>' +
    '<div class="mockup-actions">' +
      '<div class="mockup-actions-left">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"/></svg>' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/></svg>' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="transform:rotate(-45deg)"><path stroke-linecap="round" stroke-linejoin="round" d="M12 19V5m0 0l-7 7m7-7l7 7"/></svg>' +
      '</div>' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"/></svg>' +
    '</div>' +
    (data.likes ? '<div class="mockup-likes">' + _socFormatCount(data.likes) + ' likes</div>' : '') +
    '<div class="mockup-caption-area"><div class="mockup-caption"><strong>' + user + '</strong> ' + caption + '</div></div>' +
    '<div class="mockup-timestamp">Just now</div>';
}

function _socRenderTTMockup(el, data) {
  var user = _socEscHtml(data.username || 'creator');
  var caption = _socEscHtml(data.caption || '');
  var img = data.imageUrl;
  var initial = (data.username || 'C').slice(0, 1).toUpperCase();

  el.innerHTML =
    '<div class="mockup-media">' + _socMediaHtml(img, '🎬') + '</div>' +
    '<div class="mockup-gradient"></div>' +
    '<div class="mockup-sidebar">' +
      '<div class="mockup-sidebar-avatar">' +
        (data.avatarUrl ? '<img src="' + _socEscHtml(data.avatarUrl) + '">' : initial) +
        '<div class="mockup-follow-badge">+</div>' +
      '</div>' +
      '<div class="mockup-sidebar-item"><svg viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg><span class="mockup-sidebar-count">' + _socFormatCount(data.likes) + '</span></div>' +
      '<div class="mockup-sidebar-item"><svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg><span class="mockup-sidebar-count">' + _socFormatCount(data.comments) + '</span></div>' +
      '<div class="mockup-sidebar-item"><svg viewBox="0 0 24 24"><path d="M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z"/></svg><span class="mockup-sidebar-count">' + _socFormatCount(data.shares) + '</span></div>' +
      '<div class="mockup-disc"><div class="mockup-disc-inner"></div></div>' +
    '</div>' +
    '<div class="mockup-bottom">' +
      '<div class="mockup-tt-user">@' + user + '</div>' +
      (caption ? '<div class="mockup-tt-caption">' + caption + '</div>' : '') +
      '<div class="mockup-tt-music"><svg viewBox="0 0 24 24" width="14" height="14" fill="#fff"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg><span class="mockup-tt-music-text">Original Sound · Original Sound</span></div>' +
    '</div>' +
    '<div class="mockup-progress"><div class="mockup-progress-fill"></div></div>';
}

function _socRenderTWMockup(el, data) {
  var user = _socEscHtml(data.username || 'user');
  var caption = _socEscHtml(data.caption || '');
  var img = data.imageUrl;
  var initial = (data.username || 'U').slice(0, 2).toUpperCase();

  el.innerHTML =
    '<div class="mockup-header">' +
      '<div class="mockup-avatar">' +
        (data.avatarUrl ? '<img src="' + _socEscHtml(data.avatarUrl) + '">' : '<span class="mockup-avatar-fallback">' + initial + '</span>') +
      '</div>' +
      '<div style="flex:1">' +
        '<div class="mockup-tw-names">' +
          '<span class="mockup-tw-displayname">' + user + '</span>' +
          '<span class="mockup-tw-handle">@' + user.toLowerCase().replace(/\s/g, '') + '</span>' +
          '<span class="mockup-tw-time"> · 1m</span>' +
        '</div>' +
        '<div class="mockup-tw-body">' + caption + '</div>' +
        (img ? '<div class="mockup-tw-media"><img src="' + _socEscHtml(img) + '"></div>' : '') +
        '<div class="mockup-tw-actions">' +
          '<div class="mockup-tw-action"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/></svg>' + _socFormatCount(data.comments) + '</div>' +
          '<div class="mockup-tw-action"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M4 12l2-2m0 0l4 4m-4-4l4-4m8 0l2 2m0 0l-4-4m4 4l-4 4"/></svg>' + _socFormatCount(data.shares) + '</div>' +
          '<div class="mockup-tw-action"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"/></svg>' + _socFormatCount(data.likes) + '</div>' +
          '<div class="mockup-tw-action"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/></svg></div>' +
        '</div>' +
      '</div>' +
    '</div>';
}

function _socRenderFBMockup(el, data) {
  var user = _socEscHtml(data.username || 'Your Page');
  var caption = _socEscHtml(data.caption || '');
  var img = data.imageUrl;
  var initials = (data.username || 'YP').split(' ').map(function(w) { return w[0]; }).join('').slice(0, 2).toUpperCase();

  el.innerHTML =
    '<div class="mockup-header">' +
      '<div class="mockup-avatar">' +
        (data.avatarUrl ? '<img src="' + _socEscHtml(data.avatarUrl) + '">' : initials) +
      '</div>' +
      '<div class="mockup-fb-info">' +
        '<div class="mockup-fb-name">' + user + '</div>' +
        '<div class="mockup-fb-meta"><span>Just now</span><span>·</span><span>🌐</span></div>' +
      '</div>' +
    '</div>' +
    (caption ? '<div class="mockup-fb-caption">' + caption + '</div>' : '') +
    '<div class="mockup-media">' + _socMediaHtml(img, '📷') + '</div>' +
    '<div class="mockup-fb-reactions">' +
      '<div style="display:flex;align-items:center;gap:4px">' +
        '<span class="mockup-fb-reaction-icon" style="background:#1877f2;z-index:3">👍</span>' +
        '<span class="mockup-fb-reaction-icon" style="background:#f33e58;z-index:2">❤️</span>' +
        '<span class="mockup-fb-reaction-icon" style="background:#f7b928;z-index:1">😆</span>' +
        '<span style="margin-left:4px">' + _socFormatCount(data.likes || 0) + '</span>' +
      '</div>' +
      '<div style="display:flex;gap:12px">' +
        (data.comments ? '<span>' + _socFormatCount(data.comments) + ' comments</span>' : '') +
        (data.shares ? '<span>' + _socFormatCount(data.shares) + ' shares</span>' : '') +
      '</div>' +
    '</div>' +
    '<div class="mockup-fb-divider"></div>' +
    '<div class="mockup-fb-actions">' +
      '<div class="mockup-fb-action">👍 Like</div>' +
      '<div class="mockup-fb-action">💬 Comment</div>' +
      '<div class="mockup-fb-action">↗ Share</div>' +
    '</div>';
}

function _socRenderLIMockup(el, data) {
  var user = _socEscHtml(data.username || 'Professional');
  var caption = _socEscHtml(data.caption || '');
  var img = data.imageUrl;
  var initials = (data.username || 'P').split(' ').map(function(w) { return w[0]; }).join('').slice(0, 2).toUpperCase();

  el.innerHTML =
    '<div class="mockup-header">' +
      '<div class="mockup-avatar">' +
        (data.avatarUrl ? '<img src="' + _socEscHtml(data.avatarUrl) + '">' : initials) +
      '</div>' +
      '<div class="mockup-li-info">' +
        '<div class="mockup-li-name">' + user + '</div>' +
        '<div class="mockup-li-headline">Creator & Strategist</div>' +
        '<div class="mockup-li-meta"><span>1m</span><span>·</span><span>🌐</span></div>' +
      '</div>' +
    '</div>' +
    (caption ? '<div class="mockup-li-body">' + caption + '</div>' : '') +
    (img ? '<div class="mockup-media"><img src="' + _socEscHtml(img) + '"></div>' : '') +
    '<div class="mockup-li-engagement">' +
      '<span>👍 ' + _socFormatCount(data.likes || 0) + '</span>' +
      '<span>' + _socFormatCount(data.comments || 0) + ' comments · ' + _socFormatCount(data.shares || 0) + ' reposts</span>' +
    '</div>' +
    '<div class="mockup-li-divider"></div>' +
    '<div class="mockup-li-actions">' +
      '<div class="mockup-li-action"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5"/></svg>Like</div>' +
      '<div class="mockup-li-action"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/></svg>Comment</div>' +
      '<div class="mockup-li-action"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 12l2-2m0 0l4 4m-4-4l4-4m8 0l2 2m0 0l-4-4m4 4l-4 4"/></svg>Repost</div>' +
      '<div class="mockup-li-action"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/></svg>Send</div>' +
    '</div>';
}

// ─── News Sources (article / feed / index URL watchers) ──────────────────

var _socSourcesCache = null;
var _socSourcesPendingCache = {}; // sourceId -> count
var _socSourcesActiveModalId = null;

function _socSourcesAPI() {
  var api = _socAPI();
  return api && api.articleSources ? api.articleSources : null;
}

function _socInitNewsSources(root) {
  var addBtn = root.querySelector('#soc-source-add-btn');
  var urlInput = root.querySelector('#soc-source-url');
  var scheduleSelect = root.querySelector('#soc-source-schedule');
  if (addBtn && urlInput && scheduleSelect) {
    addBtn.addEventListener('click', function () {
      var url = (urlInput.value || '').trim();
      if (!url) { _socShowToast('Paste an article or feed URL', 'error'); return; }
      var schedule = scheduleSelect.value;
      var api = _socSourcesAPI();
      if (!api) { _socShowToast('Social API unavailable', 'error'); return; }
      addBtn.disabled = true;
      addBtn.textContent = 'Adding…';
      api.add(url, schedule)
        .then(function (r) {
          if (r.success) {
            urlInput.value = '';
            _socShowToast('Source added: ' + (r.source.source_name || url), 'success');
            _socSourcesCache = null;
            _socLoadSources();
          } else {
            _socShowToast(r.error || 'Failed to add source', 'error');
          }
        })
        .catch(function (err) {
          console.error('[NewsSources] add failed', err);
          _socShowToast('Failed to add source', 'error');
        })
        .finally(function () {
          addBtn.disabled = false;
          addBtn.textContent = 'Add';
        });
    });
    urlInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); addBtn.click(); }
    });
  }

  var closeBtn = root.querySelector('#soc-source-pending-close');
  var backdrop = root.querySelector('#soc-source-pending-modal-backdrop');
  if (closeBtn) closeBtn.addEventListener('click', _socClosePendingModal);
  if (backdrop) backdrop.addEventListener('click', _socClosePendingModal);

  // Initial load (covers the case where Drafts tab is the default)
  _socLoadSources();
}

function _socLoadSources() {
  var root = document.getElementById('social-view');
  var list = root && root.querySelector('#soc-sources-list');
  if (!list) return;
  var api = _socSourcesAPI();
  if (!api) { list.innerHTML = ''; return; }

  api.list()
    .then(function (r) {
      if (!r.success) { list.innerHTML = ''; return; }
      _socSourcesCache = r.sources || [];
      _socRenderSources(_socSourcesCache);
      _socSourcesCache.forEach(function (s) { _socRefreshPendingCount(s.id); });
    })
    .catch(function (err) {
      console.error('[NewsSources] list failed', err);
      list.innerHTML = '';
    });
}

function _socRenderSources(sources) {
  var root = document.getElementById('social-view');
  var list = root && root.querySelector('#soc-sources-list');
  if (!list) return;
  if (!sources || sources.length === 0) {
    list.innerHTML = '<div class="soc-empty" style="padding:12px"><p class="hint">No news sources yet. Paste a URL above to start watching.</p></div>';
    return;
  }
  list.innerHTML = sources.map(_socSourceChipHtml).join('');
}

function _socSourceChipHtml(s) {
  var statusClass =
    s.last_status === 'error' ? 'error' :
    s.last_status === 'ok' ? 'ok' : 'idle';
  var statusTitle =
    s.last_status === 'error' ? (s.last_error || 'Last scrape failed') :
    s.last_status === 'ok' ? ('Last scrape ok' + (s.last_run_at ? ' · ' + _socFormatRelative(s.last_run_at) : '')) :
    'Never scraped';
  var typeBadge =
    s.source_type === 'feed' ? 'Feed' :
    s.source_type === 'index' ? 'Index' : 'Article';
  var pendingCount = _socSourcesPendingCache[s.id] || 0;
  var pendingBadge = pendingCount > 0
    ? '<button class="soc-source-chip__pending" onclick="socPanelActions.openPendingModal(\'' + s.id + '\')" title="' + pendingCount + ' pending article' + (pendingCount === 1 ? '' : 's') + '">' + pendingCount + ' new</button>'
    : '';
  var scheduleOptions = [
    ['0 * * * *', 'Hourly'],
    ['0 */6 * * *', 'Every 6h'],
    ['0 9 * * *', 'Daily 9am'],
    ['0 9 * * 1', 'Weekly Mon'],
  ].map(function (p) {
    var sel = p[0] === s.schedule_expr ? ' selected' : '';
    return '<option value="' + p[0] + '"' + sel + '>' + p[1] + '</option>';
  }).join('');

  return '<div class="soc-source-chip" data-id="' + s.id + '">' +
    '<span class="soc-source-chip__status ' + statusClass + '" title="' + _socEscapeHtml(statusTitle) + '"></span>' +
    '<div class="soc-source-chip__main">' +
      '<div class="soc-source-chip__name">' + _socEscapeHtml(s.source_name) + '</div>' +
      '<div class="soc-source-chip__url" title="' + _socEscapeHtml(s.url) + '">' + _socEscapeHtml(s.url) + '</div>' +
    '</div>' +
    '<span class="soc-source-chip__badge">' + typeBadge + '</span>' +
    pendingBadge +
    '<select class="soc-source-chip__schedule" onchange="socPanelActions.changeSourceSchedule(\'' + s.id + '\', this.value)">' + scheduleOptions + '</select>' +
    '<label class="soc-source-chip__active" title="Active">' +
      '<input type="checkbox" ' + (s.active ? 'checked' : '') + ' onchange="socPanelActions.toggleSource(\'' + s.id + '\', this.checked)">' +
      '<span>On</span>' +
    '</label>' +
    '<button class="soc-btn soc-btn-sm soc-btn-secondary" onclick="socPanelActions.runSourceNow(\'' + s.id + '\', this)" title="Scrape now">Run now</button>' +
    '<button class="soc-icon-btn danger" onclick="socPanelActions.deleteSource(\'' + s.id + '\')" title="Remove">' +
      '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6"/></svg>' +
    '</button>' +
  '</div>';
}

function _socRefreshPendingCount(sourceId) {
  var api = _socSourcesAPI();
  if (!api) return;
  api.countPending(sourceId)
    .then(function (r) {
      if (r && r.success) {
        var prev = _socSourcesPendingCache[sourceId] || 0;
        _socSourcesPendingCache[sourceId] = r.count;
        if (prev !== r.count && _socSourcesCache) {
          _socRenderSources(_socSourcesCache);
        }
      }
    })
    .catch(function () { /* non-fatal */ });
}

function _socFormatRelative(iso) {
  try {
    var diff = Date.now() - new Date(iso).getTime();
    if (diff < 60_000) return 'just now';
    if (diff < 3600_000) return Math.floor(diff / 60_000) + 'm ago';
    if (diff < 86_400_000) return Math.floor(diff / 3600_000) + 'h ago';
    return Math.floor(diff / 86_400_000) + 'd ago';
  } catch { return ''; }
}

function _socOpenPendingModal(sourceId) {
  var root = document.getElementById('social-view');
  var modal = root && root.querySelector('#soc-source-pending-modal');
  if (!modal) return;
  _socSourcesActiveModalId = sourceId;
  modal.style.display = '';
  var titleEl = root.querySelector('#soc-source-pending-title');
  var src = (_socSourcesCache || []).find(function (s) { return s.id === sourceId; });
  if (titleEl) titleEl.textContent = src ? ('Pending from ' + src.source_name) : 'Pending Articles';
  _socLoadPendingList(sourceId);
}

function _socClosePendingModal() {
  var root = document.getElementById('social-view');
  var modal = root && root.querySelector('#soc-source-pending-modal');
  if (modal) modal.style.display = 'none';
  _socSourcesActiveModalId = null;
}

function _socLoadPendingList(sourceId) {
  var root = document.getElementById('social-view');
  var list = root && root.querySelector('#soc-source-pending-list');
  if (!list) return;
  var api = _socSourcesAPI();
  if (!api) { list.innerHTML = ''; return; }
  list.innerHTML = '<div class="hint" style="padding:12px">Loading…</div>';
  api.listPending(sourceId)
    .then(function (r) {
      if (!r.success) { list.innerHTML = '<div class="hint" style="padding:12px">Failed to load.</div>'; return; }
      var items = r.items || [];
      if (items.length === 0) {
        list.innerHTML = '<div class="hint" style="padding:12px">Nothing pending.</div>';
        return;
      }
      list.innerHTML = items.map(function (it) {
        var excerpt = it.excerpt || (it.text_content || '').slice(0, 240);
        return '<div class="soc-pending-row" data-id="' + it.id + '">' +
          '<div class="soc-pending-row__body">' +
            '<div class="soc-pending-row__title">' + _socEscapeHtml(it.title || it.article_url) + '</div>' +
            '<div class="soc-pending-row__excerpt">' + _socEscapeHtml(excerpt) + '</div>' +
            '<a class="soc-pending-row__link" href="#" onclick="event.preventDefault(); window.neonPost && window.neonPost.shell && window.neonPost.shell.openUrl && window.neonPost.shell.openUrl(\'' + (it.article_url || '').replace(/'/g, '') + '\')">' + _socEscapeHtml(it.article_url || '') + '</a>' +
          '</div>' +
          '<div class="soc-pending-row__actions">' +
            '<button class="soc-btn soc-btn-sm soc-btn-primary" onclick="socPanelActions.goPending(\'' + it.id + '\', this)">Go</button>' +
            '<button class="soc-btn soc-btn-sm soc-btn-secondary" onclick="socPanelActions.skipPending(\'' + it.id + '\')">Skip</button>' +
          '</div>' +
        '</div>';
      }).join('');
    })
    .catch(function (err) {
      console.error('[NewsSources] listPending failed', err);
      list.innerHTML = '<div class="hint" style="padding:12px">Failed to load.</div>';
    });
}

Object.assign(window.socPanelActions, {
  runSourceNow: function (id, btn) {
    var api = _socSourcesAPI();
    if (!api) return;
    if (btn) { btn.disabled = true; btn.textContent = 'Running…'; }
    api.runNow(id)
      .then(function (r) {
        if (r.success) {
          _socShowToast('Scraped ' + r.itemsScraped + ' · queued ' + r.itemsInserted + ' new', 'success');
        } else {
          _socShowToast(r.error || 'Scrape failed', 'error');
        }
        _socSourcesCache = null;
        _socLoadSources();
      })
      .catch(function (err) {
        console.error('[NewsSources] runNow failed', err);
        _socShowToast('Scrape failed', 'error');
      })
      .finally(function () {
        if (btn) { btn.disabled = false; btn.textContent = 'Run now'; }
      });
  },

  deleteSource: function (id) {
    if (!confirm('Delete this news source and its pending articles?')) return;
    var api = _socSourcesAPI();
    if (!api) return;
    api.delete(id)
      .then(function (r) {
        if (r.success) {
          _socShowToast('Source removed', 'success');
          _socSourcesCache = null;
          delete _socSourcesPendingCache[id];
          _socLoadSources();
        } else {
          _socShowToast(r.error || 'Delete failed', 'error');
        }
      });
  },

  toggleSource: function (id, active) {
    var api = _socSourcesAPI();
    if (!api) return;
    api.update(id, { active: !!active })
      .then(function (r) {
        if (!r.success) _socShowToast(r.error || 'Update failed', 'error');
        _socSourcesCache = null;
        _socLoadSources();
      });
  },

  changeSourceSchedule: function (id, scheduleExpr) {
    var api = _socSourcesAPI();
    if (!api) return;
    api.update(id, { schedule_expr: scheduleExpr })
      .then(function (r) {
        if (r.success) {
          _socShowToast('Schedule updated', 'success');
        } else {
          _socShowToast(r.error || 'Update failed', 'error');
        }
        _socSourcesCache = null;
        _socLoadSources();
      });
  },

  openPendingModal: function (id) { _socOpenPendingModal(id); },

  goPending: function (pendingId, btn) {
    var api = _socSourcesAPI();
    if (!api) return;
    var root = document.getElementById('social-view');
    var platformSelect = root && root.querySelector('#soc-source-pending-platform');
    var platform = (platformSelect && platformSelect.value) || 'tiktok';
    if (btn) btn.disabled = true;
    api.goPending(pendingId, platform)
      .then(function (r) {
        if (r.success) {
          _socShowToast('Added to drafts', 'success');
          if (_socSourcesActiveModalId) _socLoadPendingList(_socSourcesActiveModalId);
          if (_socSourcesActiveModalId) _socRefreshPendingCount(_socSourcesActiveModalId);
          _socLoadDrafts();
        } else {
          _socShowToast(r.error || 'Go failed', 'error');
        }
      })
      .finally(function () { if (btn) btn.disabled = false; });
  },

  skipPending: function (pendingId) {
    var api = _socSourcesAPI();
    if (!api) return;
    api.skipPending(pendingId)
      .then(function (r) {
        if (r.success) {
          if (_socSourcesActiveModalId) _socLoadPendingList(_socSourcesActiveModalId);
          if (_socSourcesActiveModalId) _socRefreshPendingCount(_socSourcesActiveModalId);
        } else {
          _socShowToast((r && r.error) || 'Skip failed', 'error');
        }
      });
  },
});

