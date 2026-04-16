import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock better-sqlite3 before importing modules
vi.mock('better-sqlite3', () => {
  return { default: vi.fn() };
});

import {
  getTodayDate,
  getDailyLog,
  appendToDailyLog,
  getDailyLogsSince,
  deleteDailyLog,
  getDailyLogsContext,
} from '../../src/memory/daily-logs';

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

describe('daily-logs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  describe('getTodayDate', () => {
    it('should return date in YYYY-MM-DD format', () => {
      const result = getTodayDate();
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('should return the current date', () => {
      const now = new Date();
      const expected = now.toISOString().split('T')[0];
      expect(getTodayDate()).toBe(expected);
    });
  });

  describe('getDailyLog', () => {
    it('should return a daily log when found', () => {
      const { mockDb, mockStatement } = createMockDb();
      const log = {
        id: 1,
        date: '2024-06-15',
        content: 'Did some work',
        updated_at: '2024-06-15T12:00:00Z',
      };
      mockStatement.get.mockReturnValue(log);

      const result = getDailyLog(mockDb, '2024-06-15');

      expect(result).toEqual(log);
      expect(mockStatement.get).toHaveBeenCalledWith('2024-06-15');
    });

    it('should return null when not found', () => {
      const { mockDb, mockStatement } = createMockDb();
      mockStatement.get.mockReturnValue(undefined);

      const result = getDailyLog(mockDb, '2024-06-15');

      expect(result).toBeNull();
    });

    it('should default to today when no date provided', () => {
      const { mockDb, mockStatement } = createMockDb();
      mockStatement.get.mockReturnValue(undefined);
      const today = getTodayDate();

      getDailyLog(mockDb);

      expect(mockStatement.get).toHaveBeenCalledWith(today);
    });
  });

  describe('appendToDailyLog', () => {
    it('should create a new log when none exists for today', () => {
      const callCount = { n: 0 };
      const today = getTodayDate();
      const mockStatement = {
        run: vi.fn(() => ({ lastInsertRowid: 1, changes: 1 })),
        get: vi.fn(() => {
          callCount.n++;
          // First call: getDailyLog(db, today) check - not found
          if (callCount.n === 1) return undefined;
          // Second call: getDailyLog(db, today) at the end - return created log
          return {
            id: 1,
            date: today,
            content: expect.any(String),
            updated_at: '2024-01-01T00:00:00Z',
          };
        }),
        all: vi.fn(() => []),
      };
      const mockDb = { prepare: vi.fn(() => mockStatement) } as any;

      const result = appendToDailyLog(mockDb, 'Started new project');

      expect(result).toBeDefined();
      // Should have called INSERT (not UPDATE)
      const prepareCalls = mockDb.prepare.mock.calls.map((c: string[]) => c[0]);
      expect(prepareCalls.some((sql: string) => sql.includes('INSERT INTO daily_logs'))).toBe(true);
    });

    it('should append to existing log', () => {
      const today = getTodayDate();
      const callCount = { n: 0 };
      const mockStatement = {
        run: vi.fn(() => ({ lastInsertRowid: 1, changes: 1 })),
        get: vi.fn(() => {
          callCount.n++;
          // First call: getDailyLog check - exists
          if (callCount.n === 1) {
            return {
              id: 1,
              date: today,
              content: '[10:00 AM] Existing entry',
              updated_at: '2024-01-01',
            };
          }
          // Second call: getDailyLog after update
          return {
            id: 1,
            date: today,
            content: '[10:00 AM] Existing entry\n[02:30 PM] New entry',
            updated_at: '2024-01-01',
          };
        }),
        all: vi.fn(() => []),
      };
      const mockDb = { prepare: vi.fn(() => mockStatement) } as any;

      const result = appendToDailyLog(mockDb, 'New entry');

      expect(result).toBeDefined();
      // Should have called UPDATE (not INSERT)
      const prepareCalls = mockDb.prepare.mock.calls.map((c: string[]) => c[0]);
      expect(prepareCalls.some((sql: string) => sql.includes('UPDATE daily_logs'))).toBe(true);
    });

    it('should format entry with timestamp', () => {
      const today = getTodayDate();
      const callCount = { n: 0 };
      const mockStatement = {
        run: vi.fn(() => ({ lastInsertRowid: 1, changes: 1 })),
        get: vi.fn(() => {
          callCount.n++;
          if (callCount.n === 1) return undefined;
          return { id: 1, date: today, content: 'test', updated_at: 'now' };
        }),
        all: vi.fn(() => []),
      };
      const mockDb = { prepare: vi.fn(() => mockStatement) } as any;

      appendToDailyLog(mockDb, 'My log entry');

      // The INSERT run call should have the today date and formatted content with timestamp
      const runCalls = mockStatement.run.mock.calls;
      // The INSERT call has (today, formattedEntry)
      const insertCall = runCalls.find((c: any[]) => c[0] === today);
      expect(insertCall).toBeDefined();
      // Content should contain the entry
      expect(insertCall![1]).toContain('My log entry');
      // Content should have a timestamp format like [HH:MM AM/PM]
      expect(insertCall![1]).toMatch(/\[\d{2}:\d{2}\s*(AM|PM)\]/);
    });
  });

  describe('getDailyLogsSince', () => {
    it('should return logs from last N days', () => {
      const { mockDb, mockStatement } = createMockDb();
      const logs = [
        { id: 2, date: '2024-06-15', content: 'Day 2', updated_at: '2024-06-15' },
        { id: 1, date: '2024-06-14', content: 'Day 1', updated_at: '2024-06-14' },
      ];
      mockStatement.all.mockReturnValue(logs);

      const result = getDailyLogsSince(mockDb, 3);

      expect(result).toHaveLength(2);
      expect(mockStatement.all).toHaveBeenCalledWith('-3 days');
    });

    it('should default to 3 days', () => {
      const { mockDb, mockStatement } = createMockDb();
      mockStatement.all.mockReturnValue([]);

      getDailyLogsSince(mockDb);

      expect(mockStatement.all).toHaveBeenCalledWith('-3 days');
    });

    it('should return empty array when no logs found', () => {
      const { mockDb, mockStatement } = createMockDb();
      mockStatement.all.mockReturnValue([]);

      const result = getDailyLogsSince(mockDb, 7);

      expect(result).toEqual([]);
    });
  });

  describe('deleteDailyLog', () => {
    it('should delete a log and return true', () => {
      const { mockDb, mockStatement } = createMockDb();
      mockStatement.run.mockReturnValue({ changes: 1 });

      const result = deleteDailyLog(mockDb, 1);

      expect(result).toBe(true);
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM daily_logs')
      );
      expect(mockStatement.run).toHaveBeenCalledWith(1);
    });

    it('should return false when log not found', () => {
      const { mockDb, mockStatement } = createMockDb();
      mockStatement.run.mockReturnValue({ changes: 0 });

      const result = deleteDailyLog(mockDb, 999);

      expect(result).toBe(false);
    });
  });

  describe('getDailyLogsContext', () => {
    it('should return empty string when no logs', () => {
      const { mockDb, mockStatement } = createMockDb();
      mockStatement.all.mockReturnValue([]);

      const result = getDailyLogsContext(mockDb);

      expect(result).toBe('');
    });

    it('should format logs as context string', () => {
      const { mockDb, mockStatement } = createMockDb();
      mockStatement.all.mockReturnValue([
        {
          id: 2,
          date: '2024-06-15',
          content: 'Worked on feature X',
          updated_at: '2024-06-15',
        },
        {
          id: 1,
          date: '2024-06-14',
          content: 'Fixed bug Y',
          updated_at: '2024-06-14',
        },
      ]);

      const result = getDailyLogsContext(mockDb);

      expect(result).toContain('## Recent Daily Logs');
      expect(result).toContain('Fixed bug Y');
      expect(result).toContain('Worked on feature X');
    });

    it('should label today\'s log as "Today"', () => {
      const today = getTodayDate();
      const { mockDb, mockStatement } = createMockDb();
      mockStatement.all.mockReturnValue([
        {
          id: 1,
          date: today,
          content: 'Today\'s work',
          updated_at: today,
        },
      ]);

      const result = getDailyLogsContext(mockDb);

      expect(result).toContain('### Today');
      expect(result).toContain('Today\'s work');
    });

    it('should show oldest first after reverse', () => {
      const { mockDb, mockStatement } = createMockDb();
      // DB returns DESC order (newest first)
      mockStatement.all.mockReturnValue([
        { id: 3, date: '2024-06-16', content: 'Day 3', updated_at: '2024-06-16' },
        { id: 2, date: '2024-06-15', content: 'Day 2', updated_at: '2024-06-15' },
        { id: 1, date: '2024-06-14', content: 'Day 1', updated_at: '2024-06-14' },
      ]);

      const result = getDailyLogsContext(mockDb);

      // After reverse, Day 1 should come before Day 3
      const day1Pos = result.indexOf('Day 1');
      const day3Pos = result.indexOf('Day 3');
      expect(day1Pos).toBeLessThan(day3Pos);
    });

    it('should accept custom days parameter', () => {
      const { mockDb, mockStatement } = createMockDb();
      mockStatement.all.mockReturnValue([]);

      getDailyLogsContext(mockDb, 7);

      expect(mockStatement.all).toHaveBeenCalledWith('-7 days');
    });
  });
});
