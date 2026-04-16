import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock better-sqlite3 before importing modules
vi.mock('better-sqlite3', () => {
  return { default: vi.fn() };
});

import {
  createSession,
  getSession,
  getSessions,
  getSessionByName,
  renameSession,
  deleteSession,
  touchSession,
  getSessionWorkingDirectory,
  setSessionWorkingDirectory,
} from '../../src/memory/sessions';

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

describe('sessions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createSession', () => {
    it('should create a session and return it', () => {
      const callCount = { n: 0 };
      const mockStatement = {
        run: vi.fn(() => ({ lastInsertRowid: 1, changes: 1 })),
        get: vi.fn(() => {
          callCount.n++;
          // First call: getSessionByName check (return undefined = no duplicate)
          if (callCount.n === 1) return undefined;
          // Third call: getSession after insert (return the session)
          return {
            id: 'session-123',
            name: 'test-session',
            mode: 'coder',
            working_directory: null,
            created_at: '2024-01-01T00:00:00Z',
            updated_at: '2024-01-01T00:00:00Z',
          };
        }),
        all: vi.fn(() => []),
      };
      const mockDb = { prepare: vi.fn(() => mockStatement) } as any;

      const session = createSession(mockDb, 'test-session', 'coder');

      expect(session).toBeDefined();
      expect(session.name).toBe('test-session');
      expect(session.mode).toBe('coder');
    });

    it('should throw if session name already exists', () => {
      const mockStatement = {
        run: vi.fn(),
        get: vi.fn(() => ({ id: 'existing', name: 'dupe' })),
        all: vi.fn(() => []),
      };
      const mockDb = { prepare: vi.fn(() => mockStatement) } as any;

      expect(() => createSession(mockDb, 'dupe')).toThrow('Session name "dupe" already exists');
    });

    it('should use default mode of coder', () => {
      const callCount = { n: 0 };
      const mockStatement = {
        run: vi.fn(() => ({ lastInsertRowid: 1, changes: 1 })),
        get: vi.fn(() => {
          callCount.n++;
          if (callCount.n === 1) return undefined;
          return {
            id: 'session-1',
            name: 'test',
            mode: 'coder',
            working_directory: null,
            created_at: '2024-01-01',
            updated_at: '2024-01-01',
          };
        }),
        all: vi.fn(() => []),
      };
      const mockDb = { prepare: vi.fn(() => mockStatement) } as any;

      const session = createSession(mockDb, 'test');

      expect(session.mode).toBe('coder');
      // The INSERT should include 'coder' as the mode
      expect(mockStatement.run).toHaveBeenCalledWith(
        expect.any(String), // id
        'test',
        'coder',
        null // workingDirectory
      );
    });
  });

  describe('getSession', () => {
    it('should return session when found', () => {
      const { mockDb, mockStatement } = createMockDb();
      const sessionData = {
        id: 'session-1',
        name: 'my-session',
        mode: 'coder',
        working_directory: '/path',
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
      };
      mockStatement.get.mockReturnValue(sessionData);

      const result = getSession(mockDb, 'session-1');

      expect(result).toEqual(sessionData);
      expect(mockStatement.get).toHaveBeenCalledWith('session-1');
    });

    it('should return null when not found', () => {
      const { mockDb, mockStatement } = createMockDb();
      mockStatement.get.mockReturnValue(undefined);

      const result = getSession(mockDb, 'nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('getSessions', () => {
    it('should return all sessions with telegram link status', () => {
      const { mockDb, mockStatement } = createMockDb();
      mockStatement.all.mockReturnValue([
        {
          id: 's1',
          name: 'Session 1',
          mode: 'coder',
          working_directory: null,
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
          telegram_linked: 1,
          telegram_group_name: 'Group',
        },
        {
          id: 's2',
          name: 'Session 2',
          mode: null,
          working_directory: '/path',
          created_at: '2024-01-02',
          updated_at: '2024-01-02',
          telegram_linked: 0,
          telegram_group_name: null,
        },
      ]);

      const sessions = getSessions(mockDb);

      expect(sessions).toHaveLength(2);
      expect(sessions[0].telegram_linked).toBe(true);
      expect(sessions[0].telegram_group_name).toBe('Group');
      expect(sessions[1].telegram_linked).toBe(false);
      expect(sessions[1].mode).toBe('coder'); // default when null
    });

    it('should return empty array when no sessions exist', () => {
      const { mockDb, mockStatement } = createMockDb();
      mockStatement.all.mockReturnValue([]);

      const sessions = getSessions(mockDb);

      expect(sessions).toEqual([]);
    });
  });

  describe('getSessionByName', () => {
    it('should return session when found by name', () => {
      const { mockDb, mockStatement } = createMockDb();
      const sessionData = {
        id: 's1',
        name: 'my-session',
        mode: 'coder',
        working_directory: null,
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
      };
      mockStatement.get.mockReturnValue(sessionData);

      const result = getSessionByName(mockDb, 'my-session');

      expect(result).toEqual(sessionData);
      expect(mockStatement.get).toHaveBeenCalledWith('my-session');
    });

    it('should return null when not found', () => {
      const { mockDb, mockStatement } = createMockDb();
      mockStatement.get.mockReturnValue(undefined);

      const result = getSessionByName(mockDb, 'nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('renameSession', () => {
    it('should rename a session successfully', () => {
      const { mockDb, mockStatement } = createMockDb();
      // getSessionByName returns null (no conflict)
      mockStatement.get.mockReturnValue(undefined);
      mockStatement.run.mockReturnValue({ changes: 1 });

      const result = renameSession(mockDb, 'session-1', 'new-name');

      expect(result).toBe(true);
    });

    it('should rename with working directory', () => {
      const { mockDb, mockStatement } = createMockDb();
      mockStatement.get.mockReturnValue(undefined);
      mockStatement.run.mockReturnValue({ changes: 1 });

      const result = renameSession(mockDb, 'session-1', 'new-name', '/new/path');

      expect(result).toBe(true);
      expect(mockStatement.run).toHaveBeenCalledWith('new-name', '/new/path', 'session-1');
    });

    it('should throw if new name already taken by another session', () => {
      const { mockDb, mockStatement } = createMockDb();
      // getSessionByName returns a different session
      mockStatement.get.mockReturnValue({ id: 'other-session', name: 'taken-name' });

      expect(() => renameSession(mockDb, 'session-1', 'taken-name')).toThrow(
        'Session name "taken-name" already exists'
      );
    });

    it('should allow renaming to same name if same session', () => {
      const { mockDb, mockStatement } = createMockDb();
      // getSessionByName returns the same session
      mockStatement.get.mockReturnValue({ id: 'session-1', name: 'same-name' });
      mockStatement.run.mockReturnValue({ changes: 1 });

      const result = renameSession(mockDb, 'session-1', 'same-name');

      expect(result).toBe(true);
    });

    it('should return false when session does not exist', () => {
      const { mockDb, mockStatement } = createMockDb();
      mockStatement.get.mockReturnValue(undefined);
      mockStatement.run.mockReturnValue({ changes: 0 });

      const result = renameSession(mockDb, 'nonexistent', 'new-name');

      expect(result).toBe(false);
    });
  });

  describe('deleteSession', () => {
    it('should delete session and all related data', () => {
      const { mockDb, mockStatement } = createMockDb();
      mockStatement.run.mockReturnValue({ changes: 1 });

      const result = deleteSession(mockDb, 'session-1');

      expect(result).toBe(true);
      // Should prepare multiple DELETE statements for related tables
      const prepareCalls = mockDb.prepare.mock.calls.map((c: string[]) => c[0]);
      expect(prepareCalls.some((sql: string) => sql.includes('DELETE FROM message_embeddings'))).toBe(true);
      expect(prepareCalls.some((sql: string) => sql.includes('DELETE FROM messages'))).toBe(true);
      expect(prepareCalls.some((sql: string) => sql.includes('DELETE FROM summaries'))).toBe(true);
      expect(prepareCalls.some((sql: string) => sql.includes('DELETE FROM rolling_summaries'))).toBe(true);
      expect(prepareCalls.some((sql: string) => sql.includes('DELETE FROM calendar_events'))).toBe(true);
      expect(prepareCalls.some((sql: string) => sql.includes('DELETE FROM tasks'))).toBe(true);
      expect(prepareCalls.some((sql: string) => sql.includes('DELETE FROM cron_jobs'))).toBe(true);
      expect(prepareCalls.some((sql: string) => sql.includes('DELETE FROM telegram_chat_sessions'))).toBe(true);
      expect(prepareCalls.some((sql: string) => sql.includes('DELETE FROM sessions'))).toBe(true);
    });

    it('should return false when session not found', () => {
      const { mockDb, mockStatement } = createMockDb();
      mockStatement.run.mockReturnValue({ changes: 0 });

      const result = deleteSession(mockDb, 'nonexistent');

      expect(result).toBe(false);
    });
  });

  describe('touchSession', () => {
    it('should update the updated_at timestamp', () => {
      const { mockDb, mockStatement } = createMockDb();

      touchSession(mockDb, 'session-1');

      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE sessions SET updated_at')
      );
      expect(mockStatement.run).toHaveBeenCalledWith('session-1');
    });
  });

  describe('getSessionWorkingDirectory', () => {
    it('should return working directory when set', () => {
      const { mockDb, mockStatement } = createMockDb();
      mockStatement.get.mockReturnValue({ working_directory: '/my/project' });

      const dir = getSessionWorkingDirectory(mockDb, 'session-1');

      expect(dir).toBe('/my/project');
    });

    it('should return null when not set', () => {
      const { mockDb, mockStatement } = createMockDb();
      mockStatement.get.mockReturnValue({ working_directory: null });

      const dir = getSessionWorkingDirectory(mockDb, 'session-1');

      expect(dir).toBeNull();
    });

    it('should return null when session not found', () => {
      const { mockDb, mockStatement } = createMockDb();
      mockStatement.get.mockReturnValue(undefined);

      const dir = getSessionWorkingDirectory(mockDb, 'nonexistent');

      expect(dir).toBeNull();
    });
  });

  describe('setSessionWorkingDirectory', () => {
    it('should update working directory', () => {
      const { mockDb, mockStatement } = createMockDb();

      setSessionWorkingDirectory(mockDb, 'session-1', '/new/path');

      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE sessions SET working_directory')
      );
      expect(mockStatement.run).toHaveBeenCalledWith('/new/path', 'session-1');
    });

    it('should allow setting to null', () => {
      const { mockDb, mockStatement } = createMockDb();

      setSessionWorkingDirectory(mockDb, 'session-1', null);

      expect(mockStatement.run).toHaveBeenCalledWith(null, 'session-1');
    });
  });
});
