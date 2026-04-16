/**
 * Shared provider configuration for LLM backends.
 * Single source of truth — imported by both coder mode (agent/index.ts)
 * and general/chat mode (chat-providers.ts).
 */

export type ProviderType = 'anthropic' | 'moonshot' | 'glm' | 'openrouter';

export interface ProviderConfig {
  /** OpenAI-compatible base URL (used by gg-ai chat engine in General mode) */
  baseUrl?: string;
  /** Anthropic-compatible base URL (used by Claude Agent SDK subprocess in Coder mode) */
  sdkBaseUrl?: string;
}

export const PROVIDER_CONFIGS: Record<ProviderType, ProviderConfig> = {
  anthropic: {
    // No baseUrl = uses default Anthropic endpoint for both modes
  },
  moonshot: {
    // General mode: gg-ai uses OpenAI-compat endpoint (no baseUrl = gg-ai default /v1)
    // Coder mode: SDK subprocess needs the Anthropic-compat endpoint
    sdkBaseUrl: 'https://api.moonshot.ai/anthropic',
  },
  glm: {
    // General mode: gg-ai uses OpenAI-compat endpoint
    // Coder mode: SDK subprocess needs the Anthropic-compat endpoint
    baseUrl: 'https://api.z.ai/api/paas/v4',
    sdkBaseUrl: 'https://api.z.ai/api/anthropic',
  },
  openrouter: {
    // OpenAI-compatible API — General mode only (no Coder mode support)
    baseUrl: 'https://openrouter.ai/api/v1',
  },
};

// Model to provider mapping
export const MODEL_PROVIDERS: Record<string, ProviderType> = {
  // Anthropic models
  'claude-opus-4-6': 'anthropic',
  'claude-opus-4-5-20251101': 'anthropic',
  'claude-sonnet-4-6': 'anthropic',
  'claude-haiku-4-5-20251001': 'anthropic',
  // Moonshot/Kimi models
  'kimi-k2.5': 'moonshot',
  // Z.AI GLM models
  'glm-5-turbo': 'glm',
  'glm-5': 'glm',
  'glm-4.7': 'glm',
  // OpenRouter models
  'moonshotai/kimi-k2.5': 'openrouter',
};

export function getProviderForModel(model: string): ProviderType {
  return MODEL_PROVIDERS[model] || 'anthropic';
}
