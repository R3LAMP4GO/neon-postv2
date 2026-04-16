# Neon Post

Desktop AI agent (Electron + Claude Agent SDK) — system tray app with persistent memory, Telegram integration, browser automation, social media management, and scheduled tasks.

## Tech Stack

Electron 40, TypeScript 5.9, Node.js, Claude Agent SDK, OpenAI (fallback), better-sqlite3, Puppeteer Core, Grammy (Telegram), Vitest, ESLint + Prettier

## Project Structure

```
src/
├── main/           # Electron main process, tray, windows
│   └── ipc/        # IPC handlers (agent, cron, social, sessions, settings)
├── agent/          # Claude Agent SDK wrapper, chat engine, providers
├── memory/         # SQLite persistence (messages, facts, embeddings, social, trends)
├── channels/       # Communication channels (Telegram, iOS relay)
├── scheduler/      # Cron jobs, social scheduling, notifications
├── browser/        # Browser automation (Electron + CDP)
├── tools/          # Agent tool implementations
├── config/         # Configuration and system prompts
├── settings/       # User preferences, schema, themes
├── auth/           # OAuth flows
├── permissions/    # Permission system
├── image/          # Image generation (Kie.ai) with job tracking
├── social/         # Social media (content, engagement, posting, scoring, scraping, video)
├── mcp/            # Model Context Protocol servers
└── utils/          # General helpers
ui/
├── chat/           # Chat interface (JS modules, CSS)
├── shared/         # Theme loader, base styles, CSS variables
└── *.html          # Feature pages (chat, settings, setup, cron, facts, soul, etc.)
tests/              # Vitest unit tests
scripts/            # Build and utility scripts
```

## Organization Rules

- Single responsibility per file, clear names, no monoliths
- New domain logic goes in its own `src/` subdirectory
- UI pages go in `ui/`, with JS/CSS modules in `ui/chat/`

## Code Quality — Zero Tolerance

After editing ANY file, run:

```bash
npm run typecheck && npm run lint
```

Fix ALL errors/warnings before continuing.

## Key Commands

```bash
npm run build          # Compile TypeScript
npm run dev            # Build + launch Electron
npm run test           # Run Vitest tests
npm run lint:fix       # Auto-fix lint issues
npm run format         # Prettier format
npm run dist:win       # Package Windows installer
```

**Phase:** Compositor Gallery — Complete (8/8)
