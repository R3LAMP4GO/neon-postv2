/**
 * Content Generation Prompts
 *
 * Template functions for generating social media content:
 * captions, hooks, threads, scripts, and engagement replies.
 *
 * Each function returns a fully-formed prompt string ready
 * to be sent to a language model. Brand voice and platform
 * constraints are baked in when provided.
 */

import type { Platform } from '../posting/types';

// ── Types ──

/** Context for content generation prompts */
export interface ContentPromptContext {
  /** The target social media platform */
  platform: Platform | string;
  /** Topic or subject of the content */
  topic: string;
  /** Brand voice description (from BrandConfig) */
  brandVoice?: string;
  /** Brand tone (e.g. "casual", "professional") */
  brandTone?: string;
  /** Target audience description */
  targetAudience?: string;
  /** Key themes to incorporate */
  themes?: string[];
  /** Hashtags to include */
  hashtags?: string[];
  /** Things to do / emphasize */
  dos?: string;
  /** Things to avoid */
  donts?: string;
  /** Example posts for style reference */
  examplePosts?: string;
  /** Additional instructions or constraints */
  additionalInstructions?: string;
}

/** Context for hook generation */
export interface HookPromptContext extends ContentPromptContext {
  /** Style of hook (question, bold claim, story, stat, etc.) */
  hookStyle?: 'question' | 'bold-claim' | 'story' | 'statistic' | 'controversial' | 'relatable';
  /** Number of hook variations to generate */
  count?: number;
}

/** Context for thread generation */
export interface ThreadPromptContext extends ContentPromptContext {
  /** Number of posts in the thread */
  threadLength?: number;
  /** Format: numbered list, storytelling, educational, etc. */
  format?: 'numbered' | 'storytelling' | 'educational' | 'tips' | 'hot-takes';
}

/** Context for video script generation */
export interface ScriptPromptContext extends ContentPromptContext {
  /** Desired video duration in seconds */
  durationSeconds?: number;
  /** Script format */
  format?: 'talking-head' | 'voiceover' | 'skit' | 'tutorial' | 'storytime';
  /** Whether to include visual directions / b-roll notes */
  includeVisualNotes?: boolean;
}

/** Context for reply generation */
export interface ReplyPromptContext {
  /** The platform the comment is on */
  platform: Platform | string;
  /** The original comment text */
  commentText: string;
  /** The author of the comment */
  commentAuthor: string;
  /** The original post's content (for context) */
  originalPostText?: string;
  /** Brand voice description */
  brandVoice?: string;
  /** Brand tone */
  brandTone?: string;
  /** Number of reply variations to generate */
  count?: number;
}

/** Context for repurposing content across platforms */
export interface RepurposePromptContext extends ContentPromptContext {
  /** The original post caption/text */
  sourceContent: string;
  /** Where the content came from */
  sourcePlatform: string;
  /** Performance stats from the source post */
  sourceStats?: { likes: number; comments: number; shares: number; views: number };
  /** Video transcript if available */
  sourceTranscript?: string;
  /** Platforms to repurpose for */
  targetPlatforms: string[];
}

// ── Helpers ──

function brandBlock(ctx: ContentPromptContext): string {
  const parts: string[] = [];

  if (ctx.brandVoice) parts.push(`Voice: ${ctx.brandVoice}`);
  if (ctx.brandTone) parts.push(`Tone: ${ctx.brandTone}`);
  if (ctx.targetAudience) parts.push(`Target Audience: ${ctx.targetAudience}`);
  if (ctx.themes?.length) parts.push(`Key Themes: ${ctx.themes.join(', ')}`);
  if (ctx.dos) parts.push(`DO: ${ctx.dos}`);
  if (ctx.donts) parts.push(`DON'T: ${ctx.donts}`);
  if (ctx.examplePosts) parts.push(`Example Posts for Reference:\n${ctx.examplePosts}`);

  return parts.length > 0 ? `\n## Brand Guidelines\n${parts.join('\n')}\n` : '';
}

function platformConstraints(platform: Platform | string): string {
  switch (platform) {
    case 'tiktok':
      return 'TikTok captions: max 2200 characters. Use trending sounds/hashtag references when relevant. Short, punchy, Gen-Z friendly language works best.';
    case 'youtube':
      return 'YouTube descriptions: max 5000 characters. Front-load key info in the first 2 lines (shown before "Show More"). Include timestamps, links, and CTAs.';
    case 'instagram':
      return 'Instagram captions: max 2200 characters. First line is the hook (shown in feed). Use line breaks for readability. Up to 30 hashtags allowed (use 5-15 strategically).';
    case 'x':
    case 'twitter':
      return 'X/Twitter posts: max 280 characters. Threads can be longer. Be concise and punchy. Engagement comes from takes, questions, and relatable observations.';
    case 'linkedin':
      return 'LinkedIn posts: max 3000 characters. Professional but personable. First 2-3 lines are critical (shown before "see more"). Use line breaks liberally.';
    default:
      return `Platform: ${platform}. Adapt content to platform-appropriate style and length.`;
  }
}

function hashtagBlock(hashtags?: string[]): string {
  if (!hashtags?.length) return '';
  return `\nHashtags to include: ${hashtags.map((h) => (h.startsWith('#') ? h : `#${h}`)).join(' ')}`;
}

// ── Prompt Templates ──

/**
 * Generate a caption prompt for a social media post.
 */
export function captionPrompt(ctx: ContentPromptContext): string {
  return `You are a social media content creator.

Write a compelling caption for a ${ctx.platform} post about: ${ctx.topic}

## Platform Rules
${platformConstraints(ctx.platform)}
${brandBlock(ctx)}${hashtagBlock(ctx.hashtags)}
${ctx.additionalInstructions ? `\n## Additional Instructions\n${ctx.additionalInstructions}\n` : ''}
## Output
Write ONLY the caption text. No explanations, no meta-commentary. Just the ready-to-post caption.`;
}

/**
 * Generate hook variations for social media posts.
 */
export function hookPrompt(ctx: HookPromptContext): string {
  const count = ctx.count ?? 5;
  const styleInstruction = ctx.hookStyle
    ? `Focus on "${ctx.hookStyle}" style hooks.`
    : 'Mix different styles: questions, bold claims, relatable observations, statistics, and story openers.';

  return `You are a social media hook specialist.

Generate ${count} compelling hooks for a ${ctx.platform} post about: ${ctx.topic}

## What Makes a Great Hook
- Stops the scroll in the first 1-2 seconds
- Creates curiosity, urgency, or emotional resonance
- Makes the reader NEED to keep reading/watching
- Feels authentic, not clickbaity

## Style
${styleInstruction}

## Platform Rules
${platformConstraints(ctx.platform)}
${brandBlock(ctx)}
${ctx.additionalInstructions ? `\n## Additional Instructions\n${ctx.additionalInstructions}\n` : ''}
## Output
Return exactly ${count} hooks, numbered 1-${count}. Each hook should be 1-2 sentences max. No explanations.`;
}

/**
 * Generate a thread / carousel prompt.
 */
export function threadPrompt(ctx: ThreadPromptContext): string {
  const length = ctx.threadLength ?? 7;
  const format = ctx.format ?? 'educational';

  const formatInstructions: Record<string, string> = {
    numbered: 'Use a clear numbered list format. Each post covers one key point.',
    storytelling: 'Tell a story across the thread. Build tension, deliver a payoff.',
    educational: 'Teach something valuable. Start with context, build knowledge progressively.',
    tips: 'Share actionable tips. Each post = one tip with a brief explanation.',
    'hot-takes':
      'Share bold opinions. Each post should be a standalone take that sparks discussion.',
  };

  return `You are a social media thread/carousel expert.

Create a ${length}-part ${ctx.platform} thread about: ${ctx.topic}

## Format: ${format}
${formatInstructions[format] ?? formatInstructions.educational}

## Thread Structure
- Post 1: The HOOK — must stop the scroll and make people want to read the whole thread
- Posts 2-${length - 1}: The BODY — deliver value, each post stands alone but flows into the next
- Post ${length}: The CLOSER — wrap up with a CTA, question, or memorable takeaway

## Platform Rules
${platformConstraints(ctx.platform)}
${brandBlock(ctx)}${hashtagBlock(ctx.hashtags)}
${ctx.additionalInstructions ? `\n## Additional Instructions\n${ctx.additionalInstructions}\n` : ''}
## Output
Return exactly ${length} posts, clearly separated with "---" between each. Each post should respect platform character limits.`;
}

/**
 * Generate a video script prompt.
 */
export function scriptPrompt(ctx: ScriptPromptContext): string {
  const duration = ctx.durationSeconds ?? 60;
  const format = ctx.format ?? 'talking-head';
  const visualNotes = ctx.includeVisualNotes !== false;

  const formatInstructions: Record<string, string> = {
    'talking-head': 'Direct-to-camera delivery. Conversational, energetic, authentic.',
    voiceover: 'Voiceover narration with visual directions for b-roll and graphics.',
    skit: 'Short comedy/drama skit. Include character notes and staging directions.',
    tutorial: 'Step-by-step walkthrough. Clear, concise instructions with visual cues.',
    storytime: 'Personal story format. Build narrative arc: setup → tension → resolution.',
  };

  const wordsPerSecond = 2.5; // Average speaking pace
  const targetWords = Math.round(duration * wordsPerSecond);

  return `You are a video script writer for short-form social content.

Write a ${duration}-second ${ctx.platform} video script about: ${ctx.topic}

## Format: ${format}
${formatInstructions[format] ?? formatInstructions['talking-head']}

## Constraints
- Target length: ~${targetWords} words (${duration} seconds at natural pace)
- HOOK in the first 3 seconds — the most critical moment
- Every sentence must earn its place — cut anything that doesn't move the viewer forward
- End with a clear CTA (follow, comment, share, or save)
${visualNotes ? '- Include [VISUAL] notes for b-roll, text overlays, or transitions\n' : ''}
## Platform Rules
${platformConstraints(ctx.platform)}
${brandBlock(ctx)}
${ctx.additionalInstructions ? `\n## Additional Instructions\n${ctx.additionalInstructions}\n` : ''}
## Output
Write the script with clear sections:
**HOOK** (0-3s)
**BODY** (3-${duration - 5}s)
**CTA** (last 5s)
${visualNotes ? '\nInclude [VISUAL: description] markers inline where relevant.' : ''}`;
}

/**
 * Generate a reply to a social media comment.
 */
export function replyPrompt(ctx: ReplyPromptContext): string {
  const count = ctx.count ?? 3;

  return `You are replying to a comment on ${ctx.platform} as the content creator.
${ctx.originalPostText ? `\n## Original Post\n${ctx.originalPostText}\n` : ''}
## Comment by @${ctx.commentAuthor}
"${ctx.commentText}"
${ctx.brandVoice ? `\n## Voice\n${ctx.brandVoice}` : ''}${ctx.brandTone ? `\nTone: ${ctx.brandTone}` : ''}

## Reply Guidelines
- Be authentic and personable — not robotic or corporate
- Match the energy of the comment
- If it's a question, answer helpfully
- If it's positive, show genuine appreciation
- If it's negative/trolling, respond with grace or humor (never defensively)
- Keep replies short — 1-2 sentences max
- Don't use hashtags in replies

## Output
Generate ${count} reply options, numbered 1-${count}. No explanations, just the replies.`;
}

/**
 * Generate a prompt to repurpose content across platforms.
 */
export function repurposePrompt(ctx: RepurposePromptContext): string {
  const statsBlock = ctx.sourceStats
    ? `\n## Source Performance\n- Likes: ${ctx.sourceStats.likes}\n- Comments: ${ctx.sourceStats.comments}\n- Shares: ${ctx.sourceStats.shares}\n- Views: ${ctx.sourceStats.views}\n`
    : '';

  const transcriptBlock = ctx.sourceTranscript
    ? `\n## Source Transcript\n${ctx.sourceTranscript}\n`
    : '';

  const platformInstructions: Record<string, string> = {
    x: '**X/Twitter:** Max 280 characters. Distill the core insight into a punchy, shareable take. Use a thread if the idea needs more room.',
    twitter:
      '**X/Twitter:** Max 280 characters. Distill the core insight into a punchy, shareable take. Use a thread if the idea needs more room.',
    instagram:
      '**Instagram:** Write a caption with a strong hook line. Include 15-20 relevant hashtags. Suggest a visual format (carousel, reel, single image).',
    tiktok:
      '**TikTok:** Write a short video script with a clear HOOK (first 3s), BODY, and CTA. Keep it under 60 seconds. Include trending sound/hashtag suggestions.',
    linkedin:
      '**LinkedIn:** Reframe the content professionally. Lead with a bold first line. Use line breaks for readability. End with a question or CTA to drive engagement.',
    youtube:
      '**YouTube:** Adapt as a video concept with a compelling title, description, and key talking points. Include timestamps structure.',
  };

  const targetBlocks = ctx.targetPlatforms
    .map((p) => platformInstructions[p.toLowerCase()] ?? `**${p}:** Adapt to platform-appropriate style and length.`)
    .join('\n\n');

  return `You are a social media content repurposing specialist.

## Source Content (from ${ctx.sourcePlatform})
${ctx.sourceContent}
${statsBlock}${transcriptBlock}
## Topic
${ctx.topic}
${brandBlock(ctx)}
## Target Platforms — Per-Platform Instructions

${targetBlocks}

## Repurposing Guidelines
- Preserve the core message and value of the original content
- Adapt the format, tone, and length to each target platform's native style
- Don't just copy-paste — reimagine the content for each audience
- If the source performed well, analyze what made it resonate and carry that forward
${ctx.additionalInstructions ? `\n## Additional Instructions\n${ctx.additionalInstructions}\n` : ''}
## Output
For each target platform, output a clearly labeled section:

### [Platform Name]
[Ready-to-post content for that platform]

---

Produce content for ALL ${ctx.targetPlatforms.length} target platform(s): ${ctx.targetPlatforms.join(', ')}.`;
}

/** Context for cold upload finalization */
export interface ColdUploadPromptContext {
  /** Video transcript text */
  transcript: string;
  /** Target platform */
  platform: Platform | string;
  /** Brand voice description */
  brandVoice?: string;
  /** Brand tone */
  brandTone?: string;
  /** Target audience description */
  targetAudience?: string;
  /** Key themes */
  themes?: string[];
  /** Hashtags to include */
  hashtags?: string[];
  /** Things to do / emphasize */
  dos?: string;
  /** Things to avoid */
  donts?: string;
  /** Example posts for style reference */
  examplePosts?: string;
}

/**
 * Generate copy, captions, and hashtags from a video transcript for a cold upload.
 * Different from repurpose — this is original content from the user's own video.
 */
export function coldUploadPrompt(ctx: ColdUploadPromptContext): string {
  const brandParts: string[] = [];
  if (ctx.brandVoice) brandParts.push(`Voice: ${ctx.brandVoice}`);
  if (ctx.brandTone) brandParts.push(`Tone: ${ctx.brandTone}`);
  if (ctx.targetAudience) brandParts.push(`Target Audience: ${ctx.targetAudience}`);
  if (ctx.themes?.length) brandParts.push(`Key Themes: ${ctx.themes.join(', ')}`);
  if (ctx.dos) brandParts.push(`DO: ${ctx.dos}`);
  if (ctx.donts) brandParts.push(`DON'T: ${ctx.donts}`);
  if (ctx.examplePosts) brandParts.push(`Example Posts for Reference:\n${ctx.examplePosts}`);

  const brandSection = brandParts.length > 0 ? `\n## Brand Guidelines\n${brandParts.join('\n')}\n` : '';

  return `You are a social media content creator. You have a video transcript from the user's own content. Generate platform-optimized copy, captions, and hashtags for posting this video.

## Transcript
${ctx.transcript}

## Platform Rules
${platformConstraints(ctx.platform)}
${brandSection}
## Output Format
Respond in valid JSON only. No markdown, no explanation. Use this exact structure:
{
  "copy": "The main post caption/copy text",
  "hashtags": ["hashtag1", "hashtag2", "..."],
  "captions": "Short-form captions or subtitle text for the video"
}

Guidelines:
- "copy" is the primary post text — hook + value + CTA, optimized for ${ctx.platform}
- "hashtags" — 5-15 relevant hashtags (without # prefix) that maximize discoverability
- "captions" — a concise summary or subtitle overlay text for the video itself
- Base everything on what the speaker actually says in the transcript
- This is the user's ORIGINAL content — write as if you are the creator, not repurposing someone else's work`;
}

/** Context for refining a draft with video transcript */
export interface RefinePromptContext {
  /** The existing draft copy */
  existingCopy: string;
  /** The video transcript */
  transcript: string;
  /** Target platform */
  platform: Platform | string;
  /** Brand voice description */
  brandVoice?: string;
  /** Brand tone */
  brandTone?: string;
  /** Target audience description */
  targetAudience?: string;
  /** Key themes */
  themes?: string[];
}

/**
 * Generate a prompt to refine existing copy using the actual video transcript.
 * Returns improved copy that better matches the video content.
 */
export function refinePrompt(ctx: RefinePromptContext): string {
  const brandParts: string[] = [];
  if (ctx.brandVoice) brandParts.push(`Voice: ${ctx.brandVoice}`);
  if (ctx.brandTone) brandParts.push(`Tone: ${ctx.brandTone}`);
  if (ctx.targetAudience) brandParts.push(`Target Audience: ${ctx.targetAudience}`);
  if (ctx.themes?.length) brandParts.push(`Key Themes: ${ctx.themes.join(', ')}`);

  const brandSection =
    brandParts.length > 0 ? `\n## Brand Guidelines\n${brandParts.join('\n')}\n` : '';

  return `You are a social media content editor. You have an existing draft caption and the actual video transcript. Refine the copy to better match what's said in the video while keeping it optimized for the platform.

## Current Draft
${ctx.existingCopy}

## Video Transcript
${ctx.transcript}

## Platform Rules
${platformConstraints(ctx.platform)}
${brandSection}
## Instructions
- Keep the same general tone and style as the current draft
- Update facts, quotes, or references to accurately reflect the video content
- Improve the hook if the transcript reveals a stronger angle
- Maintain platform-appropriate length and formatting
- Keep hashtags if present, adjusting only if the transcript suggests better ones

## Output
Respond in valid JSON only. No markdown, no explanation. Use this exact structure:
{
  "copy": "The refined post caption/copy text"
}`;
}

/**
 * Generate a content idea brainstorm prompt.
 */
export function ideaBrainstormPrompt(ctx: ContentPromptContext & { count?: number }): string {
  const count = ctx.count ?? 10;

  return `You are a social media content strategist.

Brainstorm ${count} content ideas for ${ctx.platform} about: ${ctx.topic}

${brandBlock(ctx)}
## Requirements
- Each idea should be specific and actionable (not vague like "post about X")
- Include a mix of formats: educational, entertaining, relatable, controversial, personal
- Consider what performs well on ${ctx.platform} specifically
- Each idea should include: a brief title and a 1-sentence description

${ctx.additionalInstructions ? `## Additional Instructions\n${ctx.additionalInstructions}\n` : ''}
## Output
Return ${count} content ideas, numbered 1-${count}. Format each as:
**[number]. [Title]** — [Description]`;
}
