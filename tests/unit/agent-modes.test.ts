/**
 * Unit tests for agent-modes.ts
 *
 * Tests the agent mode registry, validation, and lookup functions.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  AGENT_MODES,
  ALL_MODE_IDS,
  isValidModeId,
  getModeConfig,
  getAllModes,
} from '../../src/agent/agent-modes';
import type { AgentModeId, AgentMode } from '../../src/agent/agent-modes';

describe('Agent Modes', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // ============ AGENT_MODES registry ============

  describe('AGENT_MODES registry', () => {
    it('should contain all six modes', () => {
      const modeIds = Object.keys(AGENT_MODES);
      expect(modeIds).toContain('general');
      expect(modeIds).toContain('coder');
      expect(modeIds).toContain('researcher');
      expect(modeIds).toContain('writer');
      expect(modeIds).toContain('therapist');
      expect(modeIds).toContain('creator');
      expect(modeIds).toHaveLength(6);
    });

    it('should have matching id field for each mode', () => {
      for (const [key, mode] of Object.entries(AGENT_MODES)) {
        expect(mode.id).toBe(key);
      }
    });

    it('should have non-empty name and description for each mode', () => {
      for (const mode of Object.values(AGENT_MODES)) {
        expect(mode.name).toBeTruthy();
        expect(mode.description).toBeTruthy();
      }
    });

    it('should have non-empty icon for each mode', () => {
      for (const mode of Object.values(AGENT_MODES)) {
        expect(mode.icon).toBeTruthy();
        expect(mode.icon.length).toBeGreaterThan(0);
      }
    });

    it('should have valid engine type for each mode', () => {
      for (const mode of Object.values(AGENT_MODES)) {
        expect(['chat', 'sdk']).toContain(mode.engine);
      }
    });

    it('should have allowedTools as a non-empty array for each mode', () => {
      for (const mode of Object.values(AGENT_MODES)) {
        expect(Array.isArray(mode.allowedTools)).toBe(true);
        expect(mode.allowedTools.length).toBeGreaterThan(0);
      }
    });

    it('should have mcpServers defined for each mode', () => {
      for (const mode of Object.values(AGENT_MODES)) {
        expect(Array.isArray(mode.mcpServers)).toBe(true);
        expect(mode.mcpServers!.length).toBeGreaterThan(0);
      }
    });
  });

  // ============ Mode-specific checks ============

  describe('general mode', () => {
    it('should use the chat engine', () => {
      expect(AGENT_MODES.general.engine).toBe('chat');
    });

    it('should have a non-empty system prompt', () => {
      expect(AGENT_MODES.general.systemPrompt.length).toBeGreaterThan(0);
    });

    it('should include memory tools in allowedTools', () => {
      const tools = AGENT_MODES.general.allowedTools;
      expect(tools).toContain('mcp__neon-post__remember');
      expect(tools).toContain('mcp__neon-post__forget');
    });

    it('should include scheduler tools in allowedTools', () => {
      const tools = AGENT_MODES.general.allowedTools;
      expect(tools).toContain('mcp__neon-post__schedule_task');
      expect(tools).toContain('mcp__neon-post__create_reminder');
    });

    it('should include switch_agent tool', () => {
      expect(AGENT_MODES.general.allowedTools).toContain('mcp__neon-post__switch_agent');
    });
  });

  describe('coder mode', () => {
    it('should use the sdk engine', () => {
      expect(AGENT_MODES.coder.engine).toBe('sdk');
    });

    it('should have an empty system prompt (uses SDK preset)', () => {
      expect(AGENT_MODES.coder.systemPrompt).toBe('');
    });

    it('should include grep MCP server', () => {
      expect(AGENT_MODES.coder.mcpServers).toContain('grep');
    });

    it('should include grep tools in allowedTools', () => {
      expect(AGENT_MODES.coder.allowedTools).toContain('mcp__grep__searchGitHub');
    });

    it('should NOT include memory tools', () => {
      expect(AGENT_MODES.coder.allowedTools).not.toContain('mcp__neon-post__remember');
    });

    it('should NOT include scheduler tools', () => {
      expect(AGENT_MODES.coder.allowedTools).not.toContain('mcp__neon-post__schedule_task');
    });
  });

  describe('researcher mode', () => {
    it('should use the sdk engine', () => {
      expect(AGENT_MODES.researcher.engine).toBe('sdk');
    });

    it('should have a non-empty system prompt', () => {
      expect(AGENT_MODES.researcher.systemPrompt.length).toBeGreaterThan(0);
    });

    it('should include memory tools', () => {
      expect(AGENT_MODES.researcher.allowedTools).toContain('mcp__neon-post__remember');
    });

    it('should NOT include grep tools', () => {
      expect(AGENT_MODES.researcher.allowedTools).not.toContain('mcp__grep__searchGitHub');
    });
  });

  describe('writer mode', () => {
    it('should use the chat engine', () => {
      expect(AGENT_MODES.writer.engine).toBe('chat');
    });

    it('should include soul tools', () => {
      const tools = AGENT_MODES.writer.allowedTools;
      expect(tools).toContain('mcp__neon-post__soul_set');
      expect(tools).toContain('mcp__neon-post__soul_get');
    });

    it('should NOT include browser tools', () => {
      expect(AGENT_MODES.writer.allowedTools).not.toContain('mcp__neon-post__browser');
    });

    it('should NOT include SDK core tools like Read/Write', () => {
      expect(AGENT_MODES.writer.allowedTools).not.toContain('Read');
      expect(AGENT_MODES.writer.allowedTools).not.toContain('Write');
    });
  });

  describe('therapist mode', () => {
    it('should use the chat engine', () => {
      expect(AGENT_MODES.therapist.engine).toBe('chat');
    });

    it('should include memory and soul tools', () => {
      const tools = AGENT_MODES.therapist.allowedTools;
      expect(tools).toContain('mcp__neon-post__remember');
      expect(tools).toContain('mcp__neon-post__soul_set');
    });

    it('should NOT include browser or project tools', () => {
      const tools = AGENT_MODES.therapist.allowedTools;
      expect(tools).not.toContain('mcp__neon-post__browser');
      expect(tools).not.toContain('mcp__neon-post__set_project');
    });
  });

  // ============ ALL_MODE_IDS ============

  describe('ALL_MODE_IDS', () => {
    it('should be an array of 6 mode IDs', () => {
      expect(ALL_MODE_IDS).toHaveLength(6);
    });

    it('should contain all expected mode IDs', () => {
      expect(ALL_MODE_IDS).toContain('general');
      expect(ALL_MODE_IDS).toContain('coder');
      expect(ALL_MODE_IDS).toContain('researcher');
      expect(ALL_MODE_IDS).toContain('writer');
      expect(ALL_MODE_IDS).toContain('therapist');
    });

    it('should match the keys of AGENT_MODES', () => {
      expect(ALL_MODE_IDS.sort()).toEqual(Object.keys(AGENT_MODES).sort());
    });
  });

  // ============ isValidModeId ============

  describe('isValidModeId', () => {
    it('should return true for all valid mode IDs', () => {
      expect(isValidModeId('general')).toBe(true);
      expect(isValidModeId('coder')).toBe(true);
      expect(isValidModeId('researcher')).toBe(true);
      expect(isValidModeId('writer')).toBe(true);
      expect(isValidModeId('therapist')).toBe(true);
    });

    it('should return false for invalid mode IDs', () => {
      expect(isValidModeId('invalid')).toBe(false);
      expect(isValidModeId('')).toBe(false);
      expect(isValidModeId('GENERAL')).toBe(false);
      expect(isValidModeId('Coder')).toBe(false);
    });

    it('should return false for undefined-like strings', () => {
      expect(isValidModeId('undefined')).toBe(false);
      expect(isValidModeId('null')).toBe(false);
    });
  });

  // ============ getModeConfig ============

  describe('getModeConfig', () => {
    it('should return the correct mode config for valid IDs', () => {
      const general = getModeConfig('general');
      expect(general.id).toBe('general');
      expect(general.name).toBe('General');

      const coder = getModeConfig('coder');
      expect(coder.id).toBe('coder');
      expect(coder.name).toBe('Coder');
    });

    it('should fall back to coder for invalid IDs', () => {
      const result = getModeConfig('nonexistent');
      expect(result.id).toBe('coder');
    });

    it('should fall back to coder for empty string', () => {
      const result = getModeConfig('');
      expect(result.id).toBe('coder');
    });

    it('should return AgentMode shape with all required fields', () => {
      const config = getModeConfig('general');
      expect(config).toHaveProperty('id');
      expect(config).toHaveProperty('name');
      expect(config).toHaveProperty('icon');
      expect(config).toHaveProperty('engine');
      expect(config).toHaveProperty('systemPrompt');
      expect(config).toHaveProperty('allowedTools');
      expect(config).toHaveProperty('description');
    });
  });

  // ============ getAllModes ============

  describe('getAllModes', () => {
    it('should return an array of all modes', () => {
      const modes = getAllModes();
      expect(modes).toHaveLength(6);
    });

    it('should return AgentMode objects', () => {
      const modes = getAllModes();
      for (const mode of modes) {
        expect(mode).toHaveProperty('id');
        expect(mode).toHaveProperty('name');
        expect(mode).toHaveProperty('engine');
        expect(mode).toHaveProperty('allowedTools');
      }
    });

    it('should return modes in the same order as ALL_MODE_IDS', () => {
      const modes = getAllModes();
      const ids = modes.map((m) => m.id);
      expect(ids).toEqual(ALL_MODE_IDS);
    });

    it('should return fresh array each call (not shared reference)', () => {
      const a = getAllModes();
      const b = getAllModes();
      expect(a).not.toBe(b);
      expect(a).toEqual(b);
    });
  });
});
