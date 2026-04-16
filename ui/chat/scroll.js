function showEmptyState() {
  const displayName = agentName || 'Franky';
  messagesDiv.innerHTML = `
    <div class="empty-state">
      <div class="pixel-heart"></div>
      <div class="empty-title">${escapeHtml(displayName)} here!</div>
      <div class="empty-subtitle">ready to go whenever you are, i've got your back ✨</div>
    </div>
  `;
}

async function loadUserProfile() {
  try {
    userName = (await window.neonPost.settings.get('profile.name')) || '';
    agentName = (await window.neonPost.settings.get('personalize.agentName')) || '';
    updateInputPlaceholder();
  } catch (err) {
    console.error('Failed to load user profile:', err);
  }
}

function updateInputPlaceholder() {
  const placeholder = userName
    ? `what's on your mind, ${userName}?`
    : "what's on your mind?";
  input.placeholder = placeholder;
}

function scrollToBottom(instant = false) {
  requestAnimationFrame(() => {
    messagesDiv.scrollTo({
      top: messagesDiv.scrollHeight,
      behavior: instant ? 'instant' : 'smooth'
    });
  });
}

function scrollToTop() {
  requestAnimationFrame(() => {
    messagesDiv.scrollTo({
      top: 0,
      behavior: 'smooth'
    });
  });
}

// Scroll button visibility
const scrollTopBtn = document.getElementById('scroll-top-btn');
const scrollBottomBtn = document.getElementById('scroll-bottom-btn');
const SCROLL_THRESHOLD = 200;

function updateScrollButtons() {
  const scrollTop = messagesDiv.scrollTop;
  const scrollHeight = messagesDiv.scrollHeight;
  const clientHeight = messagesDiv.clientHeight;
  const distanceFromBottom = scrollHeight - scrollTop - clientHeight;

  // Show "scroll to top" when scrolled down past threshold
  if (scrollTop > SCROLL_THRESHOLD) {
    scrollTopBtn.classList.add('visible');
  } else {
    scrollTopBtn.classList.remove('visible');
  }

  // Show "scroll to bottom" when not at bottom
  if (distanceFromBottom > SCROLL_THRESHOLD) {
    scrollBottomBtn.classList.add('visible');
  } else {
    scrollBottomBtn.classList.remove('visible');
  }
}

messagesDiv.addEventListener('scroll', updateScrollButtons);

// Global chat scroll buttons
const gchatMsgsDiv = document.getElementById('global-chat-messages');
const gchatScrollTopBtn = document.getElementById('gchat-scroll-top-btn');
const gchatScrollBottomBtn = document.getElementById('gchat-scroll-bottom-btn');

window.gchatScrollToTop = function() {
  gchatMsgsDiv.scrollTo({ top: 0, behavior: 'smooth' });
};

window.gchatScrollToBottom = function() {
  gchatMsgsDiv.scrollTo({ top: gchatMsgsDiv.scrollHeight, behavior: 'smooth' });
};

function updateGchatScrollButtons() {
  if (!globalChatMode) return;
  const scrollTop = gchatMsgsDiv.scrollTop;
  const scrollHeight = gchatMsgsDiv.scrollHeight;
  const clientHeight = gchatMsgsDiv.clientHeight;
  const distanceFromBottom = scrollHeight - scrollTop - clientHeight;

  if (scrollTop > SCROLL_THRESHOLD) {
    gchatScrollTopBtn.classList.add('visible');
  } else {
    gchatScrollTopBtn.classList.remove('visible');
  }

  if (distanceFromBottom > SCROLL_THRESHOLD) {
    gchatScrollBottomBtn.classList.add('visible');
  } else {
    gchatScrollBottomBtn.classList.remove('visible');
  }
}

gchatMsgsDiv.addEventListener('scroll', updateGchatScrollButtons);

