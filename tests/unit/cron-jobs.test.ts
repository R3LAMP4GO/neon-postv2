import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock better-sqlite3 before importing modules
vi.mock('better-sqlite3', () => {
  return { default: vi.fn() };
});

import {
  saveCronJob,
  getCronJobs,
  setCronJobEnabled,
  deleteCronJob,
} from '../../src/memory/cron-jobs';

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

describe('cron-jobs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('saveCronJob', () => {
    it('should insert a cron job and return its id', () => {
      const { mockDb, mockStatement } = createMockDb();
      mockStatement.run.mockReturnValue({ lastInsertRowid: 7, changes: 1 });

      const id = saveCronJob(mockDb, 'daily-report', '0 9 * * *', 'Generate report', 'desktop');

      expect(id).toBe(7);
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO cron_jobs')
      );
      expect(mockStatement.run).toHaveBeenCalledWith(
        'daily-report',
        '0 9 * * *',
        'Generate report',
        'desktop',
        'default' // default session
      );
    });

    it('should use default channel and session', () => {
      const { mockDb, mockStatement } = createMockDb();
      mockStatement.run.mockReturnValue({ lastInsertRowid: 1, changes: 1 });

      saveCronJob(mockDb, 'test', '* * * * *', 'prompt');

      expect(mockStatement.run).toHaveBeenCalledWith(
        'test',
        '* * * * *',
        'prompt',
        'default',
        'default'
      );
    });

    it('should support custom session id', () => {
      const { mockDb, mockStatement } = createMockDb();
      mockStatement.run.mockReturnValue({ lastInsertRowid: 1, changes: 1 });

      saveCronJob(mockDb, 'test', '0 * * * *', 'prompt', 'telegram', 'session-42');

      expect(mockStatement.run).toHaveBeenCalledWith(
        'test',
        '0 * * * *',
        'prompt',
        'telegram',
        'session-42'
      );
    });

    it('should use ON CONFLICT for upsert behavior', () => {
      const { mockDb } = createMockDb();

      saveCronJob(mockDb, 'dup-job', '0 0 * * *', 'old prompt');

      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('ON CONFLICT(name) DO UPDATE')
      );
    });
  });

  describe('getCronJobs', () => {
    it('should return enabled jobs by default', () => {
      const { mockDb, mockStatement } = createMockDb();
      mockStatement.all.mockReturnValue([
        {
          id: 1,
          name: 'job1',
          schedule_type: 'cron',
          schedule: '0 9 * * *',
          run_at: null,
          interval_ms: null,
          prompt: 'test',
          channel: 'default',
          enabled: 1,
          delete_after_run: 0,
          context_messages: 0,
          next_run_at: null,
          session_id: null,
          job_type: 'routine',
        },
      ]);

      const jobs = getCronJobs(mockDb);

      expect(jobs).toHaveLength(1);
      expect(jobs[0].enabled).toBe(true);
      expect(jobs[0].delete_after_run).toBe(false);
      expect(jobs[0].job_type).toBe('routine');
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('WHERE enabled = 1')
      );
    });

    it('should return all jobs when enabledOnly is false', () => {
      const { mockDb, mockStatement } = createMockDb();
      mockStatement.all.mockReturnValue([
        {
          id: 1,
          name: 'job1',
          schedule_type: 'cron',
          schedule: '0 9 * * *',
          run_at: null,
          interval_ms: null,
          prompt: 'test',
          channel: 'default',
          enabled: 0,
          delete_after_run: 1,
          context_messages: 5,
          next_run_at: null,
          session_id: 'session-1',
          job_type: null,
        },
      ]);

      const jobs = getCronJobs(mockDb, false);

      expect(jobs).toHaveLength(1);
      expect(jobs[0].enabled).toBe(false);
      expect(jobs[0].delete_after_run).toBe(true);
      expect(jobs[0].job_type).toBe('routine'); // default when null
    });

    it('should convert numeric booleans to real booleans', () => {
      const { mockDb, mockStatement } = createMockDb();
      mockStatement.all.mockReturnValue([
        {
          id: 1,
          name: 'j',
          schedule_type: 'at',
          schedule: null,
          run_at: '2024-01-01',
          interval_ms: null,
          prompt: 'test',
          channel: 'default',
          enabled: 1,
          delete_after_run: 1,
          context_messages: 0,
          next_run_at: '2024-01-01',
          session_id: null,
          job_type: 'reminder',
        },
      ]);

      const jobs = getCronJobs(mockDb);

      expect(jobs[0].enabled).toBe(true);
      expect(jobs[0].delete_after_run).toBe(true);
      expect(jobs[0].job_type).toBe('reminder');
    });

    it('should return empty array when no jobs exist', () => {
      const { mockDb, mockStatement } = createMockDb();
      mockStatement.all.mockReturnValue([]);

      const jobs = getCronJobs(mockDb);

      expect(jobs).toEqual([]);
    });
  });

  describe('setCronJobEnabled', () => {
    it('should enable a job and return true', () => {
      const { mockDb, mockStatement } = createMockDb();
      mockStatement.run.mockReturnValue({ changes: 1 });

      const result = setCronJobEnabled(mockDb, 'my-job', true);

      expect(result).toBe(true);
      expect(mockStatement.run).toHaveBeenCalledWith(1, 'my-job');
    });

    it('should disable a job and return true', () => {
      const { mockDb, mockStatement } = createMockDb();
      mockStatement.run.mockReturnValue({ changes: 1 });

      const result = setCronJobEnabled(mockDb, 'my-job', false);

      expect(result).toBe(true);
      expect(mockStatement.run).toHaveBeenCalledWith(0, 'my-job');
    });

    it('should return false when job not found', () => {
      const { mockDb, mockStatement } = createMockDb();
      mockStatement.run.mockReturnValue({ changes: 0 });

      const result = setCronJobEnabled(mockDb, 'nonexistent', true);

      expect(result).toBe(false);
    });
  });

  describe('deleteCronJob', () => {
    it('should delete a job and return true', () => {
      const { mockDb, mockStatement } = createMockDb();
      mockStatement.run.mockReturnValue({ changes: 1 });

      const result = deleteCronJob(mockDb, 'my-job');

      expect(result).toBe(true);
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM cron_jobs')
      );
      expect(mockStatement.run).toHaveBeenCalledWith('my-job');
    });

    it('should return false when job not found', () => {
      const { mockDb, mockStatement } = createMockDb();
      mockStatement.run.mockReturnValue({ changes: 0 });

      const result = deleteCronJob(mockDb, 'nonexistent');

      expect(result).toBe(false);
    });
  });
});
