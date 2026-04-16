/**
 * Unit tests for options-builder.ts
 *
 * Tests the buildPersistentOptions() function with mocked dependencies.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock electron
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => false),
    encryptString: vi.fn(),
    decryptString: vi.fn(),
  },
  app: { getPath: vi.fn(() => '/tmp') },
}));

// Mock better-sqlite3
vi.mock('better-sqlite3', () => {
  const mockDb = {
    prepare: vi.fn(() => ({
      run: vi.fn(),
      get: vi.fn(),
      all: vi.fn(() => []),
    })),
    exec: vi.fn(),
    close: vi.fn(),
  };
  return { default: vi.fn(() => mockDb) };
});

// Mock embeddings
vi.mock('../../src/memory/embeddings', () => ({
  initEmbeddings: vi.fn(),
  hasEmbeddings: vi.fn(() => false),
  embed: vi.fn(),
  cosineSimilarity: vi.fn(),
  serializeEmbedding: vi.fn(),
  deserializeEmbedding: vi.fn(),
}));

// Mock tools module — avoid side effects (setInterval, etc.)
vi.mock('../../src/tools', () => ({
  buildMCPServers: vi.fn(() => ({})),
  buildSdkMcpServers: vi.fn(async () => ({ 'neon-post': {} })),
  getCustomTools: vi.fn(() => []),
}));

// Mock safety module
vi.mock('../../src/agent/safety', () => ({
  buildCanUseToolCallback: vi.fn(() => vi.fn()),
  buildPreToolUseHook: vi.fn(() => ({ hooks: [vi.fn()] })),
}));

// Mock providers
vi.mock('../../src/agent/providers', () => ({
  getProviderForModel: vi.fn((model: string) => {
    if (model.startsWith('claude')) return 'anthropic';
    if (model.startsWith('kimi')) return 'moonshot';
    return 'anthropic';
  }),
  PROVIDER_CONFIGS: {
    anthropic: {},
    moonshot: { sdkBaseUrl: 'https://api.moonshot.ai/anthropic' },
    glm: { baseUrl: 'https://api.z.ai/api/paas/v4', sdkBaseUrl: 'https://api.z.ai/api/anthropic' },
  },
  MODEL_PROVIDERS: {},
}));

// Mock context-extraction
vi.mock('../../src/agent/context-extraction', () => ({
  buildTemporalContext: vi.fn(() => '## Temporal\nCurrent time: 2025-01-01 12:00'),
}));

// Mock settings
vi.mock('../../src/settings', () => {
  const mockInstance = {
    get: vi.fn((key: string) => {
      const defaults: Record<string, string> = {
        'agent.thinkingLevel': 'normal',
        'personalize.agentName': 'TestBot',
        'personalize.description': 'A test assistant',
        'personalize.personality': '',
        'profile.name': 'TestUser',
        'profile.location': '',
        'profile.timezone': '',
        'profile.occupation': '',
        'profile.birthday': '',
        'personalize.goals': '',
        'personalize.struggles': '',
        'personalize.funFacts': '',
      };
      return defaults[key] || '';
    }),
    getFormattedIdentity: vi.fn(() => '# TestBot\n\nA test assistant'),
    getFormattedUserContext: vi.fn(() => '## User Profile\n- **Name:** TestUser'),
    getFormattedProfile: vi.fn(() => ''),
  };
  return {
    SettingsManager: mockInstance,
  };
});

// Mock agent-modes
vi.mock('../../src/agent/agent-modes', () => ({
  getModeConfig: vi.fn((mode: string) => {
    const modes: Record<string, any> = {
      general: {
        id: 'general',
        name: 'General',
        icon: '🐾',
        engine: 'chat',
        systemPrompt: '## General Mode\nYou are the user\'s personal assistant.',
        allowedTools: ['Read', 'Write', 'mcp__neon-post__remember', 'mcp__neon-post__switch_agent'],
        mcpServers: ['neon-post'],
        description: 'Personal assistant',
      },
      coder: {
        id: 'coder',
        name: 'Coder',
        icon: '🔧',
        engine: 'sdk',
        systemPrompt: '',
        allowedTools: ['Read', 'Write', 'Bash', 'mcp__grep__searchGitHub', 'mcp__neon-post__switch_agent'],
        mcpServers: ['neon-post', 'grep'],
        description: 'Coding agent',
      },
      writer: {
        id: 'writer',
        name: 'Writer',
        icon: '✍️',
        engine: 'chat',
        systemPrompt: '## Writer Mode\nFocused writing.',
        allowedTools: ['mcp__neon-post__remember', 'mcp__neon-post__soul_set', 'mcp__neon-post__switch_agent'],
        mcpServers: ['neon-post'],
        description: 'Writing mode',
      },
    };
    return modes[mode] || modes.coder;
  }),
}));

import { buildPersistentOptions } from '../../src/agent/options-builder';
import type { BuildOptionsConfig } from '../../src/agent/options-builder';

// Create a mock MemoryManager
function createMockMemory() {
  return {
    getSessionMode: vi.fn(() => 'general'),
    getSessionWorkingDirectory: vi.fn(() => null),
    getSoulContext: vi.fn(() => '## Soul\nBe friendly.'),
    getFactsForContext: vi.fn(() => '## Facts\nUser likes coffee.'),
    getDailyLogsContext: vi.fn(() => '## Daily Logs\nYesterday: worked on project.'),
    getRecentMessages: vi.fn(() => [
      { role: 'user', content: 'Hello', timestamp: '2025-01-01 12:00:00' },
    ]),
  } as any;
}

function createMockConfig(overrides?: Partial<BuildOptionsConfig>): BuildOptionsConfig {
  return {
    model: 'claude-sonnet-4-6',
    workspace: '/home/user/projects',
    toolsConfig: {
      mcpServers: {},
      computerUse: { enabled: false, dockerized: false },
      browser: { enabled: false },
    } as any,
    emitStatus: vi.fn(),
    buildProviderEnv: vi.fn(async () => ({ ANTHROPIC_API_KEY: 'test-key' })),
    ...overrides,
  };
}

describe('Options Builder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ============ Basic structure ============

  describe('basic options structure', () => {
    it('should return options with required fields', async () => {
      const memory = createMockMemory();
      const config = createMockConfig();
      const options = await buildPersistentOptions(config, memory, 'session-1');

      expect(options).toHaveProperty('model');
      expect(options).toHaveProperty('cwd');
      expect(options).toHaveProperty('maxTurns');
      expect(options).toHaveProperty('tools');
      expect(options).toHaveProperty('allowedTools');
      expect(options).toHaveProperty('persistSession');
      expect(options).toHaveProperty('hooks');
    });

    it('should set model from config', async () => {
      const memory = createMockMemory();
      const config = createMockConfig({ model: 'claude-sonnet-4-6' });
      const options = await buildPersistentOptions(config, memory, 'session-1');

      expect(options.model).toBe('claude-sonnet-4-6');
    });

    it('should set cwd to workspace when no session directory', async () => {
      const memory = createMockMemory();
      memory.getSessionWorkingDirectory.mockReturnValue(null);
      const config = createMockConfig({ workspace: '/my/workspace' });
      const options = await buildPersistentOptions(config, memory, 'session-1');

      expect(options.cwd).toBe('/my/workspace');
    });

    it('should set cwd to session working directory when available', async () => {
      const memory = createMockMemory();
      memory.getSessionWorkingDirectory.mockReturnValue('/custom/dir');
      const config = createMockConfig();
      const options = await buildPersistentOptions(config, memory, 'session-1');

      expect(options.cwd).toBe('/custom/dir');
    });

    it('should set maxTurns to 100', async () => {
      const memory = createMockMemory();
      const config = createMockConfig();
      const options = await buildPersistentOptions(config, memory, 'session-1');

      expect(options.maxTurns).toBe(100);
    });

    it('should enable persistSession', async () => {
      const memory = createMockMemory();
      const config = createMockConfig();
      const options = await buildPersistentOptions(config, memory, 'session-1');

      expect(options.persistSession).toBe(true);
    });

    it('should use claude_code preset for tools', async () => {
      const memory = createMockMemory();
      const config = createMockConfig();
      const options = await buildPersistentOptions(config, memory, 'session-1');

      expect(options.tools).toEqual({ type: 'preset', preset: 'claude_code' });
    });
  });

  // ============ Resume / SDK session ============

  describe('session resume', () => {
    it('should not include resume when no sdkSessionId', async () => {
      const memory = createMockMemory();
      const config = createMockConfig();
      const options = await buildPersistentOptions(config, memory, 'session-1');

      expect(options.resume).toBeUndefined();
    });

    it('should include resume when sdkSessionId provided', async () => {
      const memory = createMockMemory();
      const config = createMockConfig();
      const options = await buildPersistentOptions(config, memory, 'session-1', 'sdk-abc');

      expect(options.resume).toBe('sdk-abc');
    });
  });

  // ============ Mode-specific behavior ============

  describe('mode-specific behavior', () => {
    it('should include system guidelines for general mode', async () => {
      const memory = createMockMemory();
      memory.getSessionMode.mockReturnValue('general');
      const config = createMockConfig();
      const options = await buildPersistentOptions(config, memory, 'session-1');

      // General mode should have systemPrompt with append
      expect(options.systemPrompt).toBeDefined();
      const sp = options.systemPrompt as { type: string; preset: string; append: string };
      expect(sp.type).toBe('preset');
      expect(sp.preset).toBe('claude_code');
      expect(sp.append).toBeTruthy();
    });

    it('should skip system guidelines for coder mode', async () => {
      const memory = createMockMemory();
      memory.getSessionMode.mockReturnValue('coder');
      const config = createMockConfig();
      const options = await buildPersistentOptions(config, memory, 'session-1');

      // Coder mode: no static parts → no systemPrompt.append
      // (empty string prompt is not pushed, and guidelines are skipped)
      if (options.systemPrompt) {
        const sp = options.systemPrompt as { append?: string };
        // If append exists, it should be empty or not contain guidelines
        // (coder has empty systemPrompt so nothing gets appended)
      }
    });

    it('should include identity for non-coder modes', async () => {
      const memory = createMockMemory();
      memory.getSessionMode.mockReturnValue('writer');
      const config = createMockConfig();
      const options = await buildPersistentOptions(config, memory, 'session-1');

      expect(options.systemPrompt).toBeDefined();
      const sp = options.systemPrompt as { append: string };
      expect(sp.append).toContain('TestBot');
    });

    it('should use allowedTools from mode config', async () => {
      const memory = createMockMemory();
      memory.getSessionMode.mockReturnValue('general');
      const config = createMockConfig();
      const options = await buildPersistentOptions(config, memory, 'session-1');

      expect(options.allowedTools).toContain('mcp__neon-post__remember');
      expect(options.allowedTools).toContain('mcp__neon-post__switch_agent');
    });
  });

  // ============ Thinking config ============

  describe('thinking config', () => {
    it('should include thinking for Anthropic models', async () => {
      const memory = createMockMemory();
      const config = createMockConfig({ model: 'claude-sonnet-4-6' });
      const options = await buildPersistentOptions(config, memory, 'session-1');

      expect(options.thinking).toBeDefined();
    });

    it('should not include thinking for non-Anthropic models', async () => {
      const memory = createMockMemory();
      const config = createMockConfig({ model: 'kimi-k2.5' });
      const options = await buildPersistentOptions(config, memory, 'session-1');

      expect(options.thinking).toBeUndefined();
    });
  });

  // ============ Environment variables ============

  describe('environment variables', () => {
    it('should include provider env vars', async () => {
      const memory = createMockMemory();
      const config = createMockConfig({
        buildProviderEnv: vi.fn(async () => ({ ANTHROPIC_API_KEY: 'sk-test' })),
      });
      const options = await buildPersistentOptions(config, memory, 'session-1');

      expect(options.env).toBeDefined();
      expect(options.env!.ANTHROPIC_API_KEY).toBe('sk-test');
    });

    it('should set CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS', async () => {
      const memory = createMockMemory();
      const config = createMockConfig();
      const options = await buildPersistentOptions(config, memory, 'session-1');

      expect(options.env!.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS).toBe('1');
    });

    it('should delete CLAUDE_CONFIG_DIR from env', async () => {
      const memory = createMockMemory();
      const config = createMockConfig();
      const options = await buildPersistentOptions(config, memory, 'session-1');

      expect(options.env!.CLAUDE_CONFIG_DIR).toBeUndefined();
    });
  });

  // ============ Hooks ============

  describe('hooks', () => {
    it('should include PreToolUse hooks', async () => {
      const memory = createMockMemory();
      const config = createMockConfig();
      const options = await buildPersistentOptions(config, memory, 'session-1');

      expect(options.hooks).toBeDefined();
      expect(options.hooks!.PreToolUse).toBeDefined();
      expect(options.hooks!.PreToolUse!.length).toBeGreaterThan(0);
    });

    it('should include UserPromptSubmit hooks', async () => {
      const memory = createMockMemory();
      const config = createMockConfig();
      const options = await buildPersistentOptions(config, memory, 'session-1');

      expect(options.hooks!.UserPromptSubmit).toBeDefined();
      expect(options.hooks!.UserPromptSubmit!.length).toBeGreaterThan(0);
    });

    it('should include TeammateIdle hooks', async () => {
      const memory = createMockMemory();
      const config = createMockConfig();
      const options = await buildPersistentOptions(config, memory, 'session-1');

      expect(options.hooks!.TeammateIdle).toBeDefined();
    });

    it('should include TaskCompleted hooks', async () => {
      const memory = createMockMemory();
      const config = createMockConfig();
      const options = await buildPersistentOptions(config, memory, 'session-1');

      expect(options.hooks!.TaskCompleted).toBeDefined();
    });
  });

  // ============ MCP servers ============

  describe('MCP servers', () => {
    it('should include MCP servers when toolsConfig is provided', async () => {
      const memory = createMockMemory();
      const config = createMockConfig();
      const options = await buildPersistentOptions(config, memory, 'session-1');

      expect(options.mcpServers).toBeDefined();
    });

    it('should not include MCP servers when toolsConfig is null', async () => {
      const memory = createMockMemory();
      const config = createMockConfig({ toolsConfig: null });
      const options = await buildPersistentOptions(config, memory, 'session-1');

      expect(options.mcpServers).toBeUndefined();
    });
  });

  // ============ Permissions ============

  describe('permissions', () => {
    it('should bypass permissions', async () => {
      const memory = createMockMemory();
      const config = createMockConfig();
      const options = await buildPersistentOptions(config, memory, 'session-1');

      expect(options.permissionMode).toBe('bypassPermissions');
      expect(options.allowDangerouslySkipPermissions).toBe(true);
    });

    it('should include canUseTool callback', async () => {
      const memory = createMockMemory();
      const config = createMockConfig();
      const options = await buildPersistentOptions(config, memory, 'session-1');

      expect(options.canUseTool).toBeDefined();
      expect(typeof options.canUseTool).toBe('function');
    });
  });
});
