import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock grammy before importing modules
vi.mock('grammy', () => {
  return {
    Bot: vi.fn(),
    Api: vi.fn(),
    InlineKeyboard: vi.fn(),
  };
});

import {
  createReactionHandler,
  sendReaction,
  AgentReactions,
} from '../../src/channels/telegram/features/reactions';
import type { ReactionData } from '../../src/channels/telegram/types';

describe('reactions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('AgentReactions', () => {
    it('should have all expected reaction shortcuts', () => {
      expect(AgentReactions.acknowledge).toBe('👍');
      expect(AgentReactions.thinking).toBe('🤔');
      expect(AgentReactions.done).toBe('✍️');
      expect(AgentReactions.error).toBe('😢');
      expect(AgentReactions.love).toBe('❤️');
      expect(AgentReactions.celebrate).toBe('🎉');
      expect(AgentReactions.understood).toBe('👌');
      expect(AgentReactions.working).toBe('🔥');
    });

    it('should be a frozen-like const object', () => {
      // AgentReactions is defined with 'as const' so properties are readonly
      expect(typeof AgentReactions).toBe('object');
      expect(Object.keys(AgentReactions)).toHaveLength(8);
    });
  });

  describe('createReactionHandler', () => {
    it('should create a handler with onReaction method', () => {
      const handler = createReactionHandler();
      expect(handler).toBeDefined();
      expect(typeof handler.onReaction).toBe('function');
    });

    it('should log reaction data', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const handler = createReactionHandler();

      const data: ReactionData = {
        chatId: 100,
        messageId: 42,
        userId: 7,
        emoji: '👍',
        isAdded: true,
      };

      await handler.onReaction(data);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Reaction: 👍 added')
      );
      consoleSpy.mockRestore();
    });

    it('should call onNegativeReaction for thumbs down', async () => {
      const onNegative = vi.fn().mockResolvedValue(undefined);
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const handler = createReactionHandler(onNegative);

      const data: ReactionData = {
        chatId: 100,
        messageId: 42,
        userId: 7,
        emoji: '👎',
        isAdded: true,
      };

      await handler.onReaction(data);

      expect(onNegative).toHaveBeenCalledWith(100, 42);
      consoleSpy.mockRestore();
    });

    it('should not call onNegativeReaction when thumbs down is removed', async () => {
      const onNegative = vi.fn().mockResolvedValue(undefined);
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const handler = createReactionHandler(onNegative);

      const data: ReactionData = {
        chatId: 100,
        messageId: 42,
        userId: 7,
        emoji: '👎',
        isAdded: false, // removed, not added
      };

      await handler.onReaction(data);

      expect(onNegative).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should not call onNegativeReaction for other emojis', async () => {
      const onNegative = vi.fn().mockResolvedValue(undefined);
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const handler = createReactionHandler(onNegative);

      const data: ReactionData = {
        chatId: 100,
        messageId: 42,
        userId: 7,
        emoji: '👍',
        isAdded: true,
      };

      await handler.onReaction(data);

      expect(onNegative).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should not crash when onNegativeReaction is not provided', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const handler = createReactionHandler(); // no callback

      const data: ReactionData = {
        chatId: 100,
        messageId: 42,
        userId: 7,
        emoji: '👎',
        isAdded: true,
      };

      // Should not throw
      await expect(handler.onReaction(data)).resolves.toBeUndefined();
      consoleSpy.mockRestore();
    });
  });

  describe('sendReaction', () => {
    it('should call api.setMessageReaction and return true', async () => {
      const mockApi = {
        setMessageReaction: vi.fn().mockResolvedValue(true),
      } as any;
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const result = await sendReaction(mockApi, 100, 42, '👍');

      expect(result).toBe(true);
      expect(mockApi.setMessageReaction).toHaveBeenCalledWith(
        100,
        42,
        [expect.objectContaining({ type: 'emoji', emoji: '👍' })]
      );
      consoleSpy.mockRestore();
    });

    it('should return false on API error', async () => {
      const mockApi = {
        setMessageReaction: vi.fn().mockRejectedValue(new Error('API error')),
      } as any;
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const result = await sendReaction(mockApi, 100, 42, '❤️');

      expect(result).toBe(false);
      consoleSpy.mockRestore();
    });

    it('should work with various emoji types', async () => {
      const mockApi = {
        setMessageReaction: vi.fn().mockResolvedValue(true),
      } as any;
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      for (const emoji of ['🤔', '🔥', '🎉', '😢'] as const) {
        await sendReaction(mockApi, 100, 42, emoji);
      }

      expect(mockApi.setMessageReaction).toHaveBeenCalledTimes(4);
      consoleSpy.mockRestore();
    });
  });
});
