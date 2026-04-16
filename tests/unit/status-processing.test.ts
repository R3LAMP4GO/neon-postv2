/**
 * Unit tests for status processing logic
 *
 * Tests subagent tracking, background task tracking, and message processing.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock external dependencies
vi.mock('../../src/tools', () => ({
  getCurrentSessionId: vi.fn().mockReturnValue('test-session'),
}));

import { getCurrentSessionId } from '../../src/tools';
import {
  getActiveSubagents,
  getBackgroundTasks,
  processStatusFromMessage,
  SDK_TOOL_TIMEOUTS,
  SDK_TOOL_DEFAULT_TIMEOUT,
  type StatusProcessingState,
} from '../../src/agent/status-processing';

function createState(): StatusProcessingState {
  return {
    activeSubagentsBySession: new Map(),
    lastPartialTextBySession: new Map(),
    backgroundTasksBySession: new Map(),
    sdkToolTimers: new Map(),
  };
}

describe('Status Processing', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.mocked(getCurrentSessionId).mockReturnValue('test-session');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ============ SDK_TOOL_TIMEOUTS ============

  describe('SDK_TOOL_TIMEOUTS', () => {
    it('should have expected tool entries', () => {
      expect(SDK_TOOL_TIMEOUTS).toHaveProperty('Bash');
      expect(SDK_TOOL_TIMEOUTS).toHaveProperty('Read');
      expect(SDK_TOOL_TIMEOUTS).toHaveProperty('Write');
      expect(SDK_TOOL_TIMEOUTS).toHaveProperty('Edit');
      expect(SDK_TOOL_TIMEOUTS).toHaveProperty('Glob');
      expect(SDK_TOOL_TIMEOUTS).toHaveProperty('Grep');
      expect(SDK_TOOL_TIMEOUTS).toHaveProperty('WebSearch');
      expect(SDK_TOOL_TIMEOUTS).toHaveProperty('WebFetch');
      expect(SDK_TOOL_TIMEOUTS).toHaveProperty('Task');
    });

    it('should have Bash timeout at 120s', () => {
      expect(SDK_TOOL_TIMEOUTS.Bash).toBe(120_000);
    });

    it('should have Task timeout at 5 minutes', () => {
      expect(SDK_TOOL_TIMEOUTS.Task).toBe(300_000);
    });

    it('should have default timeout at 60s', () => {
      expect(SDK_TOOL_DEFAULT_TIMEOUT).toBe(60_000);
    });

    it('should have all timeouts as positive numbers', () => {
      for (const [, value] of Object.entries(SDK_TOOL_TIMEOUTS)) {
        expect(value).toBeGreaterThan(0);
      }
    });
  });

  // ============ getActiveSubagents ============

  describe('getActiveSubagents', () => {
    it('should create new map for unknown session', () => {
      const state = createState();
      const result = getActiveSubagents(state, 'new-session');
      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(0);
    });

    it('should return existing map for known session', () => {
      const state = createState();
      const existing = new Map([['agent-1', { type: 'Explore', description: 'test' }]]);
      state.activeSubagentsBySession.set('session-1', existing);

      const result = getActiveSubagents(state, 'session-1');
      expect(result.size).toBe(1);
      expect(result.get('agent-1')).toEqual({ type: 'Explore', description: 'test' });
    });

    it('should persist new map in state', () => {
      const state = createState();
      const map = getActiveSubagents(state, 'new-session');
      map.set('agent-1', { type: 'Bash', description: 'running' });

      // Get it again, should be same map
      const map2 = getActiveSubagents(state, 'new-session');
      expect(map2.get('agent-1')).toEqual({ type: 'Bash', description: 'running' });
    });
  });

  // ============ getBackgroundTasks ============

  describe('getBackgroundTasks', () => {
    it('should create new map for unknown session', () => {
      const state = createState();
      const result = getBackgroundTasks(state, 'new-session');
      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(0);
    });

    it('should return existing map for known session', () => {
      const state = createState();
      const existing = new Map([
        ['bg-1', { type: 'Bash', description: 'running server', toolUseId: 'tool-1' }],
      ]);
      state.backgroundTasksBySession.set('session-1', existing);

      const result = getBackgroundTasks(state, 'session-1');
      expect(result.size).toBe(1);
    });

    it('should persist new map in state', () => {
      const state = createState();
      const map = getBackgroundTasks(state, 'session-2');
      map.set('bg-1', { type: 'Task', description: 'building', toolUseId: 'tu-1' });

      expect(state.backgroundTasksBySession.get('session-2')?.size).toBe(1);
    });
  });

  // ============ processStatusFromMessage ============

  describe('processStatusFromMessage', () => {
    it('should emit tool_start for assistant message with tool_use block', () => {
      const state = createState();
      const emit = vi.fn();
      const extractScreenshots = vi.fn();

      processStatusFromMessage(state, emit, extractScreenshots, {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'tool-123',
              name: 'Read',
              input: { file_path: '/src/index.ts' },
            },
          ],
        },
      });

      expect(emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'tool_start',
          sessionId: 'test-session',
          toolName: 'sniffing this file',
          toolInput: '/src/index.ts',
        })
      );
    });

    it('should emit subagent_start for Task tool', () => {
      const state = createState();
      const emit = vi.fn();

      processStatusFromMessage(state, emit, vi.fn(), {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'tool-456',
              name: 'Task',
              input: { description: 'explore the codebase', subagent_type: 'Explore' },
            },
          ],
        },
      });

      expect(emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'subagent_start',
          agentType: 'Explore',
          toolInput: 'explore the codebase',
        })
      );
    });

    it('should emit partial_text for text blocks', () => {
      const state = createState();
      const emit = vi.fn();

      processStatusFromMessage(state, emit, vi.fn(), {
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'I am thinking about this...' }],
        },
      });

      expect(emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'partial_text',
          partialText: 'I am thinking about this...',
        })
      );
    });

    it('should not emit partial_text when text is same as previous', () => {
      const state = createState();
      state.lastPartialTextBySession.set('test-session', 'same text');
      const emit = vi.fn();

      processStatusFromMessage(state, emit, vi.fn(), {
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'same text' }],
        },
      });

      // Should not emit partial_text (emit might still be called for other reasons)
      const partialEmits = emit.mock.calls.filter(
        (c: unknown[]) => (c[0] as { type: string }).type === 'partial_text'
      );
      expect(partialEmits).toHaveLength(0);
    });

    it('should emit tool_end for tool_result in user message', () => {
      const state = createState();
      const emit = vi.fn();
      const extractScreenshots = vi.fn();

      processStatusFromMessage(state, emit, extractScreenshots, {
        type: 'user',
        message: {
          content: [{ type: 'tool_result', tool_use_id: 'tool-123' }],
        },
      });

      expect(emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'tool_end',
          message: 'caught it! processing...',
        })
      );
    });

    it('should emit subagent_end when last subagent completes', () => {
      const state = createState();
      const subagents = new Map([['agent-1', { type: 'Explore', description: 'testing' }]]);
      state.activeSubagentsBySession.set('test-session', subagents);
      const emit = vi.fn();

      processStatusFromMessage(state, emit, vi.fn(), {
        type: 'user',
        message: {
          content: [{ type: 'tool_result', tool_use_id: 'tool-456' }],
        },
      });

      expect(emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'subagent_end',
          agentCount: 0,
        })
      );
    });

    it('should emit thinking for system init message', () => {
      const state = createState();
      const emit = vi.fn();

      processStatusFromMessage(state, emit, vi.fn(), {
        type: 'system',
        subtype: 'init',
      });

      expect(emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'thinking',
          message: 'waking up from a nap...',
        })
      );
    });

    it('should emit thinking for compacting status', () => {
      const state = createState();
      const emit = vi.fn();

      processStatusFromMessage(state, emit, vi.fn(), {
        type: 'system',
        subtype: 'status',
        status: 'compacting',
      });

      expect(emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'thinking',
          message: 'compacting context...',
        })
      );
    });

    it('should handle background task start (run_in_background)', () => {
      const state = createState();
      const emit = vi.fn();

      processStatusFromMessage(state, emit, vi.fn(), {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'tool-bg1',
              name: 'Bash',
              input: { command: 'npm run dev', run_in_background: true },
            },
          ],
        },
      });

      expect(emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'background_task_start',
          toolName: 'Bash',
        })
      );
    });

    it('should handle pocket CLI command detection', () => {
      const state = createState();
      const emit = vi.fn();

      processStatusFromMessage(state, emit, vi.fn(), {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'tool-pocket',
              name: 'Bash',
              input: { command: 'pocket news latest' },
            },
          ],
        },
      });

      expect(emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'tool_start',
          isPocketCli: true,
        })
      );
    });

    it('should emit teammate_start for TeammateTool', () => {
      const state = createState();
      const emit = vi.fn();

      processStatusFromMessage(state, emit, vi.fn(), {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'tool-team',
              name: 'TeammateTool',
              input: { name: 'CodeReviewer', team_name: 'dev-team' },
            },
          ],
        },
      });

      expect(emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'teammate_start',
          teammateName: 'CodeReviewer',
          teamName: 'dev-team',
        })
      );
    });

    it('should emit teammate_message for SendMessage', () => {
      const state = createState();
      const emit = vi.fn();

      processStatusFromMessage(state, emit, vi.fn(), {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'tool-msg',
              name: 'SendMessage',
              input: { to: 'bob', message: 'check this out' },
            },
          ],
        },
      });

      expect(emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'teammate_message',
          teammateName: 'bob',
        })
      );
    });

    it('should clear SDK tool timer on tool_result', () => {
      const state = createState();
      const mockTimer = setTimeout(() => {}, 1000);
      state.sdkToolTimers.set('tool-123', { timer: mockTimer, sessionId: 'test-session' });
      const emit = vi.fn();

      processStatusFromMessage(state, emit, vi.fn(), {
        type: 'user',
        message: {
          content: [{ type: 'tool_result', tool_use_id: 'tool-123' }],
        },
      });

      expect(state.sdkToolTimers.has('tool-123')).toBe(false);
    });

    it('should handle task notification for completed background task', () => {
      const state = createState();
      const bgTasks = new Map([
        ['bg-1', { type: 'Task', description: 'building', toolUseId: 'tu-1' }],
      ]);
      state.backgroundTasksBySession.set('test-session', bgTasks);
      const emit = vi.fn();

      processStatusFromMessage(state, emit, vi.fn(), {
        type: 'system',
        subtype: 'task_notification',
        task_id: 'sdk-task-1',
        status: 'completed',
      });

      expect(emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'background_task_end',
          message: 'background task completed',
        })
      );
      expect(bgTasks.size).toBe(0);
    });

    it('should handle non-array content gracefully', () => {
      const state = createState();
      const emit = vi.fn();

      // Should not throw
      processStatusFromMessage(state, emit, vi.fn(), {
        type: 'assistant',
        message: { content: 'just a string' },
      });

      expect(emit).not.toHaveBeenCalled();
    });
  });
});
