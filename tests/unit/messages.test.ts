import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock better-sqlite3 before importing modules
vi.mock('better-sqlite3', () => {
  return { default: vi.fn() };
});

// Mock embeddings
vi.mock('../../src/memory/embeddings', () => ({
  initEmbeddings: vi.fn(),
  hasEmbeddings: vi.fn(() => false),
  embed: vi.fn(),
  cosineSimilarity: vi.fn(),
  serializeEmbedding: vi.fn(),
  deserializeEmbedding: vi.fn(),
}));

// Mock sessions.touchSession
vi.mock('../../src/memory/sessions', () => ({
  touchSession: vi.fn(),
}));

import {
  saveMessage,
  getRecentMessages,
  getMessageCount,
  createBasicSummary,
  searchRelevantMessages,
  type Message,
} from '../../src/memory/messages';
import { hasEmbeddings, embed, cosineSimilarity, deserializeEmbedding } from '../../src/memory/embeddings';
import { touchSession } from '../../src/memory/sessions';

function createMockDb() {
  const mockStatement = {
    run: vi.fn(() => ({ lastInsertRowid: 1, changes: 1 })),
    get: vi.fn(),
    all: vi.fn(() => []),
  };
  const mockDb = {
    prepare: vi.fn(() => mockStatement),
    exec: vi.fn(),
  } as any;
  return { mockDb, mockStatement };
}

describe('messages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('saveMessage', () => {
    it('should insert a message with correct params', () => {
      const { mockDb, mockStatement } = createMockDb();
      mockStatement.run.mockReturnValue({ lastInsertRowid: 42, changes: 1 });

      const id = saveMessage(mockDb, 'user', 'Hello world', 'session-1');

      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO messages'));
      expect(mockStatement.run).toHaveBeenCalledWith(
        'user',
        'Hello world',
        expect.any(Number), // token_count
        'session-1',
        null // no metadata
      );
      expect(id).toBe(42);
    });

    it('should use default session id when not provided', () => {
      const { mockDb, mockStatement } = createMockDb();
      mockStatement.run.mockReturnValue({ lastInsertRowid: 1, changes: 1 });

      saveMessage(mockDb, 'assistant', 'Hi');

      expect(mockStatement.run).toHaveBeenCalledWith(
        'assistant',
        'Hi',
        expect.any(Number),
        'default',
        null
      );
    });

    it('should serialize metadata as JSON', () => {
      const { mockDb, mockStatement } = createMockDb();
      mockStatement.run.mockReturnValue({ lastInsertRowid: 1, changes: 1 });
      const meta = { source: 'test', extra: 123 };

      saveMessage(mockDb, 'system', 'prompt', 'default', meta);

      expect(mockStatement.run).toHaveBeenCalledWith(
        'system',
        'prompt',
        expect.any(Number),
        'default',
        JSON.stringify(meta)
      );
    });

    it('should estimate token count (~4 chars per token)', () => {
      const { mockDb, mockStatement } = createMockDb();
      mockStatement.run.mockReturnValue({ lastInsertRowid: 1, changes: 1 });

      saveMessage(mockDb, 'user', 'abcd'); // 4 chars = 1 token

      expect(mockStatement.run).toHaveBeenCalledWith(
        'user',
        'abcd',
        1,
        'default',
        null
      );
    });

    it('should call touchSession after saving', () => {
      const { mockDb, mockStatement } = createMockDb();
      mockStatement.run.mockReturnValue({ lastInsertRowid: 1, changes: 1 });

      saveMessage(mockDb, 'user', 'test', 'my-session');

      expect(touchSession).toHaveBeenCalledWith(mockDb, 'my-session');
    });
  });

  describe('getRecentMessages', () => {
    it('should return messages reversed (oldest first)', () => {
      const { mockDb, mockStatement } = createMockDb();
      mockStatement.all.mockReturnValue([
        { id: 3, role: 'user', content: 'C', timestamp: 't3', token_count: 1, session_id: 'default', metadata: null },
        { id: 2, role: 'assistant', content: 'B', timestamp: 't2', token_count: 1, session_id: 'default', metadata: null },
        { id: 1, role: 'user', content: 'A', timestamp: 't1', token_count: 1, session_id: 'default', metadata: null },
      ]);

      const msgs = getRecentMessages(mockDb, 50, 'default');

      expect(msgs).toHaveLength(3);
      expect(msgs[0].content).toBe('A');
      expect(msgs[1].content).toBe('B');
      expect(msgs[2].content).toBe('C');
    });

    it('should respect limit parameter', () => {
      const { mockDb, mockStatement } = createMockDb();
      mockStatement.all.mockReturnValue([]);

      getRecentMessages(mockDb, 10, 'session-1');

      expect(mockStatement.all).toHaveBeenCalledWith('session-1', 10);
    });

    it('should parse metadata JSON', () => {
      const { mockDb, mockStatement } = createMockDb();
      mockStatement.all.mockReturnValue([
        { id: 1, role: 'user', content: 'test', timestamp: 't', token_count: 1, session_id: 'default', metadata: '{"key":"value"}' },
      ]);

      const msgs = getRecentMessages(mockDb, 50, 'default');

      expect(msgs[0].metadata).toEqual({ key: 'value' });
    });

    it('should set metadata to undefined when null', () => {
      const { mockDb, mockStatement } = createMockDb();
      mockStatement.all.mockReturnValue([
        { id: 1, role: 'user', content: 'test', timestamp: 't', token_count: 1, session_id: 'default', metadata: null },
      ]);

      const msgs = getRecentMessages(mockDb, 50, 'default');

      expect(msgs[0].metadata).toBeUndefined();
    });

    it('should use default limit and session', () => {
      const { mockDb, mockStatement } = createMockDb();
      mockStatement.all.mockReturnValue([]);

      getRecentMessages(mockDb);

      expect(mockStatement.all).toHaveBeenCalledWith('default', 50);
    });
  });

  describe('getMessageCount', () => {
    it('should return count for a specific session', () => {
      const { mockDb, mockStatement } = createMockDb();
      mockStatement.get.mockReturnValue({ count: 42 });

      const count = getMessageCount(mockDb, 'session-1');

      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('WHERE session_id'));
      expect(mockStatement.get).toHaveBeenCalledWith('session-1');
      expect(count).toBe(42);
    });

    it('should return total count when no session specified', () => {
      const { mockDb, mockStatement } = createMockDb();
      mockStatement.get.mockReturnValue({ count: 100 });

      const count = getMessageCount(mockDb);

      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('SELECT COUNT(*)'));
      expect(mockStatement.get).toHaveBeenCalledWith();
      expect(count).toBe(100);
    });
  });

  describe('createBasicSummary', () => {
    it('should create summary from user messages', () => {
      const messages: Message[] = [
        { id: 1, role: 'user', content: 'How do I build a React app?', timestamp: 't1' },
        { id: 2, role: 'assistant', content: 'Use create-react-app...', timestamp: 't2' },
        { id: 3, role: 'user', content: 'What about TypeScript?', timestamp: 't3' },
      ];

      const summary = createBasicSummary(messages);

      expect(summary).toContain('Previous conversation (3 messages) covered:');
      expect(summary).toContain('How do I build a React app?');
      expect(summary).toContain('What about TypeScript?');
    });

    it('should not include assistant messages as topics', () => {
      const messages: Message[] = [
        { id: 1, role: 'assistant', content: 'I am an assistant message', timestamp: 't1' },
        { id: 2, role: 'user', content: 'User query here', timestamp: 't2' },
      ];

      const summary = createBasicSummary(messages);

      expect(summary).not.toContain('I am an assistant message');
      expect(summary).toContain('User query here');
    });

    it('should handle empty messages array', () => {
      const summary = createBasicSummary([]);

      expect(summary).toContain('Previous conversation (0 messages) covered:');
    });

    it('should truncate long content to 100 chars', () => {
      const longContent = 'A'.repeat(200);
      const messages: Message[] = [
        { id: 1, role: 'user', content: longContent, timestamp: 't1' },
      ];

      const summary = createBasicSummary(messages);
      // The topic should be truncated at 100 chars
      const lines = summary.split('\n');
      const topicLine = lines.find((l) => l.startsWith('- '));
      expect(topicLine).toBeDefined();
      // 100 chars + "- " prefix + "..." suffix
      expect(topicLine!.length).toBeLessThan(200);
    });

    it('should limit to 10 topics', () => {
      const messages: Message[] = Array.from({ length: 25 }, (_, i) => ({
        id: i + 1,
        role: 'user' as const,
        content: `Topic ${i + 1}`,
        timestamp: `t${i}`,
      }));

      const summary = createBasicSummary(messages);
      const topicLines = summary.split('\n').filter((l) => l.startsWith('- '));
      expect(topicLines.length).toBeLessThanOrEqual(10);
    });
  });

  describe('searchRelevantMessages', () => {
    it('should return empty array when embeddings not available', async () => {
      vi.mocked(hasEmbeddings).mockReturnValue(false);
      const { mockDb } = createMockDb();

      const results = await searchRelevantMessages(mockDb, 'query', 'session', 5, []);

      expect(results).toEqual([]);
    });

    it('should return empty array when no embeddings found in DB', async () => {
      vi.mocked(hasEmbeddings).mockReturnValue(true);
      vi.mocked(embed).mockResolvedValue([0.1, 0.2, 0.3]);

      const mockStatement = {
        run: vi.fn(),
        get: vi.fn(),
        all: vi.fn(() => []),
      };
      const mockDb = {
        prepare: vi.fn(() => mockStatement),
      } as any;

      const results = await searchRelevantMessages(mockDb, 'query', 'session', 5, []);

      expect(results).toEqual([]);
    });

    it('should calculate similarity and return sorted results', async () => {
      vi.mocked(hasEmbeddings).mockReturnValue(true);
      vi.mocked(embed).mockResolvedValue([1, 0, 0]);
      vi.mocked(deserializeEmbedding).mockReturnValue([1, 0, 0]);
      vi.mocked(cosineSimilarity).mockReturnValue(0.95);

      const mockStatement = {
        run: vi.fn(),
        get: vi.fn(),
        all: vi.fn(() => [
          {
            message_id: 1,
            embedding: Buffer.from([]),
            role: 'user',
            content: 'relevant message',
            timestamp: 't1',
          },
        ]),
      };
      const mockDb = {
        prepare: vi.fn(() => mockStatement),
      } as any;

      const results = await searchRelevantMessages(mockDb, 'query', 'session', 5, []);

      expect(results).toHaveLength(1);
      expect(results[0].content).toBe('relevant message');
      expect(results[0].similarity).toBe(0.95);
    });

    it('should filter results below similarity threshold (0.3)', async () => {
      vi.mocked(hasEmbeddings).mockReturnValue(true);
      vi.mocked(embed).mockResolvedValue([1, 0, 0]);
      vi.mocked(deserializeEmbedding).mockReturnValue([0, 1, 0]);
      vi.mocked(cosineSimilarity).mockReturnValue(0.1); // below 0.3 threshold

      const mockStatement = {
        run: vi.fn(),
        get: vi.fn(),
        all: vi.fn(() => [
          {
            message_id: 1,
            embedding: Buffer.from([]),
            role: 'user',
            content: 'irrelevant',
            timestamp: 't1',
          },
        ]),
      };
      const mockDb = {
        prepare: vi.fn(() => mockStatement),
      } as any;

      const results = await searchRelevantMessages(mockDb, 'query', 'session', 5, []);

      expect(results).toEqual([]);
    });

    it('should handle errors gracefully and return empty array', async () => {
      vi.mocked(hasEmbeddings).mockReturnValue(true);
      vi.mocked(embed).mockRejectedValue(new Error('API error'));
      const { mockDb } = createMockDb();

      const results = await searchRelevantMessages(mockDb, 'query', 'session', 5, []);

      expect(results).toEqual([]);
    });
  });
});
