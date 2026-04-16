#!/bin/bash
set -eo pipefail

PROJECT_DIR="/mnt/e/Projects/neon-post"
LOG_DIR="$PROJECT_DIR/.claude/logs"
CHECK_CMD="npm run typecheck && npm run lint"
FEATURE_NAME="Social Copilot Bubble"
TOTAL_CHUNKS=7

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

START_CHUNK=1
SKIP_FINAL_CHECK=false
CLEANUP_EVERY=0

while [[ $# -gt 0 ]]; do
  case $1 in
    --start) START_CHUNK="$2"; shift 2 ;;
    --skip-final-check) SKIP_FINAL_CHECK=true; shift ;;
    --cleanup-every) CLEANUP_EVERY="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

mkdir -p "$LOG_DIR"

echo -e "${BLUE}══════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Plan Executor - $FEATURE_NAME${NC}"
echo -e "${BLUE}  $TOTAL_CHUNKS chunks, starting from $START_CHUNK${NC}"
[[ "$CLEANUP_EVERY" -gt 0 ]] && echo -e "${BLUE}  CLAUDE.md cleanup every $CLEANUP_EVERY chunks${NC}"
echo -e "${BLUE}══════════════════════════════════════════════════════${NC}"
echo ""

PREV_CONTEXT=""
PREV_CONTEXT_STAT=""
CHUNKS_SINCE_CLEANUP=0

capture_context() {
  cd "$PROJECT_DIR"
  PREV_CONTEXT=$(git diff HEAD~1 2>/dev/null | head -300 || echo "")
  PREV_CONTEXT_STAT=$(git diff --stat HEAD~1 2>/dev/null || echo "")
}

run_quality_gate() {
  local num=$1
  local gate_log="$LOG_DIR/gate-${num}.log"

  echo -e "${CYAN}  Running quality gate...${NC}"
  cd "$PROJECT_DIR"

  if eval "$CHECK_CMD" > "$gate_log" 2>&1; then
    echo -e "${GREEN}  ✓ Quality gate passed${NC}"
    return 0
  else
    echo -e "${YELLOW}  ⚠ Quality gate failed — spawning fix pass...${NC}"
    local errors
    errors=$(cat "$gate_log")
    local fix_log="$LOG_DIR/fix-${num}.log"

    claude --dangerously-skip-permissions --max-turns 20 \
      -p "Fix quality check errors in neon-post at $PROJECT_DIR

Errors:
\`\`\`
$errors
\`\`\`

Rules:
- Read each file mentioned in the errors
- Fix errors with minimal changes — do NOT refactor or improve surrounding code
- Re-run: $CHECK_CMD
- Loop until clean
- Do NOT ask questions" < /dev/null 2>&1 | tee "$fix_log"

    if eval "$CHECK_CMD" > "$gate_log" 2>&1; then
      echo -e "${GREEN}  ✓ Fix pass succeeded${NC}"
      return 0
    else
      echo -e "${RED}  ✗ Still failing after fix pass — STOPPING${NC}"
      echo -e "${RED}  Fix manually, then resume: ./scripts/run-plan.sh --start $((num + 1))${NC}"
      exit 1
    fi
  fi
}

auto_commit() {
  local num=$1
  local name=$2
  cd "$PROJECT_DIR"

  if ! git diff --quiet HEAD 2>/dev/null || ! git diff --cached --quiet HEAD 2>/dev/null; then
    git add -A
    git commit -m "chunk ${num}/${TOTAL_CHUNKS}: ${name}

Auto-committed by plan executor after quality gate passed." --no-gpg-sign 2>/dev/null || true
    echo -e "${GREEN}  ✓ Auto-committed chunk $num${NC}"
  fi
}

run_cleanup() {
  echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${CYAN}Running CLAUDE.md cleanup...${NC}"
  cd "$PROJECT_DIR"
  claude --dangerously-skip-permissions --max-turns 10 \
    -p "Run /minimal-claude:setup-claude-md to clean up CLAUDE.md at $PROJECT_DIR. Keep it minimal and under 150 lines. Do NOT ask questions." \
    < /dev/null 2>&1 | tee "$LOG_DIR/cleanup.log"
  echo -e "${CYAN}✓ Cleanup done${NC}"
}

# ══════════════════════════════════════════════════════
# RESEARCH FINDINGS (embedded in each chunk prompt)
# ══════════════════════════════════════════════════════

read -r -d '' RESEARCH_FINDINGS << 'RESEARCH_EOF' || true
## Research Findings

### [REFERENCE] Floating chat bubble pattern
Standard pattern: position:absolute container with drag handle, resize handles on edges/corners. Store position/size in localStorage. Use mousedown/mousemove/mouseup for drag. Clamp to viewport bounds.

### [ADAPT] Existing message rendering pipeline
Messages render into `#messages` div via `addMessage()` in `message-renderer.js:1`. Streaming responses use `streamingBubbleBySession` Map + `updateStatusIndicator()` in `message-renderer.js:289`. The bubble reparents the actual `#messages` and `#input-area` DOM nodes — no mirroring needed. All existing rendering works unchanged.

Key DOM elements to reparent:
- `#messages` — chat message container (normally child of `#chat-view`)
- `#input-area` — input container with textarea, send button, toolbar (normally child of `#chat-view`)

Restore positions:
- `#messages` goes after `#global-chat-messages` (or before scroll buttons)
- `#input-area` goes after `#toolbar-row`

### [ADAPT] Existing modal pattern (overlays.css:1-27)
```css
.modal-overlay { position:fixed; inset:0; background:rgba(0,0,0,0.7); display:none; z-index:1000; }
.modal-overlay.show { display:flex; align-items:center; justify-content:center; }
.modal { background:var(--bg-secondary); border:1px solid var(--border); border-radius:var(--radius-sm); max-width:360px; animation:modalIn 0.2s; }
```

### [ADAPT] Session data and mode check
- Sessions available via global `sessions` array (sessions.js:5) or `window.neonPost.sessions.list()`
- Current mode: global `currentAgentMode` (agent-mode.js:3)
- Mode per session: `session.mode` field in DB, fetched by `updateModeUIForSession()`
- Creator mode ID: `'creator'` (agent-modes.ts:235)
- Switch session: `switchSession(sessionId)` (sessions.js:145)

### [ADAPT] Social panel show/hide (social-panel.js:124-165)
```javascript
showSocialPanel() -> chatView.classList.add('hidden') + socialView.classList.add('active')
hideSocialPanel() -> socialView.classList.remove('active') + chatView.classList.remove('hidden')
```
Currently hides chat-view entirely. Bubble approach: still hide chat-view container, but reparent the messages/input into bubble first.
RESEARCH_EOF

# ══════════════════════════════════════════════════════
# CHUNK FUNCTIONS
# ══════════════════════════════════════════════════════

run_chunk_1() {
  local log="$LOG_DIR/chunk-1.log"
  echo -e "${YELLOW}▶ Chunk 1/$TOTAL_CHUNKS: Remove Old Copilot Bar${NC}"

  local context_section=""
  if [[ -n "$PREV_CONTEXT" ]]; then
    context_section="

### Previous Chunk Changes (Summary)
\`\`\`
$PREV_CONTEXT_STAT
\`\`\`

### Previous Chunk Changes (Code)
\`\`\`
$PREV_CONTEXT
\`\`\`
Do NOT modify these files unless they are in YOUR file lists. Review this diff to understand what was already built — do NOT duplicate or contradict it."
  fi

  cd "$PROJECT_DIR"
  claude --dangerously-skip-permissions --max-turns 50 \
    -p "$(cat <<'CHUNK_1_PROMPT'
[Project] Neon Post at /mnt/e/Projects/neon-post
Stack: Electron 40, TypeScript 5.9, vanilla JS UI, better-sqlite3, Claude Agent SDK
Check: npm run typecheck && npm run lint

## Research Findings

### [REFERENCE] Floating chat bubble pattern
Standard pattern: position:absolute container with drag handle, resize handles on edges/corners. Store position/size in localStorage. Use mousedown/mousemove/mouseup for drag. Clamp to viewport bounds.

### [ADAPT] Existing message rendering pipeline
Messages render into `#messages` div via `addMessage()` in `message-renderer.js:1`. Streaming responses use `streamingBubbleBySession` Map + `updateStatusIndicator()` in `message-renderer.js:289`. The bubble reparents the actual `#messages` and `#input-area` DOM nodes — no mirroring needed. All existing rendering works unchanged.

### [ADAPT] Social panel show/hide (social-panel.js:124-165)
Currently hides chat-view entirely. Bubble approach: still hide chat-view container, but reparent the messages/input into bubble first.

## Chunk 1/7: Remove Old Copilot Bar

Depends on: None

**Read these files first** (do NOT explore beyond this list):
- `ui/chat.html` — lines 1701-1713 (copilot bar HTML to find and remove)
- `ui/chat/social-panel.js` — lines 5517-5612 (`_socInitCopilot` function to remove), line 2085 (call site `_socInitCopilot()`)
- `ui/chat/social-panel.css` — lines 4302-4397 (copilot bar CSS to remove)

**Modify:**
- `ui/chat.html` — remove `#soc-copilot-bar` div and all its children
- `ui/chat/social-panel.js` — remove the entire `_socInitCopilot()` function AND remove its call at `_socInitCopilot();` inside `_socInit()`
- `ui/chat/social-panel.css` — remove ALL `.soc-copilot-*` style rules (`.soc-copilot-bar`, `.soc-copilot-response`, `.soc-copilot-response.visible`, `.soc-copilot-actions`, `.soc-copilot-action-btn`, `.soc-copilot-action-btn:hover`, `.soc-copilot-input`, `.soc-copilot-input input`, `.soc-copilot-input input:focus`, `.soc-copilot-send-btn`, `.soc-copilot-send-btn:hover`, `.soc-copilot-send-btn:disabled`)

**What to Build:**
Delete the old copilot bar entirely — HTML, CSS, and JS. This clears the way for the bubble approach in subsequent chunks.

**Rules:**
- Read ONLY the files listed above. Do NOT explore the codebase.
- Implement ONLY what is described. No extras, no refactoring.
- After implementing: npm run typecheck && npm run lint
- Fix ALL errors before finishing.
- Do NOT ask questions.

**Gate:** `npm run typecheck && npm run lint` passes. The `#soc-copilot-bar` element no longer exists in `ui/chat.html`. The `_socInitCopilot` function no longer exists in `ui/chat/social-panel.js`. No `.soc-copilot-*` CSS rules remain in `ui/chat/social-panel.css`.
CHUNK_1_PROMPT
)$context_section" < /dev/null 2>&1 | tee "$log"
}

run_chunk_2() {
  local log="$LOG_DIR/chunk-2.log"
  echo -e "${YELLOW}▶ Chunk 2/$TOTAL_CHUNKS: Bubble Container HTML + CSS${NC}"

  local context_section=""
  if [[ -n "$PREV_CONTEXT" ]]; then
    context_section="

### Previous Chunk Changes (Summary)
\`\`\`
$PREV_CONTEXT_STAT
\`\`\`

### Previous Chunk Changes (Code)
\`\`\`
$PREV_CONTEXT
\`\`\`
Do NOT modify these files unless they are in YOUR file lists. Review this diff to understand what was already built — do NOT duplicate or contradict it."
  fi

  cd "$PROJECT_DIR"
  claude --dangerously-skip-permissions --max-turns 50 \
    -p "$(cat <<'CHUNK_2_PROMPT'
[Project] Neon Post at /mnt/e/Projects/neon-post
Stack: Electron 40, TypeScript 5.9, vanilla JS UI, better-sqlite3, Claude Agent SDK
Check: npm run typecheck && npm run lint

## Research Findings

### [ADAPT] Existing modal pattern (overlays.css:1-27)
```css
.modal-overlay { position:fixed; inset:0; background:rgba(0,0,0,0.7); display:none; z-index:1000; }
.modal-overlay.show { display:flex; align-items:center; justify-content:center; }
.modal { background:var(--bg-secondary); border:1px solid var(--border); border-radius:var(--radius-sm); max-width:360px; animation:modalIn 0.2s; }
```

### [ADAPT] Existing social panel modal pattern
Social panel modals use `.soc-modal-overlay` (position:fixed, inset:0) and `.soc-modal-panel` (background, border, max-height:85vh, width:500px). Visibility toggled via inline `style="display:none"` and JS.

## Chunk 2/7: Bubble Container HTML + CSS

Depends on: Chunk 1 (copilot bar removed — already done)

**Read these files first** (do NOT explore beyond this list):
- `ui/chat/social-panel.css` — understand z-index layers and CSS variable names used throughout (read first 20 lines + search for z-index)
- `ui/chat/overlays.css` — modal z-index (1000) for layering reference (read first 30 lines)
- `ui/chat/messages.css` — `#messages` styles (flex:1, overflow-y:auto, padding, child margins) (read first 40 lines)
- `ui/chat/input.css` — `#input-area` styles (padding with calc-based centering, flex-shrink:0) (read first 15 lines)
- `ui/chat.html` — find the end of `#social-view` div (search for the closing area near copilot bar was removed) to know where to insert bubble HTML

**Modify:**
- `ui/chat.html` — add bubble container HTML inside `#social-view` (before social-view's closing `</div>`), also add session picker modal HTML after the bubble
- `ui/chat/social-panel.css` — add all bubble styles and session picker modal styles at the end of the file

**What to Build:**
Add the bubble container and session picker modal HTML + all CSS. The bubble sits inside `#social-view` as `position: absolute` overlay.

**Bubble HTML to add inside #social-view:**
```html
    <!-- Copilot Bubble (floating chat overlay) -->
    <div class="soc-bubble" id="soc-bubble">
      <div class="soc-bubble__header" id="soc-bubble-header">
        <span class="soc-bubble__mode-icon">🎬</span>
        <span class="soc-bubble__session-name" id="soc-bubble-session-name">Session</span>
        <button class="soc-bubble__btn" id="soc-bubble-swap" title="Switch session">⇄</button>
        <button class="soc-bubble__btn" id="soc-bubble-minimize" title="Minimize">─</button>
        <button class="soc-bubble__btn" id="soc-bubble-close" title="Close">✕</button>
      </div>
      <div class="soc-bubble__body" id="soc-bubble-body">
        <!-- #messages will be reparented here -->
      </div>
      <div class="soc-bubble__actions" id="soc-bubble-actions">
        <!-- Context-aware quick action pills -->
      </div>
      <div class="soc-bubble__footer" id="soc-bubble-footer">
        <!-- #input-area will be reparented here -->
      </div>
      <div class="soc-bubble__resize soc-bubble__resize--n" data-dir="n"></div>
      <div class="soc-bubble__resize soc-bubble__resize--s" data-dir="s"></div>
      <div class="soc-bubble__resize soc-bubble__resize--e" data-dir="e"></div>
      <div class="soc-bubble__resize soc-bubble__resize--w" data-dir="w"></div>
      <div class="soc-bubble__resize soc-bubble__resize--ne" data-dir="ne"></div>
      <div class="soc-bubble__resize soc-bubble__resize--nw" data-dir="nw"></div>
      <div class="soc-bubble__resize soc-bubble__resize--se" data-dir="se"></div>
      <div class="soc-bubble__resize soc-bubble__resize--sw" data-dir="sw"></div>
    </div>

    <!-- Session Picker Modal -->
    <div class="soc-modal-overlay" id="soc-bubble-session-modal" style="display:none">
      <div class="soc-modal-panel soc-session-picker">
        <div class="soc-modal-header">
          <h3 class="soc-section-title">Pick a session</h3>
          <button class="soc-modal-close" id="soc-bubble-session-modal-close">×</button>
        </div>
        <div class="soc-session-picker__search">
          <input type="text" id="soc-session-search" placeholder="Search sessions..." autocomplete="off">
        </div>
        <div class="soc-session-picker__list" id="soc-session-list"></div>
      </div>
    </div>
```

**CSS to add at end of social-panel.css:**
```css
/* ─── Copilot Bubble ─────────────────────────────────────────────── */
.soc-bubble {
  position: absolute;
  bottom: 16px;
  right: 16px;
  width: 360px;
  height: 450px;
  min-width: 280px;
  min-height: 300px;
  max-width: 80vw;
  max-height: 80vh;
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  display: none;
  flex-direction: column;
  z-index: 50;
  overflow: hidden;
}
.soc-bubble.active { display: flex; }

.soc-bubble__header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
  cursor: grab;
  flex-shrink: 0;
  min-height: 40px;
  user-select: none;
}
.soc-bubble__header:active { cursor: grabbing; }

.soc-bubble__mode-icon {
  font-size: 16px;
  flex-shrink: 0;
}

.soc-bubble__session-name {
  flex: 1;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.soc-bubble__btn {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 6px;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 14px;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
  flex-shrink: 0;
}
.soc-bubble__btn:hover {
  background: var(--bg-tertiary);
  color: var(--text-primary);
  border-color: var(--border);
}

.soc-bubble__body {
  flex: 1;
  overflow: hidden;
  min-height: 0;
}

/* Override message styles when inside bubble */
.soc-bubble__body #messages {
  padding: 12px;
}
.soc-bubble__body #messages > * {
  margin-left: 0 !important;
  margin-right: 0 !important;
}

.soc-bubble__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 6px 12px;
  border-top: 1px solid var(--border);
  flex-shrink: 0;
}
.soc-bubble__actions:empty { display: none; }

.soc-bubble__action-pill {
  padding: 3px 10px;
  font-size: 11px;
  border-radius: 12px;
  border: 1px solid var(--border);
  background: var(--bg-secondary);
  color: var(--text-secondary);
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}
.soc-bubble__action-pill:hover {
  background: var(--accent);
  color: var(--bg-primary);
  border-color: var(--accent);
}

.soc-bubble__footer {
  flex-shrink: 0;
  border-top: 1px solid var(--border);
}

/* Override input area styles when inside bubble */
.soc-bubble__footer #input-area {
  padding: 8px 12px 10px;
}
.soc-bubble__footer .input-toolbar-btns {
  display: none;
}
.soc-bubble__footer .input-container {
  padding-right: 40px;
}

/* Bubble minimized state */
.soc-bubble--minimized .soc-bubble__body,
.soc-bubble--minimized .soc-bubble__actions,
.soc-bubble--minimized .soc-bubble__footer {
  display: none;
}
.soc-bubble--minimized {
  height: auto !important;
  min-height: auto !important;
}

/* Bubble dragging */
.soc-bubble--dragging { opacity: 0.9; }

/* Bubble animation */
@keyframes socBubbleIn {
  from { transform: scale(0.9); opacity: 0; }
  to { transform: scale(1); opacity: 1; }
}
.soc-bubble.active { animation: socBubbleIn 0.2s ease; }
.soc-bubble--exiting {
  animation: socBubbleIn 0.15s ease reverse forwards;
}

/* Resize handles */
.soc-bubble__resize { position: absolute; z-index: 2; }
.soc-bubble__resize--n { top: -3px; left: 8px; right: 8px; height: 6px; cursor: n-resize; }
.soc-bubble__resize--s { bottom: -3px; left: 8px; right: 8px; height: 6px; cursor: s-resize; }
.soc-bubble__resize--e { right: -3px; top: 8px; bottom: 8px; width: 6px; cursor: e-resize; }
.soc-bubble__resize--w { left: -3px; top: 8px; bottom: 8px; width: 6px; cursor: w-resize; }
.soc-bubble__resize--ne { top: -3px; right: -3px; width: 12px; height: 12px; cursor: ne-resize; }
.soc-bubble__resize--nw { top: -3px; left: -3px; width: 12px; height: 12px; cursor: nw-resize; }
.soc-bubble__resize--se { bottom: -3px; right: -3px; width: 12px; height: 12px; cursor: se-resize; }
.soc-bubble__resize--sw { bottom: -3px; left: -3px; width: 12px; height: 12px; cursor: sw-resize; }

/* ─── Session Picker Modal ───────────────────────────────────────── */
.soc-session-picker {
  width: 400px;
  max-height: 70vh;
  display: flex;
  flex-direction: column;
}
.soc-session-picker__search {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
}
.soc-session-picker__search input {
  width: 100%;
  padding: 8px 12px;
  font-size: 13px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg-primary);
  color: var(--text-primary);
  outline: none;
}
.soc-session-picker__search input:focus {
  border-color: var(--accent);
}
.soc-session-picker__list {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
}
.soc-session-picker__section-title {
  padding: 8px 16px 4px;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
}
.soc-session-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  cursor: pointer;
  transition: background 0.1s;
}
.soc-session-row:hover { background: var(--bg-tertiary); }
.soc-session-row.active {
  background: rgba(var(--accent-rgb, 99, 102, 241), 0.1);
  border-left: 3px solid var(--accent);
}
.soc-session-row.dimmed { opacity: 0.5; }
.soc-session-row__icon { font-size: 16px; flex-shrink: 0; }
.soc-session-row__name { flex: 1; font-size: 13px; color: var(--text-primary); }
.soc-session-row__time { font-size: 11px; color: var(--text-muted); }
.soc-session-row__hint { font-size: 11px; color: var(--text-muted); font-style: italic; }

/* Bubble mode hint (shown when not in creator mode) */
.soc-bubble-hint {
  position: absolute;
  bottom: 16px;
  right: 16px;
  padding: 8px 14px;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 8px;
  font-size: 12px;
  color: var(--text-muted);
  z-index: 50;
  display: none;
}
.soc-bubble-hint.active { display: block; }
```

**Expected Layout:**
```
+---------------------------------------------+
|  Social Panel (tabs, content)               |
|                                             |
|                    +------------------+      |
|                    | M Session  S - X |      |
|                    |------------------|      |
|                    |                  |      |
|                    |  messages area   |      |
|                    |                  |      |
|                    |------------------|      |
|                    | [quick actions]  |      |
|                    | [input] [send]   |      |
|                    +------------------+      |
+---------------------------------------------+
```

**Rules:**
- Read ONLY the files listed above. Do NOT explore the codebase.
- Implement ONLY what is described. No extras, no refactoring.
- Use the exact HTML and CSS provided above. Do NOT improvise.
- After implementing: npm run typecheck && npm run lint
- Fix ALL errors before finishing.
- Do NOT ask questions.

**Gate:** `npm run typecheck && npm run lint` passes. `#soc-bubble` element exists in the DOM inside `#social-view`. `#soc-bubble-session-modal` element exists. All CSS classes from the spec are present in `social-panel.css`.
CHUNK_2_PROMPT
)$context_section" < /dev/null 2>&1 | tee "$log"
}

run_chunk_3() {
  local log="$LOG_DIR/chunk-3.log"
  echo -e "${YELLOW}▶ Chunk 3/$TOTAL_CHUNKS: Bubble Show/Hide + DOM Reparenting${NC}"

  local context_section=""
  if [[ -n "$PREV_CONTEXT" ]]; then
    context_section="

### Previous Chunk Changes (Summary)
\`\`\`
$PREV_CONTEXT_STAT
\`\`\`

### Previous Chunk Changes (Code)
\`\`\`
$PREV_CONTEXT
\`\`\`
Do NOT modify these files unless they are in YOUR file lists. Review this diff to understand what was already built — do NOT duplicate or contradict it."
  fi

  cd "$PROJECT_DIR"
  claude --dangerously-skip-permissions --max-turns 50 \
    -p "$(cat <<'CHUNK_3_PROMPT'
[Project] Neon Post at /mnt/e/Projects/neon-post
Stack: Electron 40, TypeScript 5.9, vanilla JS UI, better-sqlite3, Claude Agent SDK
Check: npm run typecheck && npm run lint

## Research Findings

### [ADAPT] Existing message rendering pipeline
Messages render into `#messages` div via `addMessage()` in `message-renderer.js:1`. Streaming responses use `streamingBubbleBySession` Map + `updateStatusIndicator()` in `message-renderer.js:289`. The bubble reparents the actual `#messages` and `#input-area` DOM nodes — no mirroring needed. All existing rendering works unchanged.

Key DOM elements to reparent:
- `#messages` — chat message container (normally child of `#chat-view`)
- `#input-area` — input container with textarea, send button, toolbar (normally child of `#chat-view`)

Restore positions in `#chat-view`:
- `#messages` goes after `#global-chat-messages`
- `#input-area` goes after `#toolbar-row`

### [ADAPT] Session data and mode check
- Current mode: global `currentAgentMode` (agent-mode.js:3) — string like 'general', 'creator', etc.
- Sessions: global `sessions` array with `.id`, `.name`, `.mode` fields
- `currentSessionId` global tracks active session
- Switch session: `switchSession(sessionId)` in sessions.js:145

### [ADAPT] Social panel show/hide (social-panel.js:124-165)
```javascript
showSocialPanel() -> chatView.classList.add('hidden') + socialView.classList.add('active')
hideSocialPanel() -> socialView.classList.remove('active') + chatView.classList.remove('hidden')
```

## Chunk 3/7: Bubble Show/Hide + DOM Reparenting

Depends on: Chunk 2 (bubble HTML/CSS exists in DOM)

**Read these files first** (do NOT explore beyond this list):
- `ui/chat/social-panel.js` — read `showSocialPanel()` and `hideSocialPanel()` functions (search for them), and understand the global variables at the top of the file
- `ui/chat/sessions.js` — read `switchSession()` function to understand session switching flow
- `ui/chat/agent-mode.js` — read to find the `currentAgentMode` global variable and understand mode tracking
- `ui/chat/state.js` — read to understand global state variables
- `ui/chat.html` — read the `#chat-view` section to understand the exact DOM order of `#messages`, `#global-chat-messages`, `#toolbar-row`, `#input-area`

**Modify:**
- `ui/chat/social-panel.js` — modify `showSocialPanel()` and `hideSocialPanel()`, add bubble management functions

**What to Build:**

Add these globals near top of social-panel.js (after existing globals):
```javascript
let _socBubbleActive = false;
let _socBubbleMessagesParent = null;  // original parent of #messages
let _socBubbleMessagesNext = null;    // original nextSibling of #messages
let _socBubbleInputParent = null;     // original parent of #input-area
let _socBubbleInputNext = null;       // original nextSibling of #input-area
```

Add `_socBubbleShow()`:
1. Check `currentAgentMode` — if not `'creator'`, don't show bubble (just return)
2. Get `#messages` and `#input-area` elements
3. Save their current `parentNode` and `nextSibling` in the globals above (for restore)
4. Move `#messages` into `#soc-bubble-body` via `body.appendChild(messagesEl)`
5. Move `#input-area` into `#soc-bubble-footer` via `footer.appendChild(inputEl)`
6. Update `#soc-bubble-session-name` text from current session name (find in `sessions` array)
7. Restore saved position/size from localStorage keys `soc-bubble-pos` and `soc-bubble-size`
8. Add `.active` class to `#soc-bubble`
9. Set `_socBubbleActive = true`

Add `_socBubbleHide()`:
1. If `!_socBubbleActive` return early
2. Remove `.active` from `#soc-bubble`
3. Move `#messages` back: `_socBubbleMessagesParent.insertBefore(messagesEl, _socBubbleMessagesNext)`
4. Move `#input-area` back: `_socBubbleInputParent.insertBefore(inputEl, _socBubbleInputNext)`
5. Set `_socBubbleActive = false`
6. Clear saved references

Modify `showSocialPanel()`:
- After the existing `_socRefreshActiveTab()` call, add: `_socBubbleShow()`

Modify `hideSocialPanel()`:
- BEFORE the existing `socialView.classList.remove('active')` line, add: `_socBubbleHide()`

Also add `_socBubbleUpdateSession()` — called when session changes while social panel is open:
1. If social panel not active, return
2. Get new session's mode from `sessions` array
3. If creator → update bubble header name, ensure bubble shown
4. If not creator → `_socBubbleHide()`

Hook into session switching: add a listener or modify the flow. The simplest approach: after `_socInit()`, set up a MutationObserver or interval that checks `currentSessionId` changes. OR: expose `_socBubbleUpdateSession` globally and call it from the session switch flow. The cleanest way: add to `socPanelActions` object (which is already globally accessible) a method like `socPanelActions.onSessionChanged()` and call it from `switchSession()` in sessions.js.

IMPORTANT: The `switchSession()` function in sessions.js calls `returnToChatView()` which hides the social panel. You need to handle this — either: (a) don't call returnToChatView when the social panel bubble is active and user clicks a session tab, OR (b) let it close and require user to reopen. Option (b) is simpler and less risky — go with that.

Actually, the simplest approach: just handle bubble state in showSocialPanel/hideSocialPanel. When user switches session via sidebar tabs, `returnToChatView()` closes the social panel which calls `hideSocialPanel()` which restores DOM. Then if they reopen social panel, `showSocialPanel()` checks the new session's mode and shows/hides bubble accordingly. This requires NO changes to sessions.js.

**Rules:**
- Read ONLY the files listed above. Do NOT explore the codebase.
- Implement ONLY what is described. No extras, no refactoring.
- The DOM reparenting MUST use appendChild to physically move nodes, NOT cloneNode. This preserves event listeners and streaming state.
- After implementing: npm run typecheck && npm run lint
- Fix ALL errors before finishing.
- Do NOT ask questions.

**Gate:** `npm run typecheck && npm run lint` passes. When social panel opens with a creator-mode session: `#messages` is a child of `#soc-bubble-body`, `#input-area` is a child of `#soc-bubble-footer`, bubble is visible. When social panel closes: `#messages` and `#input-area` are back in `#chat-view` at their original positions. Non-creator sessions: bubble does not appear.
CHUNK_3_PROMPT
)$context_section" < /dev/null 2>&1 | tee "$log"
}

run_chunk_4() {
  local log="$LOG_DIR/chunk-4.log"
  echo -e "${YELLOW}▶ Chunk 4/$TOTAL_CHUNKS: Bubble Dragging${NC}"

  local context_section=""
  if [[ -n "$PREV_CONTEXT" ]]; then
    context_section="

### Previous Chunk Changes (Summary)
\`\`\`
$PREV_CONTEXT_STAT
\`\`\`

### Previous Chunk Changes (Code)
\`\`\`
$PREV_CONTEXT
\`\`\`
Do NOT modify these files unless they are in YOUR file lists. Review this diff to understand what was already built — do NOT duplicate or contradict it."
  fi

  cd "$PROJECT_DIR"
  claude --dangerously-skip-permissions --max-turns 50 \
    -p "$(cat <<'CHUNK_4_PROMPT'
[Project] Neon Post at /mnt/e/Projects/neon-post
Stack: Electron 40, TypeScript 5.9, vanilla JS UI, better-sqlite3, Claude Agent SDK
Check: npm run typecheck && npm run lint

## Chunk 4/7: Bubble Dragging

Depends on: Chunk 3 (bubble shows/hides, DOM reparenting works)

**Read these files first** (do NOT explore beyond this list):
- `ui/chat/social-panel.js` — search for `_socBubbleShow` and `_socBubbleHide` to understand bubble state management, and find where bubble initialization happens
- `ui/chat/social-panel.css` — search for `.soc-bubble` to see current bubble styles

**Modify:**
- `ui/chat/social-panel.js` — add `_socBubbleInitDrag()` function and call it once during bubble initialization (inside `_socBubbleShow` on first call, or in `_socInit`)

**What to Build:**
Make the bubble header (`#soc-bubble-header`) a drag handle.

Add `_socBubbleInitDrag()`:
1. Get `#soc-bubble` and `#soc-bubble-header` elements
2. Track drag state: `let _dragStartX, _dragStartY, _dragBubbleX, _dragBubbleY, _dragging = false`
3. On `mousedown` on header:
   - Check `e.target.closest('.soc-bubble__btn')` — if truthy, return (don't intercept button clicks)
   - Set `_dragging = true`
   - Record `e.clientX`, `e.clientY` as start position
   - Read bubble's current `offsetLeft` and `offsetTop` (or parse from style)
   - Add `soc-bubble--dragging` class to bubble
   - Set `document.body.style.userSelect = 'none'`
   - `e.preventDefault()`
4. On `mousemove` on document:
   - If not `_dragging`, return
   - Calculate deltaX = e.clientX - _dragStartX, deltaY = e.clientY - _dragStartY
   - New left = _dragBubbleX + deltaX, new top = _dragBubbleY + deltaY
   - Clamp: left >= 0, top >= 0, left + bubble.offsetWidth <= bubble.parentElement.clientWidth, top + bubble.offsetHeight <= bubble.parentElement.clientHeight
   - Set bubble style: `left = newLeft + 'px'`, `top = newTop + 'px'`
   - IMPORTANT: Also clear `bottom` and `right` styles (set to 'auto') since the bubble starts with bottom/right positioning but drag uses top/left
5. On `mouseup` on document:
   - If not `_dragging`, return
   - `_dragging = false`
   - Remove `soc-bubble--dragging` class
   - `document.body.style.userSelect = ''`
   - Save position: `localStorage.setItem('soc-bubble-pos', JSON.stringify({ left: bubble.offsetLeft, top: bubble.offsetTop }))`

Update `_socBubbleShow()` to restore saved position:
- Read from `localStorage.getItem('soc-bubble-pos')`
- If exists, parse and apply `left`/`top` style (and set `bottom`/`right` to `'auto'`)
- If not exists, keep default CSS positioning (bottom:16px, right:16px)

Make sure drag initialization only happens once (use a flag like `_socBubbleDragInit`).

**Rules:**
- Read ONLY the files listed above. Do NOT explore the codebase.
- Implement ONLY what is described. No extras, no refactoring.
- After implementing: npm run typecheck && npm run lint
- Fix ALL errors before finishing.
- Do NOT ask questions.

**Gate:** `npm run typecheck && npm run lint` passes. The bubble header has `cursor: grab` (from CSS). Dragging the header moves the bubble. The bubble cannot be dragged outside its parent container bounds. Header buttons (swap, minimize, close) remain clickable and do not trigger drag. Position is saved to localStorage and restored on next social panel open.
CHUNK_4_PROMPT
)$context_section" < /dev/null 2>&1 | tee "$log"
}

run_chunk_5() {
  local log="$LOG_DIR/chunk-5.log"
  echo -e "${YELLOW}▶ Chunk 5/$TOTAL_CHUNKS: Bubble Resizing${NC}"

  local context_section=""
  if [[ -n "$PREV_CONTEXT" ]]; then
    context_section="

### Previous Chunk Changes (Summary)
\`\`\`
$PREV_CONTEXT_STAT
\`\`\`

### Previous Chunk Changes (Code)
\`\`\`
$PREV_CONTEXT
\`\`\`
Do NOT modify these files unless they are in YOUR file lists. Review this diff to understand what was already built — do NOT duplicate or contradict it."
  fi

  cd "$PROJECT_DIR"
  claude --dangerously-skip-permissions --max-turns 50 \
    -p "$(cat <<'CHUNK_5_PROMPT'
[Project] Neon Post at /mnt/e/Projects/neon-post
Stack: Electron 40, TypeScript 5.9, vanilla JS UI, better-sqlite3, Claude Agent SDK
Check: npm run typecheck && npm run lint

## Chunk 5/7: Bubble Resizing

Depends on: Chunk 4 (drag works, position logic established)

**Read these files first** (do NOT explore beyond this list):
- `ui/chat/social-panel.js` — search for `_socBubbleInitDrag` to understand the drag pattern, and `_socBubbleShow` to see where position/size restoration happens
- `ui/chat/social-panel.css` — search for `soc-bubble__resize` to see the resize handle CSS already added in chunk 2

**Modify:**
- `ui/chat/social-panel.js` — add `_socBubbleInitResize()` function

**What to Build:**
Add resize functionality using the 8 resize handles already in the DOM (added in chunk 2).

Add `_socBubbleInitResize()`:
1. Get `#soc-bubble` element
2. Get all `.soc-bubble__resize` elements
3. Track state: `let _resizing = false, _resizeDir, _resizeStartX, _resizeStartY, _resizeStartRect`
4. For each resize handle, on `mousedown`:
   - `_resizing = true`
   - `_resizeDir = handle.dataset.dir` (n, s, e, w, ne, nw, se, sw)
   - Record `e.clientX`, `e.clientY` as start
   - Record bubble's current rect: `{ left, top, width, height }` from offsetLeft/offsetTop/offsetWidth/offsetHeight
   - Add `soc-bubble--resizing` class
   - `document.body.style.userSelect = 'none'`
   - `e.preventDefault()`
5. On `mousemove` on document:
   - If not `_resizing`, return
   - deltaX = e.clientX - _resizeStartX, deltaY = e.clientY - _resizeStartY
   - Based on `_resizeDir`:
     - `s`: height = startHeight + deltaY
     - `n`: top = startTop + deltaY, height = startHeight - deltaY
     - `e`: width = startWidth + deltaX
     - `w`: left = startLeft + deltaX, width = startWidth - deltaX
     - Combos (ne, nw, se, sw): combine the above
   - Clamp width: min 280, max parentWidth * 0.8
   - Clamp height: min 300, max parentHeight * 0.8
   - If clamped and direction adjusts position (n/w), re-derive position
   - Apply styles: `bubble.style.width`, `.height`, `.left`, `.top` as needed
   - Clear `.bottom` and `.right` if setting `.top`/`.left`
6. On `mouseup`:
   - If not `_resizing`, return
   - `_resizing = false`
   - Remove `soc-bubble--resizing` class
   - `document.body.style.userSelect = ''`
   - Save: `localStorage.setItem('soc-bubble-size', JSON.stringify({ width: bubble.offsetWidth, height: bubble.offsetHeight }))`
   - Also save position (it may have changed for n/w resizes): `localStorage.setItem('soc-bubble-pos', JSON.stringify({ left: bubble.offsetLeft, top: bubble.offsetTop }))`

Call `_socBubbleInitResize()` alongside the drag init (once only).

Update `_socBubbleShow()` to also restore size from `localStorage.getItem('soc-bubble-size')`.

**Rules:**
- Read ONLY the files listed above. Do NOT explore the codebase.
- Implement ONLY what is described. No extras, no refactoring.
- After implementing: npm run typecheck && npm run lint
- Fix ALL errors before finishing.
- Do NOT ask questions.

**Gate:** `npm run typecheck && npm run lint` passes. Bubble can be resized from all 8 edges/corners. Width cannot go below 280px or above 80% of parent width. Height cannot go below 300px or above 80% of parent height. Size is saved to localStorage and restored on next open. Messages inside the bubble reflow correctly at different sizes.
CHUNK_5_PROMPT
)$context_section" < /dev/null 2>&1 | tee "$log"
}

run_chunk_6() {
  local log="$LOG_DIR/chunk-6.log"
  echo -e "${YELLOW}▶ Chunk 6/$TOTAL_CHUNKS: Session Picker Modal${NC}"

  local context_section=""
  if [[ -n "$PREV_CONTEXT" ]]; then
    context_section="

### Previous Chunk Changes (Summary)
\`\`\`
$PREV_CONTEXT_STAT
\`\`\`

### Previous Chunk Changes (Code)
\`\`\`
$PREV_CONTEXT
\`\`\`
Do NOT modify these files unless they are in YOUR file lists. Review this diff to understand what was already built — do NOT duplicate or contradict it."
  fi

  cd "$PROJECT_DIR"
  claude --dangerously-skip-permissions --max-turns 50 \
    -p "$(cat <<'CHUNK_6_PROMPT'
[Project] Neon Post at /mnt/e/Projects/neon-post
Stack: Electron 40, TypeScript 5.9, vanilla JS UI, better-sqlite3, Claude Agent SDK
Check: npm run typecheck && npm run lint

## Research Findings

### [ADAPT] Session data and mode check
- Sessions available via global `sessions` array (sessions.js) — each has `.id`, `.name`, `.mode`, `.updated_at`
- Current session: global `currentSessionId`
- Mode icons: general='🐾', coder='🔧', researcher='🔍', writer='✍️', therapist='💬', creator='🎬'
- Switch session: `switchSession(sessionId)` in sessions.js — this calls `returnToChatView()` which closes the social panel

### [ADAPT] Existing social modal pattern
Social panel modals use `.soc-modal-overlay` (position:fixed, inset:0) with inline `style="display:none"`. Open by setting display to 'flex'. Close by setting display to 'none'.

## Chunk 6/7: Session Picker Modal

Depends on: Chunk 3 (bubble functional)

**Read these files first** (do NOT explore beyond this list):
- `ui/chat/sessions.js` — read `switchSession()` function and understand the global `sessions` array structure
- `ui/chat/social-panel.js` — search for `_socBubbleShow`, `_socBubbleHide`, and `soc-bubble-swap` to understand bubble state and find where to wire the swap button
- `ui/chat/social-panel.css` — search for `soc-session-picker` to see the CSS already added in chunk 2

**Modify:**
- `ui/chat/social-panel.js` — add session picker modal logic (open/close, render sessions, search, switch)

**What to Build:**

Wire up the swap button in the bubble header to open/close the session picker modal.

Add `_socBubbleOpenSessionPicker()`:
1. Get `#soc-bubble-session-modal` element
2. Set `display: 'flex'` to show it
3. Clear search input `#soc-session-search`
4. Call `_socBubbleRenderSessionList()` to populate the list
5. Focus the search input

Add `_socBubbleCloseSessionPicker()`:
1. Set `#soc-bubble-session-modal` display to 'none'

Add `_socBubbleRenderSessionList(filter)`:
1. Get `#soc-session-list` element
2. Get global `sessions` array
3. Apply filter: if `filter` string provided, filter sessions where name includes filter (case-insensitive)
4. Split into two groups:
   - `creatorSessions` = sessions with mode === 'creator', sorted by updated_at descending
   - `otherSessions` = rest, sorted by updated_at descending
5. Build HTML:
   - If creatorSessions.length > 0: section title "CREATOR SESSIONS" + rows
   - If otherSessions.length > 0: section title "OTHER SESSIONS" + rows
   - If no sessions match: "No sessions found"
6. Each row HTML:
   ```html
   <div class="soc-session-row [active if currentSessionId] [dimmed if not creator]" data-session-id="ID">
     <span class="soc-session-row__icon">ICON</span>
     <span class="soc-session-row__name">NAME</span>
     <span class="soc-session-row__time">TIME_AGO</span>
   </div>
   ```
7. Mode icon map: { general:'🐾', coder:'🔧', researcher:'🔍', writer:'✍️', therapist:'💬', creator:'🎬' }
8. Time ago: reuse `_socTimeAgo()` if it exists, or write a simple one

Wire event listeners (call during bubble init, once only):
- `#soc-bubble-swap` click → `_socBubbleOpenSessionPicker()`
- `#soc-bubble-session-modal-close` click → `_socBubbleCloseSessionPicker()`
- `#soc-bubble-session-modal` click on overlay (click target === modal overlay itself) → close
- `#soc-session-search` input event → `_socBubbleRenderSessionList(searchInput.value)`
- `document` keydown Escape → close if modal is open
- Click on `.soc-session-row` → get `data-session-id`, call `_socBubbleCloseSessionPicker()`, then:
  - The session row was clicked. We need to switch to that session.
  - IMPORTANT: `switchSession()` in sessions.js calls `returnToChatView()` which closes the social panel and calls `hideSocialPanel()` which calls `_socBubbleHide()`. This is fine — let it happen.
  - After switching, the user will need to reopen the social panel to see the bubble again with the new session.
  - So just call: `switchSession(sessionId)` — the existing flow handles everything.

**Rules:**
- Read ONLY the files listed above. Do NOT explore the codebase.
- Implement ONLY what is described. No extras, no refactoring.
- After implementing: npm run typecheck && npm run lint
- Fix ALL errors before finishing.
- Do NOT ask questions.

**Gate:** `npm run typecheck && npm run lint` passes. Clicking the swap button (⇄) in the bubble header opens the session picker modal. Sessions are listed with creator sessions in a top section, other sessions in a bottom section (dimmed). Current session is highlighted. Search input filters the list live. Clicking a session row switches to that session (which closes the social panel). Close button, overlay click, and Escape all close the modal.
CHUNK_6_PROMPT
)$context_section" < /dev/null 2>&1 | tee "$log"
}

run_chunk_7() {
  local log="$LOG_DIR/chunk-7.log"
  echo -e "${YELLOW}▶ Chunk 7/$TOTAL_CHUNKS: Bubble Minimize + Polish${NC}"

  local context_section=""
  if [[ -n "$PREV_CONTEXT" ]]; then
    context_section="

### Previous Chunk Changes (Summary)
\`\`\`
$PREV_CONTEXT_STAT
\`\`\`

### Previous Chunk Changes (Code)
\`\`\`
$PREV_CONTEXT
\`\`\`
Do NOT modify these files unless they are in YOUR file lists. Review this diff to understand what was already built — do NOT duplicate or contradict it."
  fi

  cd "$PROJECT_DIR"
  claude --dangerously-skip-permissions --max-turns 50 \
    -p "$(cat <<'CHUNK_7_PROMPT'
[Project] Neon Post at /mnt/e/Projects/neon-post
Stack: Electron 40, TypeScript 5.9, vanilla JS UI, better-sqlite3, Claude Agent SDK
Check: npm run typecheck && npm run lint

## Chunk 7/7: Bubble Minimize + Polish

Depends on: Chunks 3-6 (bubble fully functional with drag, resize, session picker)

**Read these files first** (do NOT explore beyond this list):
- `ui/chat/social-panel.js` — search for all `_socBubble` functions to understand bubble state management. Also find the tab click handler (search for `data-tab` click listener) to understand which social tab is active.
- `ui/chat/social-panel.css` — search for `soc-bubble--minimized` to see minimized CSS already added in chunk 2. Also look for the animation keyframes `socBubbleIn`.

**Modify:**
- `ui/chat/social-panel.js` — add minimize/expand toggle, context-aware quick actions, edge case handling
- `ui/chat/social-panel.css` — add any missing transition styles (check what chunk 2 already added)

**What to Build:**

**1. Minimize/expand:**
- Wire `#soc-bubble-minimize` click handler
- On click: toggle `.soc-bubble--minimized` class on `#soc-bubble`
- When minimizing: change button text to `▢` (restore icon)
- When expanding: change button text to `─` (minimize icon)
- Save state in `localStorage.setItem('soc-bubble-minimized', 'true'/'false')`
- Restore on `_socBubbleShow()`: if saved as minimized, add the class

**2. Context-aware quick actions:**
- Add `_socBubbleUpdateActions()` function
- Get the currently active social tab from `.soc-tab-btn.active` data-tab attribute
- Based on tab, populate `#soc-bubble-actions` with action pill buttons:
  - `content-browse`: ["Find trending content", "Search ideas for my niche"]
  - `create`: ["Rewrite this draft", "Add hashtags", "Make it shorter"]
  - `calendar`: ["Schedule all drafts", "Best posting times"]
  - `preview`: ["Compare all platforms"]
- Each pill: `<button class="soc-bubble__action-pill" data-action="TEXT">TEXT</button>`
- On pill click: set `#message-input` value to the action text and trigger send:
  ```javascript
  var input = document.getElementById('message-input');
  if (input) { input.value = actionText; input.focus(); }
  var sendBtn = document.getElementById('send-btn');
  if (sendBtn) sendBtn.click();
  ```
- Call `_socBubbleUpdateActions()` inside `_socBubbleShow()` and also hook into the social tab click listeners. Find where tab clicks are handled (search for `data-tab` listener in social-panel.js) and add a call to `_socBubbleUpdateActions()` there.

**3. Close button:**
- Wire `#soc-bubble-close` click handler
- On click: hide the bubble but keep social panel open
- Implementation: `_socBubbleHide()` — but this moves DOM back to chat-view which makes the chat invisible (chat-view is hidden when social panel is active)
- Better approach: just set `#soc-bubble` display to none (remove `.active`) without moving DOM back. Set a flag `_socBubbleClosed = true`. When `hideSocialPanel()` runs later, it should still restore DOM properly.
- Actually simplest: call the full `_socBubbleHide()` and accept that the chat won't be visible until they close the social panel or click the sidebar social button again. Users can always reopen by toggling the social panel off and on.

**4. Edge cases:**
- Window/container resize: add a `resize` event listener on window. If bubble is active, clamp its position so it stays within the social panel bounds:
  ```javascript
  window.addEventListener('resize', function() {
    if (!_socBubbleActive) return;
    var bubble = document.getElementById('soc-bubble');
    var parent = bubble.parentElement;
    if (!bubble || !parent) return;
    var maxLeft = parent.clientWidth - bubble.offsetWidth;
    var maxTop = parent.clientHeight - bubble.offsetHeight;
    if (bubble.offsetLeft > maxLeft) bubble.style.left = Math.max(0, maxLeft) + 'px';
    if (bubble.offsetTop > maxTop) bubble.style.top = Math.max(0, maxTop) + 'px';
  });
  ```

**Rules:**
- Read ONLY the files listed above. Do NOT explore the codebase.
- Implement ONLY what is described. No extras, no refactoring.
- After implementing: npm run typecheck && npm run lint
- Fix ALL errors before finishing.
- Do NOT ask questions.

**Gate:** `npm run typecheck && npm run lint` passes. Minimize button collapses bubble to just the header bar. Expand button restores it. Quick action pills appear above the input and change based on the active social tab. Clicking an action pill sends the text as a message. Close button hides the bubble. Window resize keeps bubble in bounds.
CHUNK_7_PROMPT
)$context_section" < /dev/null 2>&1 | tee "$log"
}

# ══════════════════════════════════════════════════════
# MAIN LOOP
# ══════════════════════════════════════════════════════

CHUNK_FUNCTIONS=( run_chunk_1 run_chunk_2 run_chunk_3 run_chunk_4 run_chunk_5 run_chunk_6 run_chunk_7 )
CHUNK_NAMES=( "Remove Old Copilot Bar" "Bubble Container HTML + CSS" "Bubble Show/Hide + DOM Reparenting" "Bubble Dragging" "Bubble Resizing" "Session Picker Modal" "Bubble Minimize + Polish" )

for i in "${!CHUNK_FUNCTIONS[@]}"; do
  num=$((i + 1))

  if [[ "$num" -lt "$START_CHUNK" ]]; then
    echo -e "${YELLOW}  Skipping chunk $num${NC}"
    continue
  fi

  ${CHUNK_FUNCTIONS[$i]}
  run_quality_gate "$num"
  auto_commit "$num" "${CHUNK_NAMES[$i]}"
  capture_context

  ((CHUNKS_SINCE_CLEANUP++)) || true
  if [[ "$CLEANUP_EVERY" -gt 0 && "$CHUNKS_SINCE_CLEANUP" -ge "$CLEANUP_EVERY" ]]; then
    run_cleanup
    CHUNKS_SINCE_CLEANUP=0
  fi

  echo ""
done

echo -e "${GREEN}══════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  All chunks complete!${NC}"
echo -e "${GREEN}══════════════════════════════════════════════════════${NC}"

if [[ "$SKIP_FINAL_CHECK" != "true" ]]; then
  echo -e "${BLUE}Running final quality checks...${NC}"
  cd "$PROJECT_DIR"
  if eval "$CHECK_CMD"; then
    echo -e "${GREEN}✓ All checks passed${NC}"
  else
    echo -e "${RED}✗ Final checks failed — fix before committing${NC}"
    exit 1
  fi
fi

echo -e "${GREEN}Done! Review changes: git diff${NC}"
