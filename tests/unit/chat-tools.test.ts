/**
 * Unit tests for chat-tools.ts
 *
 * Tests tool registration, schema conversion, and built-in tool definitions.
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

// Mock child_process
vi.mock('child_process', () => ({
  exec: vi.fn(),
  execSync: vi.fn(() => ''),
}));

// Mock util
vi.mock('util', () => ({
  promisify: vi.fn(() => vi.fn()),
}));

// Mock tools module
vi.mock('../../src/tools', () => ({
  getCustomTools: vi.fn(() => [
    {
      name: 'test_tool',
      description: 'A test tool',
      input_schema: {
        properties: {
          query: { type: 'string', description: 'Search query' },
          count: { type: 'number', description: 'Result count' },
          enabled: { type: 'boolean', description: 'Enable flag' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Tags list' },
        },
        required: ['query'],
      },
      handler: vi.fn(async () => 'test result'),
    },
    {
      name: 'simple_tool',
      description: 'A simple tool',
      input_schema: {
        properties: {
          input: { type: 'string' },
        },
        required: ['input'],
      },
      handler: vi.fn(async () => 'simple result'),
    },
  ]),
  buildMCPServers: vi.fn(() => ({})),
  buildSdkMcpServers: vi.fn(async () => ({})),
}));

// Mock diagnostics
vi.mock('../../src/tools/diagnostics', () => ({
  wrapToolHandler: vi.fn((_name: string, handler: Function) => handler),
  getToolTimeout: vi.fn(() => 30000),
  logActiveToolsStatus: vi.fn(),
}));

// Mock chat-providers
vi.mock('../../src/agent/chat-providers', () => ({
  getProviderForModel: vi.fn((model: string) => {
    if (model.startsWith('claude')) return 'anthropic';
    return 'other';
  }),
}));

// Mock settings
vi.mock('../../src/settings', () => ({
  SettingsManager: {
    get: vi.fn(() => ''),
    getFormattedIdentity: vi.fn(() => ''),
    getFormattedUserContext: vi.fn(() => ''),
  },
}));

import { getChatAgentTools, getServerTools } from '../../src/agent/chat-tools';

describe('Chat Tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ============ getChatAgentTools ============

  describe('getChatAgentTools', () => {
    const mockConfig = {
      mcpServers: {},
      computerUse: { enabled: false, dockerized: false },
      browser: { enabled: false },
    } as any;

    it('should return an array of tools', () => {
      const tools = getChatAgentTools(mockConfig);
      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThan(0);
    });

    it('should include custom tools from getCustomTools', () => {
      const tools = getChatAgentTools(mockConfig);
      const names = tools.map((t) => t.name);
      expect(names).toContain('test_tool');
      expect(names).toContain('simple_tool');
    });

    it('should include web_fetch built-in tool', () => {
      const tools = getChatAgentTools(mockConfig);
      const webFetch = tools.find((t) => t.name === 'web_fetch');
      expect(webFetch).toBeDefined();
      expect(webFetch!.description).toContain('Fetch');
    });

    it('should include shell_command built-in tool', () => {
      const tools = getChatAgentTools(mockConfig);
      const shellCmd = tools.find((t) => t.name === 'shell_command');
      expect(shellCmd).toBeDefined();
      expect(shellCmd!.description).toContain('shell command');
    });

    it('should have name, description, parameters, and execute on each tool', () => {
      const tools = getChatAgentTools(mockConfig);
      for (const tool of tools) {
        expect(tool.name).toBeTruthy();
        expect(tool.description).toBeTruthy();
        expect(tool.parameters).toBeDefined();
        expect(typeof tool.execute).toBe('function');
      }
    });

    it('should convert custom tool handlers to execute functions', async () => {
      const tools = getChatAgentTools(mockConfig);
      const testTool = tools.find((t) => t.name === 'test_tool');
      expect(testTool).toBeDefined();

      // The execute function wraps the handler
      const result = await testTool!.execute({ query: 'test' }, {} as any);
      expect(result).toBe('test result');
    });

    it('should convert string properties to zod string schemas', () => {
      const tools = getChatAgentTools(mockConfig);
      const testTool = tools.find((t) => t.name === 'test_tool');
      expect(testTool).toBeDefined();

      // The parameters should be a zod object
      const shape = testTool!.parameters.shape;
      expect(shape).toHaveProperty('query');
    });

    it('should handle tools with minimal schemas', () => {
      const tools = getChatAgentTools(mockConfig);
      const simpleTool = tools.find((t) => t.name === 'simple_tool');
      expect(simpleTool).toBeDefined();
      expect(simpleTool!.parameters.shape).toHaveProperty('input');
    });
  });

  // ============ getServerTools ============

  describe('getServerTools', () => {
    it('should return web_search for Anthropic models', () => {
      const tools = getServerTools('claude-sonnet-4-6');
      expect(tools.length).toBe(1);
      expect(tools[0].name).toBe('web_search');
      expect(tools[0].type).toBe('web_search_20250305');
    });

    it('should return empty array for non-Anthropic models', () => {
      const tools = getServerTools('gpt-4');
      expect(tools).toEqual([]);
    });

    it('should return empty array for moonshot models', () => {
      const tools = getServerTools('kimi-k2.5');
      expect(tools).toEqual([]);
    });
  });

  // ============ web_fetch tool ============

  describe('web_fetch tool', () => {
    it('should have correct name and description', () => {
      const tools = getChatAgentTools({} as any);
      const webFetch = tools.find((t) => t.name === 'web_fetch');
      expect(webFetch!.name).toBe('web_fetch');
      expect(webFetch!.description).toContain('URL');
    });

    it('should have url parameter', () => {
      const tools = getChatAgentTools({} as any);
      const webFetch = tools.find((t) => t.name === 'web_fetch');
      expect(webFetch!.parameters.shape).toHaveProperty('url');
    });

    it('should have optional max_length parameter', () => {
      const tools = getChatAgentTools({} as any);
      const webFetch = tools.find((t) => t.name === 'web_fetch');
      expect(webFetch!.parameters.shape).toHaveProperty('max_length');
    });
  });

  // ============ shell_command tool ============

  describe('shell_command tool', () => {
    it('should have correct name and description', () => {
      const tools = getChatAgentTools({} as any);
      const shellCmd = tools.find((t) => t.name === 'shell_command');
      expect(shellCmd!.name).toBe('shell_command');
      expect(shellCmd!.description).toContain('Execute');
    });

    it('should have command parameter', () => {
      const tools = getChatAgentTools({} as any);
      const shellCmd = tools.find((t) => t.name === 'shell_command');
      expect(shellCmd!.parameters.shape).toHaveProperty('command');
    });

    it('should have optional timeout_ms parameter', () => {
      const tools = getChatAgentTools({} as any);
      const shellCmd = tools.find((t) => t.name === 'shell_command');
      expect(shellCmd!.parameters.shape).toHaveProperty('timeout_ms');
    });
  });
});
