import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock better-sqlite3 before importing modules
vi.mock('better-sqlite3', () => {
  return { default: vi.fn() };
});

import {
  linkTelegramChat,
  unlinkTelegramChat,
  getSessionForChat,
  getChatForSession,
  getAllTelegramChatSessions,
} from '../../src/memory/telegram-sessions';

function createMockDb() {
  const mockStatement = {
    run: vi.fn(() => ({ lastInsertRowid: 1, changes: 1 })),
    get: vi.fn(() => undefined),
    all: vi.fn(() => []),
  };
  const mockDb = {
    prepare: vi.fn(() => mockStatement),
    exec: vi.fn(),
  } as any;
  return { mockDb, mockStatement };
}

describe('telegram-sessions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('linkTelegramChat', () => {
    it('should link a chat to a session and return true', () => {
      const { mockDb, mockStatement } = createMockDb();

      const result = linkTelegramChat(mockDb, 12345, 'session-1', 'My Group');

      expect(result).toBe(true);
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO telegram_chat_sessions')
      );
      expect(mockStatement.run).toHaveBeenCalledWith(12345, 'session-1', 'My Group');
    });

    it('should use null for group name when not provided', () => {
      const { mockDb, mockStatement } = createMockDb();

      linkTelegramChat(mockDb, 12345, 'session-1');

      expect(mockStatement.run).toHaveBeenCalledWith(12345, 'session-1', null);
    });

    it('should use ON CONFLICT for upsert behavior', () => {
      const { mockDb } = createMockDb();

      linkTelegramChat(mockDb, 12345, 'session-1');

      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('ON CONFLICT(chat_id) DO UPDATE')
      );
    });

    it('should return false on error', () => {
      const mockStatement = {
        run: vi.fn(() => {
          throw new Error('DB error');
        }),
        get: vi.fn(),
        all: vi.fn(),
      };
      const mockDb = { prepare: vi.fn(() => mockStatement) } as any;

      const result = linkTelegramChat(mockDb, 12345, 'session-1');

      expect(result).toBe(false);
    });
  });

  describe('unlinkTelegramChat', () => {
    it('should unlink a chat and return true', () => {
      const { mockDb, mockStatement } = createMockDb();
      mockStatement.run.mockReturnValue({ changes: 1 });

      const result = unlinkTelegramChat(mockDb, 12345);

      expect(result).toBe(true);
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM telegram_chat_sessions')
      );
      expect(mockStatement.run).toHaveBeenCalledWith(12345);
    });

    it('should return false when chat not found', () => {
      const { mockDb, mockStatement } = createMockDb();
      mockStatement.run.mockReturnValue({ changes: 0 });

      const result = unlinkTelegramChat(mockDb, 99999);

      expect(result).toBe(false);
    });
  });

  describe('getSessionForChat', () => {
    it('should return session id when linked', () => {
      const { mockDb, mockStatement } = createMockDb();
      mockStatement.get.mockReturnValue({ session_id: 'session-42' });

      const result = getSessionForChat(mockDb, 12345);

      expect(result).toBe('session-42');
      expect(mockStatement.get).toHaveBeenCalledWith(12345);
    });

    it('should return null when not linked', () => {
      const { mockDb, mockStatement } = createMockDb();
      mockStatement.get.mockReturnValue(undefined);

      const result = getSessionForChat(mockDb, 99999);

      expect(result).toBeNull();
    });
  });

  describe('getChatForSession', () => {
    it('should return chat id when linked', () => {
      const { mockDb, mockStatement } = createMockDb();
      mockStatement.get.mockReturnValue({ chat_id: 12345 });

      const result = getChatForSession(mockDb, 'session-42');

      expect(result).toBe(12345);
      expect(mockStatement.get).toHaveBeenCalledWith('session-42');
    });

    it('should return null when not linked', () => {
      const { mockDb, mockStatement } = createMockDb();
      mockStatement.get.mockReturnValue(undefined);

      const result = getChatForSession(mockDb, 'nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('getAllTelegramChatSessions', () => {
    it('should return all chat-session mappings', () => {
      const { mockDb, mockStatement } = createMockDb();
      const sessions = [
        { chat_id: 111, session_id: 's1', group_name: 'Group 1', created_at: '2024-01-01' },
        { chat_id: 222, session_id: 's2', group_name: null, created_at: '2024-01-02' },
      ];
      mockStatement.all.mockReturnValue(sessions);

      const result = getAllTelegramChatSessions(mockDb);

      expect(result).toHaveLength(2);
      expect(result[0].chat_id).toBe(111);
      expect(result[0].group_name).toBe('Group 1');
      expect(result[1].group_name).toBeNull();
    });

    it('should return empty array when none exist', () => {
      const { mockDb, mockStatement } = createMockDb();
      mockStatement.all.mockReturnValue([]);

      const result = getAllTelegramChatSessions(mockDb);

      expect(result).toEqual([]);
    });

    it('should query with ORDER BY created_at DESC', () => {
      const { mockDb, mockStatement } = createMockDb();
      mockStatement.all.mockReturnValue([]);

      getAllTelegramChatSessions(mockDb);

      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY created_at DESC')
      );
    });
  });
});
