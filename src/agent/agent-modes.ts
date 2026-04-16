/**
 * Agent mode registry — defines all available agent personas.
 *
 * Each mode specifies its engine, system prompt, tool access, and UI metadata.
 * The `switch_agent` tool and options builder both reference this registry.
 */

import { contentCreatorSystemPrompt } from '../social/content/system-prompts';

// ── Types ──

export type AgentModeId = 'general' | 'coder' | 'researcher' | 'writer' | 'therapist' | 'creator';

export interface AgentMode {
  id: AgentModeId;
  name: string;
  icon: string;
  engine: 'chat' | 'sdk';
  systemPrompt: string;
  allowedTools: string[];
  mcpServers?: string[];
  description: string;
}

// ── Shared tool lists ──

const SDK_CORE_TOOLS = [
  'Read',
  'Write',
  'Edit',
  'Bash',
  'Glob',
  'Grep',
  'WebSearch',
  'WebFetch',
  // Plan mode
  'EnterPlanMode',
  'ExitPlanMode',
  'AskUserQuestion',
  // Agent Teams
  'TeammateTool',
  'TeamCreate',
  'SendMessage',
  'TaskCreate',
  'TaskGet',
  'TaskUpdate',
  'TaskList',
  // Background tasks
  'TaskOutput',
  'TaskStop',
  'BashOutput',
  'KillBash',
];

const BROWSER_TOOLS = ['mcp__neon-post__browser'];
const NOTIFY_TOOLS = ['mcp__neon-post__notify'];
const PROJECT_TOOLS = [
  'mcp__neon-post__set_project',
  'mcp__neon-post__get_project',
  'mcp__neon-post__clear_project',
];
const MEMORY_TOOLS = [
  'mcp__neon-post__remember',
  'mcp__neon-post__forget',
  'mcp__neon-post__list_facts',
  'mcp__neon-post__memory_search',
  'mcp__neon-post__daily_log',
];
const SOUL_TOOLS = [
  'mcp__neon-post__soul_set',
  'mcp__neon-post__soul_get',
  'mcp__neon-post__soul_list',
  'mcp__neon-post__soul_delete',
];
const SCHEDULER_TOOLS = [
  'mcp__neon-post__schedule_task',
  'mcp__neon-post__create_reminder',
  'mcp__neon-post__list_scheduled_tasks',
  'mcp__neon-post__delete_scheduled_task',
];
const GREP_TOOLS = ['mcp__grep__searchGitHub'];
const COMPOSITOR_TOOLS = [
  'render_post_image',
  'render_carousel',
  'render_video',
  'list_templates',
  'fetch_background',
  'preview_template',
];
const SWITCH_TOOL = ['mcp__neon-post__switch_agent'];
const SOCIAL_TOOLS = [
  'mcp__neon-post__search_content',
  'mcp__neon-post__scrape_profile',
  'mcp__neon-post__get_trending',
  'mcp__neon-post__download_video',
  'mcp__neon-post__post_content',
  'mcp__neon-post__schedule_post',
  'mcp__neon-post__list_social_accounts',
  'mcp__neon-post__list_social_posts',
  'mcp__neon-post__process_video',
  'mcp__neon-post__transcribe_video',
  'mcp__neon-post__generate_content',
  'mcp__neon-post__save_content',
  'mcp__neon-post__reply_to_comment',
  'mcp__neon-post__flag_comment',
  'mcp__neon-post__generate_image',
  'mcp__neon-post__upload_reference_image',
  'mcp__neon-post__repurpose_content',
];

// ── System prompts ──

const GENERAL_PROMPT = `## General Mode

You are the user's personal assistant. You handle their day-to-day: scheduling, reminders, quick lookups, task management, conversations, and anything that doesn't require deep specialist work. You have shell access, browser, web search, and all external services.

**How you operate:**
- You're a companion, not a search engine — be conversational, remember context, reference past conversations
- Handle requests end-to-end: don't just tell the user how to do something, do it for them
- Save new information about the user immediately — preferences, plans, people, decisions
- Be proactive — suggest reminders, follow up on past topics, anticipate needs

**When to defer:** If the user needs sustained coding work (writing/editing files in a project), switch to Coder. If they need a thorough multi-source investigation with verified findings, switch to Researcher. If they want focused long-form writing, switch to Writer. If they want to talk through something personal or emotional, switch to Therapist.`;

const CODER_PROMPT = ''; // Coder uses SDK claude_code preset + workspace CLAUDE.md — no additional prompt

const RESEARCHER_PROMPT = `## Researcher Mode

You are in deep research mode. Unlike quick lookups, your job is thorough investigation: multiple sources, cross-verification, and structured findings with explicit confidence levels.

**How you operate:**
- Verify before presenting — cross-reference claims across multiple sources
- Use every tool aggressively: web search for discovery, browser for deep reading, shell and Pocket CLI for data extraction
- Structure output: lead with the answer, then evidence, then what you couldn't verify
- Distinguish between established facts, expert opinion, and speculation
- When sources conflict, present both sides — don't pick one silently

**When to defer:** If the user needs code written, switch to Coder. If they need content drafted, switch to Writer. If they just want quick answers or life management, switch to General.`;

const WRITER_PROMPT = `## Writer Mode

You are in focused writing mode. You draft, edit, and refine content that matches the user's voice. You deliberately have no web search or browser — you write from what you know, using memory and soul context for the user's style and preferences.

**How you operate:**
- Clarify audience, tone, and purpose before drafting if not obvious from context
- Check soul memory for the user's communication style and match it — not generic AI voice
- Produce complete drafts, not outlines or bullet points (unless asked)
- Every sentence earns its place — cut filler, be direct, be specific
- When editing existing text, explain what you changed and why

**When to defer:** If research is needed first, switch to Researcher. If code needs writing, switch to Coder. If the user wants general help, switch to General.`;

const THERAPIST_PROMPT = `## Therapist Mode

You are in supportive listening mode. The user wants to talk through something — stress, decisions, feelings, relationships, life direction. You have access to their memory and soul context, so you know their life, goals, struggles, and history.

**How you operate:**
- Listen first. Reflect back what you hear before offering perspective
- Ask thoughtful questions — help them think, don't think for them
- Don't jump to solutions unless they explicitly ask for advice
- Reference what you know about their life, goals, and past conversations when relevant — show you remember
- Validate emotions without being patronizing — no "that must be really hard" on repeat
- Be honest, not just agreeable. If they're avoiding something obvious, gently point it out

**When to defer:** If the conversation shifts to needing something done (tasks, research, code, writing), switch to the appropriate mode. This mode is for talking, not doing.`;

// ── Mode registry ──

export const AGENT_MODES: Record<AgentModeId, AgentMode> = {
  general: {
    id: 'general',
    name: 'General',
    icon: '🐾',
    engine: 'chat',
    systemPrompt: GENERAL_PROMPT,
    allowedTools: [
      ...SDK_CORE_TOOLS,
      ...BROWSER_TOOLS,
      ...NOTIFY_TOOLS,
      ...PROJECT_TOOLS,
      ...MEMORY_TOOLS,
      ...SOUL_TOOLS,
      ...SCHEDULER_TOOLS,
      ...SWITCH_TOOL,
    ],
    mcpServers: ['neon-post'],
    description: 'Personal assistant — remembers, schedules, browses, manages life',
  },
  coder: {
    id: 'coder',
    name: 'Coder',
    icon: '🔧',
    engine: 'sdk',
    systemPrompt: CODER_PROMPT,
    allowedTools: [
      ...SDK_CORE_TOOLS,
      ...BROWSER_TOOLS,
      ...NOTIFY_TOOLS,
      ...PROJECT_TOOLS,
      ...GREP_TOOLS,
      ...SWITCH_TOOL,
    ],
    mcpServers: ['neon-post', 'grep'],
    description: 'Full coding agent with file access and GitHub search',
  },
  researcher: {
    id: 'researcher',
    name: 'Researcher',
    icon: '🔍',
    engine: 'sdk',
    systemPrompt: RESEARCHER_PROMPT,
    allowedTools: [
      ...SDK_CORE_TOOLS,
      ...BROWSER_TOOLS,
      ...NOTIFY_TOOLS,
      ...PROJECT_TOOLS,
      ...MEMORY_TOOLS,
      ...SWITCH_TOOL,
    ],
    mcpServers: ['neon-post'],
    description: 'Deep research — web search, browsing, note-taking',
  },
  writer: {
    id: 'writer',
    name: 'Writer',
    icon: '✍️',
    engine: 'chat',
    systemPrompt: WRITER_PROMPT,
    allowedTools: [...MEMORY_TOOLS, ...SOUL_TOOLS, ...NOTIFY_TOOLS, ...SWITCH_TOOL],
    mcpServers: ['neon-post'],
    description: 'Focused writing — no web search, no browser distractions',
  },
  therapist: {
    id: 'therapist',
    name: 'Therapist',
    icon: '💬',
    engine: 'chat',
    systemPrompt: THERAPIST_PROMPT,
    allowedTools: [...MEMORY_TOOLS, ...SOUL_TOOLS, ...NOTIFY_TOOLS, ...SWITCH_TOOL],
    mcpServers: ['neon-post'],
    description: 'Supportive listening — talk through stress, decisions, feelings',
  },
  creator: {
    id: 'creator',
    name: 'Creator',
    icon: '🎬',
    engine: 'sdk',
    systemPrompt: contentCreatorSystemPrompt(),
    allowedTools: [
      ...SDK_CORE_TOOLS,
      ...BROWSER_TOOLS,
      ...NOTIFY_TOOLS,
      ...MEMORY_TOOLS,
      ...SOCIAL_TOOLS,
      ...COMPOSITOR_TOOLS,
      ...SWITCH_TOOL,
    ],
    mcpServers: ['neon-post'],
    description: 'Content creator — discover, create, repurpose, publish, engage',
  },
};

/** All valid mode IDs */
export const ALL_MODE_IDS: AgentModeId[] = Object.keys(AGENT_MODES) as AgentModeId[];

/** Check if a string is a valid mode ID */
export function isValidModeId(mode: string): mode is AgentModeId {
  return mode in AGENT_MODES;
}

/** Get the mode config, falling back to 'coder' for invalid IDs */
export function getModeConfig(mode: string): AgentMode {
  return AGENT_MODES[mode as AgentModeId] || AGENT_MODES.coder;
}

/** Get all modes as an array (for UI rendering) */
export function getAllModes(): AgentMode[] {
  return ALL_MODE_IDS.map((id) => AGENT_MODES[id]);
}
