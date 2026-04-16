/**
 * Unit tests for queue management functions
 *
 * Tests getQueueLength, clearQueue, stopQuery, and isQueryProcessing.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  getQueueLength,
  clearQueue,
  stopQuery,
  isQueryProcessing,
  type QueueMaps,
  type QueueItem,
} from '../../src/agent/queue-management';

function createMaps(): QueueMaps {
  return {
    messageQueueBySession: new Map(),
    processingBySession: new Map(),
    persistentSessions: new Map(),
    stoppedByUserSession: new Set(),
    sdkToolTimers: new Map(),
    abortControllersBySession: new Map(),
  };
}

function createQueueItem(overrides?: Partial<QueueItem>): QueueItem {
  return {
    message: 'test message',
    channel: 'desktop',
    resolve: vi.fn(),
    reject: vi.fn(),
    ...overrides,
  };
}

describe('Queue Management', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // ============ getQueueLength ============

  describe('getQueueLength', () => {
    it('should return 0 for empty/non-existent session', () => {
      const maps = createMaps();
      expect(getQueueLength(maps, 'non-existent')).toBe(0);
    });

    it('should return 0 for empty queue', () => {
      const maps = createMaps();
      maps.messageQueueBySession.set('session-1', []);
      expect(getQueueLength(maps, 'session-1')).toBe(0);
    });

    it('should return correct count for queued items', () => {
      const maps = createMaps();
      maps.messageQueueBySession.set('session-1', [createQueueItem(), createQueueItem()]);
      expect(getQueueLength(maps, 'session-1')).toBe(2);
    });

    it('should default to "default" session', () => {
      const maps = createMaps();
      maps.messageQueueBySession.set('default', [createQueueItem()]);
      expect(getQueueLength(maps)).toBe(1);
    });

    it('should return 0 when default session has no queue', () => {
      const maps = createMaps();
      expect(getQueueLength(maps)).toBe(0);
    });
  });

  // ============ clearQueue ============

  describe('clearQueue', () => {
    it('should reject all pending items and delete queue', () => {
      const maps = createMaps();
      const item1 = createQueueItem();
      const item2 = createQueueItem();
      maps.messageQueueBySession.set('session-1', [item1, item2]);

      clearQueue(maps, 'session-1');

      expect(item1.reject).toHaveBeenCalledWith(expect.any(Error));
      expect(item2.reject).toHaveBeenCalledWith(expect.any(Error));
      expect(maps.messageQueueBySession.has('session-1')).toBe(false);
    });

    it('should reject with "Queue cleared" error message', () => {
      const maps = createMaps();
      const item = createQueueItem();
      maps.messageQueueBySession.set('session-1', [item]);

      clearQueue(maps, 'session-1');

      const error = item.reject.mock.calls[0][0] as Error;
      expect(error.message).toBe('Queue cleared');
    });

    it('should clean up empty queue entries', () => {
      const maps = createMaps();
      maps.messageQueueBySession.set('session-1', []);

      clearQueue(maps, 'session-1');

      expect(maps.messageQueueBySession.has('session-1')).toBe(false);
    });

    it('should do nothing for non-existent session', () => {
      const maps = createMaps();
      // Should not throw
      clearQueue(maps, 'non-existent');
      expect(maps.messageQueueBySession.size).toBe(0);
    });

    it('should default to "default" session', () => {
      const maps = createMaps();
      const item = createQueueItem();
      maps.messageQueueBySession.set('default', [item]);

      clearQueue(maps);

      expect(item.reject).toHaveBeenCalled();
      expect(maps.messageQueueBySession.has('default')).toBe(false);
    });
  });

  // ============ stopQuery ============

  describe('stopQuery', () => {
    it('should delegate to chatEngine in general mode', () => {
      const maps = createMaps();
      const chatEngine = {
        stopQuery: vi.fn().mockReturnValue(true),
        isQueryProcessing: vi.fn(),
      };

      const result = stopQuery(maps, 'general', chatEngine as any, 'session-1');

      expect(chatEngine.stopQuery).toHaveBeenCalledWith('session-1');
      expect(result).toBe(true);
    });

    it('should interrupt persistent session when processing', () => {
      const maps = createMaps();
      const mockSession = {
        isAlive: vi.fn().mockReturnValue(true),
        interrupt: vi.fn().mockResolvedValue(undefined),
      };
      maps.persistentSessions.set('session-1', mockSession as any);
      maps.processingBySession.set('session-1', true);

      const result = stopQuery(maps, 'coder', null, 'session-1');

      expect(result).toBe(true);
      expect(mockSession.interrupt).toHaveBeenCalled();
      expect(maps.stoppedByUserSession.has('session-1')).toBe(true);
    });

    it('should abort via controller when no persistent session', () => {
      const maps = createMaps();
      const abortController = new AbortController();
      maps.abortControllersBySession.set('session-1', abortController);
      maps.processingBySession.set('session-1', true);

      const result = stopQuery(maps, 'coder', null, 'session-1');

      expect(result).toBe(true);
      expect(abortController.signal.aborted).toBe(true);
      expect(maps.stoppedByUserSession.has('session-1')).toBe(true);
    });

    it('should return false when session not processing', () => {
      const maps = createMaps();
      maps.processingBySession.set('session-1', false);

      const result = stopQuery(maps, 'coder', null, 'session-1');

      expect(result).toBe(false);
    });

    it('should clear queued messages by default', () => {
      const maps = createMaps();
      const item = createQueueItem();
      maps.messageQueueBySession.set('session-1', [item]);
      maps.processingBySession.set('session-1', true);
      const mockSession = {
        isAlive: vi.fn().mockReturnValue(true),
        interrupt: vi.fn().mockResolvedValue(undefined),
      };
      maps.persistentSessions.set('session-1', mockSession as any);

      stopQuery(maps, 'coder', null, 'session-1');

      expect(item.reject).toHaveBeenCalled();
    });

    it('should not clear queue when clearQueuedMessages is false', () => {
      const maps = createMaps();
      const item = createQueueItem();
      maps.messageQueueBySession.set('session-1', [item]);
      maps.processingBySession.set('session-1', true);
      const mockSession = {
        isAlive: vi.fn().mockReturnValue(true),
        interrupt: vi.fn().mockResolvedValue(undefined),
      };
      maps.persistentSessions.set('session-1', mockSession as any);

      stopQuery(maps, 'coder', null, 'session-1', false);

      expect(item.reject).not.toHaveBeenCalled();
    });

    it('should clear SDK tool timers for the session being stopped', () => {
      const maps = createMaps();
      const timer1 = setTimeout(() => {}, 1000);
      const timer2 = setTimeout(() => {}, 1000);
      maps.sdkToolTimers.set('tool-1', { timer: timer1, sessionId: 'session-1' });
      maps.sdkToolTimers.set('tool-2', { timer: timer2, sessionId: 'session-2' });
      maps.processingBySession.set('session-1', true);
      const abortController = new AbortController();
      maps.abortControllersBySession.set('session-1', abortController);

      stopQuery(maps, 'coder', null, 'session-1');

      expect(maps.sdkToolTimers.has('tool-1')).toBe(false);
      expect(maps.sdkToolTimers.has('tool-2')).toBe(true); // different session
      clearTimeout(timer2);
    });

    it('should find first processing session when no sessionId given (legacy)', () => {
      const maps = createMaps();
      maps.processingBySession.set('session-1', false);
      maps.processingBySession.set('session-2', true);
      const abortController = new AbortController();
      maps.abortControllersBySession.set('session-2', abortController);

      const result = stopQuery(maps, 'coder', null);

      expect(result).toBe(true);
      expect(abortController.signal.aborted).toBe(true);
    });

    it('should return false when no session is processing (legacy)', () => {
      const maps = createMaps();
      maps.processingBySession.set('session-1', false);

      const result = stopQuery(maps, 'coder', null);

      expect(result).toBe(false);
    });
  });

  // ============ isQueryProcessing ============

  describe('isQueryProcessing', () => {
    it('should delegate to chatEngine in general mode', () => {
      const maps = createMaps();
      const chatEngine = {
        stopQuery: vi.fn(),
        isQueryProcessing: vi.fn().mockReturnValue(true),
      };

      const result = isQueryProcessing(maps, 'general', chatEngine as any, 'session-1');

      expect(chatEngine.isQueryProcessing).toHaveBeenCalledWith('session-1');
      expect(result).toBe(true);
    });

    it('should return true for processing session', () => {
      const maps = createMaps();
      maps.processingBySession.set('session-1', true);

      expect(isQueryProcessing(maps, 'coder', null, 'session-1')).toBe(true);
    });

    it('should return false for non-processing session', () => {
      const maps = createMaps();
      maps.processingBySession.set('session-1', false);

      expect(isQueryProcessing(maps, 'coder', null, 'session-1')).toBe(false);
    });

    it('should return false for unknown session', () => {
      const maps = createMaps();

      expect(isQueryProcessing(maps, 'coder', null, 'non-existent')).toBe(false);
    });

    it('should check any session when no sessionId given', () => {
      const maps = createMaps();
      maps.processingBySession.set('session-1', false);
      maps.processingBySession.set('session-2', true);

      expect(isQueryProcessing(maps, 'coder', null)).toBe(true);
    });

    it('should return false when no sessions are processing', () => {
      const maps = createMaps();
      maps.processingBySession.set('session-1', false);
      maps.processingBySession.set('session-2', false);

      expect(isQueryProcessing(maps, 'coder', null)).toBe(false);
    });

    it('should return false when no sessions exist', () => {
      const maps = createMaps();

      expect(isQueryProcessing(maps, 'coder', null)).toBe(false);
    });
  });
});
