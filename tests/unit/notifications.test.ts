/**
 * Unit tests for scheduler notification utilities
 *
 * Tests stripMarkdown, sendToAllChannels, and sendReminderToAllChannels.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  stripMarkdown,
  sendToAllChannels,
  sendReminderToAllChannels,
  type NotificationChannels,
} from '../../src/scheduler/notifications';

function createMockChannels(overrides?: Partial<NotificationChannels>): NotificationChannels {
  return {
    onNotification: vi.fn(),
    onChatMessage: vi.fn(),
    onIOSSync: vi.fn(),
    telegramBot: null,
    memory: null,
    ...overrides,
  };
}

describe('Notifications', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // ============ stripMarkdown ============

  describe('stripMarkdown', () => {
    it('should remove H1 headers', () => {
      expect(stripMarkdown('# Hello')).toBe('Hello');
    });

    it('should remove H2 headers', () => {
      expect(stripMarkdown('## Hello')).toBe('Hello');
    });

    it('should remove H3-H6 headers', () => {
      expect(stripMarkdown('### Hello')).toBe('Hello');
      expect(stripMarkdown('#### Hello')).toBe('Hello');
      expect(stripMarkdown('###### Hello')).toBe('Hello');
    });

    it('should remove bold (**) formatting', () => {
      expect(stripMarkdown('**bold text**')).toBe('bold text');
    });

    it('should remove italic (*) formatting', () => {
      expect(stripMarkdown('*italic text*')).toBe('italic text');
    });

    it('should remove bold (__) formatting', () => {
      expect(stripMarkdown('__bold text__')).toBe('bold text');
    });

    it('should remove italic (_) formatting', () => {
      expect(stripMarkdown('_italic text_')).toBe('italic text');
    });

    it('should replace code blocks with [code]', () => {
      expect(stripMarkdown('```js\nconsole.log("hi")\n```')).toBe('[code]');
    });

    it('should remove inline code backticks', () => {
      expect(stripMarkdown('use `npm install` here')).toBe('use npm install here');
    });

    it('should remove markdown links but keep text', () => {
      expect(stripMarkdown('[Google](https://google.com)')).toBe('Google');
    });

    it('should convert bullet points to bullets', () => {
      expect(stripMarkdown('- item one')).toBe('• item one');
      expect(stripMarkdown('* item two')).toBe('• item two');
      expect(stripMarkdown('+ item three')).toBe('• item three');
    });

    it('should collapse triple+ newlines to double', () => {
      expect(stripMarkdown('line one\n\n\n\nline two')).toBe('line one\n\nline two');
    });

    it('should trim whitespace', () => {
      expect(stripMarkdown('  hello  ')).toBe('hello');
    });

    it('should handle empty string', () => {
      expect(stripMarkdown('')).toBe('');
    });

    it('should handle plain text with no markdown', () => {
      expect(stripMarkdown('just plain text')).toBe('just plain text');
    });

    it('should handle combined markdown', () => {
      const input = '# Title\n\n**Bold** and *italic*\n\n- item\n\n[link](http://x.com)';
      const result = stripMarkdown(input);
      expect(result).not.toContain('#');
      expect(result).not.toContain('**');
      expect(result).not.toContain('*');
      expect(result).toContain('Title');
      expect(result).toContain('Bold');
      expect(result).toContain('italic');
      expect(result).toContain('• item');
      expect(result).toContain('link');
    });
  });

  // ============ sendToAllChannels ============

  describe('sendToAllChannels', () => {
    it('should send to desktop chat handler', async () => {
      const channels = createMockChannels();

      await sendToAllChannels(channels, 'Test Job', 'prompt', 'response', 'session-1');

      expect(channels.onChatMessage).toHaveBeenCalledWith(
        'Test Job',
        'prompt',
        'response',
        'session-1'
      );
    });

    it('should send desktop notification with stripped markdown', async () => {
      const channels = createMockChannels();

      await sendToAllChannels(channels, 'Job', 'prompt', '**bold response**', 'session-1');

      expect(channels.onNotification).toHaveBeenCalledWith('Neon Post', 'bold response');
    });

    it('should truncate notification body to 200 chars', async () => {
      const channels = createMockChannels();
      const longResponse = 'a'.repeat(300);

      await sendToAllChannels(channels, 'Job', 'prompt', longResponse, 'session-1');

      const notifCall = (channels.onNotification as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(notifCall[1].length).toBe(200);
    });

    it('should send to iOS sync handler', async () => {
      const channels = createMockChannels();

      await sendToAllChannels(channels, 'Job', 'prompt', 'response', 'session-1');

      expect(channels.onIOSSync).toHaveBeenCalledWith('Job', 'prompt', 'response', 'session-1');
    });

    it('should send to Telegram when bot and memory are configured', async () => {
      const mockSendMessage = vi.fn().mockResolvedValue(undefined);
      const mockMemory = { getChatForSession: vi.fn().mockReturnValue(12345) };
      const channels = createMockChannels({
        telegramBot: { sendMessage: mockSendMessage } as any,
        memory: mockMemory as any,
      });

      await sendToAllChannels(channels, 'Job', 'prompt', 'response', 'session-1');

      expect(mockSendMessage).toHaveBeenCalledWith(12345, '📅 Job\n\nresponse');
    });

    it('should send to specific recipient when provided', async () => {
      const mockSendMessage = vi.fn().mockResolvedValue(undefined);
      const mockMemory = { getChatForSession: vi.fn() };
      const channels = createMockChannels({
        telegramBot: { sendMessage: mockSendMessage } as any,
        memory: mockMemory as any,
      });

      await sendToAllChannels(channels, 'Job', 'prompt', 'response', 'session-1', '99999');

      expect(mockSendMessage).toHaveBeenCalledWith(99999, '📅 Job\n\nresponse');
      expect(mockMemory.getChatForSession).not.toHaveBeenCalled();
    });

    it('should not send to Telegram when no linked chat', async () => {
      const mockSendMessage = vi.fn();
      const mockMemory = { getChatForSession: vi.fn().mockReturnValue(null) };
      const channels = createMockChannels({
        telegramBot: { sendMessage: mockSendMessage } as any,
        memory: mockMemory as any,
      });

      await sendToAllChannels(channels, 'Job', 'prompt', 'response', 'session-1');

      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it('should not throw when handlers are undefined', async () => {
      const channels: NotificationChannels = {
        telegramBot: null,
        memory: null,
      };

      await expect(
        sendToAllChannels(channels, 'Job', 'prompt', 'response', 'session-1')
      ).resolves.toBeUndefined();
    });
  });

  // ============ sendReminderToAllChannels ============

  describe('sendReminderToAllChannels', () => {
    it('should send notification with message', async () => {
      const channels = createMockChannels();

      await sendReminderToAllChannels(channels, 'calendar', 'Meeting in 15 minutes', 'session-1');

      expect(channels.onNotification).toHaveBeenCalledWith('Neon Post', 'Meeting in 15 minutes');
    });

    it('should send calendar reminder to chat as calendar_reminder', async () => {
      const channels = createMockChannels();

      await sendReminderToAllChannels(channels, 'calendar', 'Meeting soon', 'session-1');

      expect(channels.onChatMessage).toHaveBeenCalledWith(
        'calendar_reminder',
        'Meeting soon',
        'Meeting soon',
        'session-1'
      );
    });

    it('should send task reminder to chat as task_reminder', async () => {
      const channels = createMockChannels();

      await sendReminderToAllChannels(channels, 'task', 'Task due', 'session-1');

      expect(channels.onChatMessage).toHaveBeenCalledWith(
        'task_reminder',
        'Task due',
        'Task due',
        'session-1'
      );
    });

    it('should send to iOS sync', async () => {
      const channels = createMockChannels();

      await sendReminderToAllChannels(channels, 'calendar', 'Reminder', 'session-1');

      expect(channels.onIOSSync).toHaveBeenCalledWith(
        'calendar_reminder',
        'Reminder',
        'Reminder',
        'session-1'
      );
    });

    it('should send to Telegram with calendar emoji for calendar type', async () => {
      const mockSendMessage = vi.fn().mockResolvedValue(undefined);
      const mockMemory = { getChatForSession: vi.fn().mockReturnValue(12345) };
      const channels = createMockChannels({
        telegramBot: { sendMessage: mockSendMessage } as any,
        memory: mockMemory as any,
      });

      await sendReminderToAllChannels(channels, 'calendar', 'Meeting now', 'session-1');

      expect(mockSendMessage).toHaveBeenCalledWith(12345, '📅 Meeting now');
    });

    it('should send to Telegram with checkmark emoji for task type', async () => {
      const mockSendMessage = vi.fn().mockResolvedValue(undefined);
      const mockMemory = { getChatForSession: vi.fn().mockReturnValue(12345) };
      const channels = createMockChannels({
        telegramBot: { sendMessage: mockSendMessage } as any,
        memory: mockMemory as any,
      });

      await sendReminderToAllChannels(channels, 'task', 'Task complete', 'session-1');

      expect(mockSendMessage).toHaveBeenCalledWith(12345, '✓ Task complete');
    });

    it('should not send to Telegram when no linked chat', async () => {
      const mockSendMessage = vi.fn();
      const mockMemory = { getChatForSession: vi.fn().mockReturnValue(null) };
      const channels = createMockChannels({
        telegramBot: { sendMessage: mockSendMessage } as any,
        memory: mockMemory as any,
      });

      await sendReminderToAllChannels(channels, 'calendar', 'msg', 'session-1');

      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it('should not throw when handlers are undefined', async () => {
      const channels: NotificationChannels = {
        telegramBot: null,
        memory: null,
      };

      await expect(
        sendReminderToAllChannels(channels, 'calendar', 'msg', 'session-1')
      ).resolves.toBeUndefined();
    });
  });
});
