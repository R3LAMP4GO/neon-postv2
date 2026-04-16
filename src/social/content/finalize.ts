/**
 * Cold Upload Finalization
 *
 * Takes a video transcript + target platform, calls Claude to generate
 * platform-optimized copy, captions, and hashtags.
 */

import Anthropic from '@anthropic-ai/sdk';
import { SettingsManager } from '../../settings/index.js';
import { coldUploadPrompt } from './prompts.js';
import type { ColdUploadPromptContext } from './prompts.js';
import type { BrandConfig } from '../../memory/brand-config.js';

export interface FinalizedDraft {
  copy: string;
  hashtags: string[];
  captions: string;
}

/**
 * Call Claude with the cold upload prompt and parse the response into
 * structured copy, hashtags, and captions.
 */
export async function finalizeDraft(
  transcript: string,
  platform: string,
  brandConfig?: BrandConfig | null
): Promise<FinalizedDraft> {
  const apiKey = SettingsManager.get('anthropic.apiKey');
  if (!apiKey) throw new Error('Anthropic API key not configured');

  const ctx: ColdUploadPromptContext = {
    transcript,
    platform,
    ...(brandConfig && {
      brandVoice: brandConfig.voice ?? undefined,
      brandTone: brandConfig.tone ?? undefined,
      targetAudience: brandConfig.target_audience ?? undefined,
      themes: brandConfig.themes ? brandConfig.themes.split(',').map((t) => t.trim()) : undefined,
      hashtags: brandConfig.hashtags ? brandConfig.hashtags.split(',').map((h) => h.trim()) : undefined,
      dos: brandConfig.dos ?? undefined,
      donts: brandConfig.donts ?? undefined,
      examplePosts: brandConfig.example_posts ?? undefined,
    }),
  };

  const prompt = coldUploadPrompt(ctx);
  const model = SettingsManager.get('agent.model') || 'claude-3-5-haiku-20241022';

  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model,
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  });

  const output = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();

  // Parse JSON response
  try {
    const parsed = JSON.parse(output) as { copy?: string; hashtags?: string[]; captions?: string };
    return {
      copy: parsed.copy || '',
      hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags : [],
      captions: parsed.captions || '',
    };
  } catch {
    // Fallback: use raw output as copy if JSON parsing fails
    return {
      copy: output,
      hashtags: [],
      captions: '',
    };
  }
}
