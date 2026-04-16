# Neon Post

Desktop AI agent with persistent memory, social media management, and browser automation.

Built with Electron + Claude Agent SDK + SQLite + TypeScript.

## Features

- **AI Chat** — Claude-powered assistant with persistent memory and multi-session support
- **Social Media Content Creator** — scrape, score, transcribe, and repurpose content across platforms
- **Image Generation** — Kie.ai integration with job tracking and gallery
- **Post Compositor** — visual template editor for social media posts with image/video overlays
- **Browser Automation** — Puppeteer-powered web interaction
- **Telegram Integration** — bidirectional messaging via Grammy
- **Scheduling** — cron-based task automation and content scheduling
- **Floating Bubble UI** — draggable, resizable chat interface with session switching

## Quick Start

```bash
npm install
npm run dev
```

## Commands

```bash
npm run build          # Compile TypeScript
npm run dev            # Build + launch Electron
npm run test           # Run Vitest tests
npm run lint:fix       # Auto-fix lint issues
npm run format         # Prettier format
npm run dist:win       # Package Windows installer
```

## Stack

Electron 40, TypeScript 5.9, Node.js, Claude Agent SDK, better-sqlite3, Puppeteer Core, Grammy, Vitest

## License

MIT
