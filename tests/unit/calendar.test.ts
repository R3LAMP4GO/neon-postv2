import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock better-sqlite3
vi.mock('better-sqlite3', () => {
  return { default: vi.fn() };
});

// Mock the notifications module
vi.mock('../../src/scheduler/notifications', () => ({
  sendReminderToAllChannels: vi.fn().mockResolvedValue(undefined),
  sendToAllChannels: vi.fn().mockResolvedValue(undefined),
  stripMarkdown: vi.fn((t: string) => t),
}));

import {
  formatForSqlite,
  checkCalendarEvents,
  checkTaskReminders,
} from '../../src/scheduler/calendar';
import { sendReminderToAllChannels } from '../../src/scheduler/notifications';

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

function createMockChannels() {
  return {
    onNotification: vi.fn(),
    onChatMessage: vi.fn(),
    onIOSSync: vi.fn(),
    telegramBot: null,
    memory: null,
  };
}

function createMockMemory() {
  return {
    saveMessage: vi.fn(),
    getChatForSession: vi.fn(() => null),
  } as any;
}

describe('calendar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('formatForSqlite', () => {
    it('should remove milliseconds and Z suffix from ISO string', () => {
      const date = new Date('2024-06-15T14:30:45.123Z');
      const result = formatForSqlite(date);

      expect(result).toBe('2024-06-15T14:30:45');
    });

    it('should handle dates without milliseconds correctly', () => {
      const date = new Date('2024-01-01T00:00:00.000Z');
      const result = formatForSqlite(date);

      expect(result).toBe('2024-01-01T00:00:00');
    });

    it('should produce a clean ISO-like format', () => {
      const date = new Date();
      const result = formatForSqlite(date);

      // Should match pattern YYYY-MM-DDTHH:MM:SS
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
    });

    it('should not contain Z suffix', () => {
      const date = new Date();
      const result = formatForSqlite(date);

      expect(result).not.toContain('Z');
      expect(result).not.toContain('.');
    });
  });

  describe('checkCalendarEvents', () => {
    it('should return empty array when no events are due', async () => {
      const { mockDb, mockStatement } = createMockDb();
      mockStatement.all.mockReturnValue([]);
      const channels = createMockChannels();

      const results = await checkCalendarEvents(
        mockDb,
        new Date(),
        '2024-06-15T14:30:45',
        channels,
        null
      );

      expect(results).toEqual([]);
    });

    it('should send reminders for due events', async () => {
      const { mockDb, mockStatement } = createMockDb();
      const now = new Date('2024-06-15T14:25:00Z');
      const eventStartTime = new Date('2024-06-15T14:30:00Z'); // 5 minutes from now

      mockStatement.all.mockReturnValue([
        {
          id: 1,
          title: 'Team Meeting',
          description: 'Weekly sync',
          start_time: eventStartTime.toISOString(),
          location: 'Room 42',
          reminder_minutes: 10,
          channel: 'default',
          session_id: 'session-1',
        },
      ]);
      const channels = createMockChannels();
      const memory = createMockMemory();

      const results = await checkCalendarEvents(
        mockDb,
        now,
        formatForSqlite(now),
        channels,
        memory
      );

      expect(results).toHaveLength(1);
      expect(results[0].jobName).toBe('calendar:Team Meeting');
      expect(results[0].success).toBe(true);
      expect(results[0].response).toContain('Team Meeting');
      expect(results[0].response).toContain('Room 42');
    });

    it('should mark events as reminded', async () => {
      const { mockDb, mockStatement } = createMockDb();
      const now = new Date('2024-06-15T14:25:00Z');
      mockStatement.all.mockReturnValue([
        {
          id: 5,
          title: 'Event',
          description: null,
          start_time: new Date('2024-06-15T14:30:00Z').toISOString(),
          location: null,
          reminder_minutes: 10,
          channel: 'default',
          session_id: null,
        },
      ]);
      const channels = createMockChannels();

      await checkCalendarEvents(mockDb, now, formatForSqlite(now), channels, null);

      // Should have prepared UPDATE for marking as reminded
      const prepareCalls = mockDb.prepare.mock.calls.map((c: string[]) => c[0]);
      expect(prepareCalls.some((sql: string) => sql.includes('UPDATE calendar_events SET reminded = 1'))).toBe(true);
      expect(mockStatement.run).toHaveBeenCalledWith(5);
    });

    it('should save reminder to messages when memory is provided', async () => {
      const { mockDb, mockStatement } = createMockDb();
      const now = new Date('2024-06-15T14:25:00Z');
      mockStatement.all.mockReturnValue([
        {
          id: 1,
          title: 'Event',
          description: null,
          start_time: new Date('2024-06-15T14:30:00Z').toISOString(),
          location: null,
          reminder_minutes: 10,
          channel: 'default',
          session_id: 'session-1',
        },
      ]);
      const channels = createMockChannels();
      const memory = createMockMemory();

      await checkCalendarEvents(mockDb, now, formatForSqlite(now), channels, memory);

      expect(memory.saveMessage).toHaveBeenCalledWith(
        'assistant',
        expect.stringContaining('Event'),
        'session-1',
        expect.objectContaining({ source: 'scheduler', jobName: 'calendar_reminder' })
      );
    });

    it('should include minutes until event in message', async () => {
      const { mockDb, mockStatement } = createMockDb();
      const now = new Date('2024-06-15T14:25:00Z');
      mockStatement.all.mockReturnValue([
        {
          id: 1,
          title: 'Meeting',
          description: null,
          start_time: new Date('2024-06-15T14:30:00Z').toISOString(),
          location: null,
          reminder_minutes: 10,
          channel: 'default',
          session_id: null,
        },
      ]);
      const channels = createMockChannels();

      const results = await checkCalendarEvents(mockDb, now, formatForSqlite(now), channels, null);

      expect(results[0].response).toContain('5 minutes');
    });

    it('should say "starting now" when time has come', async () => {
      const { mockDb, mockStatement } = createMockDb();
      const now = new Date('2024-06-15T14:30:00Z');
      mockStatement.all.mockReturnValue([
        {
          id: 1,
          title: 'Meeting',
          description: null,
          start_time: now.toISOString(),
          location: null,
          reminder_minutes: 10,
          channel: 'default',
          session_id: null,
        },
      ]);
      const channels = createMockChannels();

      const results = await checkCalendarEvents(mockDb, now, formatForSqlite(now), channels, null);

      expect(results[0].response).toContain('starting now');
    });

    it('should use default session when session_id is null', async () => {
      const { mockDb, mockStatement } = createMockDb();
      const now = new Date('2024-06-15T14:25:00Z');
      mockStatement.all.mockReturnValue([
        {
          id: 1,
          title: 'Event',
          description: null,
          start_time: new Date('2024-06-15T14:30:00Z').toISOString(),
          location: null,
          reminder_minutes: 10,
          channel: 'default',
          session_id: null,
        },
      ]);
      const channels = createMockChannels();

      await checkCalendarEvents(mockDb, now, formatForSqlite(now), channels, null);

      expect(sendReminderToAllChannels).toHaveBeenCalledWith(
        channels,
        'calendar',
        expect.any(String),
        'default'
      );
    });
  });

  describe('checkTaskReminders', () => {
    it('should return empty array when no tasks are due', async () => {
      const { mockDb, mockStatement } = createMockDb();
      mockStatement.all.mockReturnValue([]);
      const channels = createMockChannels();

      const results = await checkTaskReminders(
        mockDb,
        new Date(),
        '2024-06-15T14:30:45',
        channels,
        null
      );

      expect(results).toEqual([]);
    });

    it('should send reminders for due tasks', async () => {
      const { mockDb, mockStatement } = createMockDb();
      const now = new Date('2024-06-15T14:25:00Z');
      mockStatement.all.mockReturnValue([
        {
          id: 1,
          title: 'Fix bug #123',
          description: 'Critical issue',
          due_date: new Date('2024-06-15T14:30:00Z').toISOString(),
          priority: 'high',
          reminder_minutes: 10,
          channel: 'default',
          session_id: 'session-1',
        },
      ]);
      const channels = createMockChannels();
      const memory = createMockMemory();

      const results = await checkTaskReminders(
        mockDb,
        now,
        formatForSqlite(now),
        channels,
        memory
      );

      expect(results).toHaveLength(1);
      expect(results[0].jobName).toBe('task:Fix bug #123');
      expect(results[0].success).toBe(true);
      expect(results[0].response).toContain('Fix bug #123');
      expect(results[0].response).toContain('High Priority');
    });

    it('should mark tasks as reminded', async () => {
      const { mockDb, mockStatement } = createMockDb();
      const now = new Date('2024-06-15T14:25:00Z');
      mockStatement.all.mockReturnValue([
        {
          id: 10,
          title: 'Task',
          description: null,
          due_date: new Date('2024-06-15T14:30:00Z').toISOString(),
          priority: 'normal',
          reminder_minutes: 10,
          channel: 'default',
          session_id: null,
        },
      ]);
      const channels = createMockChannels();

      await checkTaskReminders(mockDb, now, formatForSqlite(now), channels, null);

      const prepareCalls = mockDb.prepare.mock.calls.map((c: string[]) => c[0]);
      expect(prepareCalls.some((sql: string) => sql.includes('UPDATE tasks SET reminded = 1'))).toBe(true);
      expect(mockStatement.run).toHaveBeenCalledWith(10);
    });

    it('should not include High Priority for non-high tasks', async () => {
      const { mockDb, mockStatement } = createMockDb();
      const now = new Date('2024-06-15T14:25:00Z');
      mockStatement.all.mockReturnValue([
        {
          id: 1,
          title: 'Normal task',
          description: null,
          due_date: new Date('2024-06-15T14:30:00Z').toISOString(),
          priority: 'normal',
          reminder_minutes: 10,
          channel: 'default',
          session_id: null,
        },
      ]);
      const channels = createMockChannels();

      const results = await checkTaskReminders(mockDb, now, formatForSqlite(now), channels, null);

      expect(results[0].response).not.toContain('High Priority');
    });

    it('should say "due now" when time has come', async () => {
      const { mockDb, mockStatement } = createMockDb();
      const now = new Date('2024-06-15T14:30:00Z');
      mockStatement.all.mockReturnValue([
        {
          id: 1,
          title: 'Task',
          description: null,
          due_date: now.toISOString(),
          priority: 'normal',
          reminder_minutes: 10,
          channel: 'default',
          session_id: null,
        },
      ]);
      const channels = createMockChannels();

      const results = await checkTaskReminders(mockDb, now, formatForSqlite(now), channels, null);

      expect(results[0].response).toContain('due now');
    });

    it('should save reminder to messages when memory is provided', async () => {
      const { mockDb, mockStatement } = createMockDb();
      const now = new Date('2024-06-15T14:25:00Z');
      mockStatement.all.mockReturnValue([
        {
          id: 1,
          title: 'Task',
          description: null,
          due_date: new Date('2024-06-15T14:30:00Z').toISOString(),
          priority: 'normal',
          reminder_minutes: 10,
          channel: 'default',
          session_id: 'session-2',
        },
      ]);
      const channels = createMockChannels();
      const memory = createMockMemory();

      await checkTaskReminders(mockDb, now, formatForSqlite(now), channels, memory);

      expect(memory.saveMessage).toHaveBeenCalledWith(
        'assistant',
        expect.stringContaining('Task'),
        'session-2',
        expect.objectContaining({ source: 'scheduler', jobName: 'task_reminder' })
      );
    });

    it('should send reminder to all channels', async () => {
      const { mockDb, mockStatement } = createMockDb();
      const now = new Date('2024-06-15T14:25:00Z');
      mockStatement.all.mockReturnValue([
        {
          id: 1,
          title: 'Task',
          description: null,
          due_date: new Date('2024-06-15T14:30:00Z').toISOString(),
          priority: 'normal',
          reminder_minutes: 10,
          channel: 'default',
          session_id: null,
        },
      ]);
      const channels = createMockChannels();

      await checkTaskReminders(mockDb, now, formatForSqlite(now), channels, null);

      expect(sendReminderToAllChannels).toHaveBeenCalledWith(
        channels,
        'task',
        expect.stringContaining('Task'),
        'default'
      );
    });
  });
});
