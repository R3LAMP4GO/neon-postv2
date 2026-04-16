import Database from 'better-sqlite3';
import {
  hasEmbeddings,
  embed,
  cosineSimilarity,
  serializeEmbedding,
  deserializeEmbedding,
} from './embeddings';
import { touchSession } from './sessions';

// ============ Types ============

export interface Message {
  id: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  token_count?: number;
  session_id?: string;
  metadata?: Record<string, unknown>;
}

export interface SmartContextOptions {
  recentMessageLimit: number; // Number of recent messages to include
  rollingSummaryInterval: number; // Create summaries every N messages
  semanticRetrievalCount: number; // Number of semantically relevant messages to retrieve
  currentQuery?: string; // Current user query for semantic search
}

export interface SmartContext {
  recentMessages: Array<{ role: string; content: string; timestamp?: string }>;
  rollingSummary: string | null;
  relevantMessages: Array<{
    role: string;
    content: string;
    timestamp?: string;
    similarity?: number;
  }>;
  totalTokens: number;
  stats: {
    totalMessages: number;
    summarizedMessages: number;
    recentCount: number;
    relevantCount: number;
    newSummaryCreated: boolean; // True if a new rolling summary was created this turn
  };
}

export type SummarizerFn = (messages: Message[]) => Promise<string>;

// ============ Helpers ============

// Token estimation: ~4 characters per token
const CHARS_PER_TOKEN = 4;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

// ============ Message CRUD ============

/**
 * Save a message to the database.
 */
export function saveMessage(
  db: Database.Database,
  role: 'user' | 'assistant' | 'system',
  content: string,
  sessionId: string = 'default',
  metadata?: Record<string, unknown>
): number {
  const tokenCount = estimateTokens(content);
  const metadataJson = metadata ? JSON.stringify(metadata) : null;
  const stmt = db.prepare(`
    INSERT INTO messages (role, content, token_count, session_id, metadata)
    VALUES (?, ?, ?, ?, ?)
  `);
  const result = stmt.run(role, content, tokenCount, sessionId, metadataJson);

  // Touch session to update activity timestamp
  touchSession(db, sessionId);

  return result.lastInsertRowid as number;
}

/**
 * Retrieve recent messages for a session, oldest first.
 */
export function getRecentMessages(
  db: Database.Database,
  limit: number = 50,
  sessionId: string = 'default'
): Message[] {
  const stmt = db.prepare(`
    SELECT id, role, content, timestamp, token_count, session_id, metadata
    FROM messages
    WHERE session_id = ?
    ORDER BY id DESC
    LIMIT ?
  `);
  const rows = stmt.all(sessionId, limit) as Array<Message & { metadata: string | null }>;
  return rows.reverse().map((row) => ({
    ...row,
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
  }));
}

/**
 * Count messages, optionally scoped to a session.
 */
export function getMessageCount(db: Database.Database, sessionId?: string): number {
  if (sessionId) {
    const stmt = db.prepare('SELECT COUNT(*) as count FROM messages WHERE session_id = ?');
    const row = stmt.get(sessionId) as { count: number };
    return row.count;
  }
  const stmt = db.prepare('SELECT COUNT(*) as count FROM messages');
  const row = stmt.get() as { count: number };
  return row.count;
}

// ============ Smart Context ============

/**
 * Get smart context using rolling summaries, recent messages, and semantic retrieval.
 * This is more efficient than loading all messages into context.
 */
export async function getSmartContext(
  db: Database.Database,
  sessionId: string = 'default',
  options: SmartContextOptions,
  deps: { summarizer?: SummarizerFn; embeddingsReady: boolean }
): Promise<SmartContext> {
  const { recentMessageLimit, rollingSummaryInterval, semanticRetrievalCount, currentQuery } =
    options;

  // 1. Get total message count
  const totalMessages = getMessageCount(db, sessionId);

  // 2. Get recent messages (last N messages)
  const recentMessagesQuery = db
    .prepare(
      `
    SELECT id, role, content, timestamp, token_count
    FROM messages
    WHERE session_id = ?
    ORDER BY id DESC
    LIMIT ?
  `
    )
    .all(sessionId, recentMessageLimit) as Message[];

  const recentMessages = recentMessagesQuery.reverse(); // Oldest first
  const oldestRecentId = recentMessages[0]?.id || 0;

  // 3. Get or create rolling summary for older messages
  let rollingSummary: string | null = null;
  let newSummaryCreated = false;
  const summarizedMessages = totalMessages - recentMessages.length;

  if (summarizedMessages > 0 && oldestRecentId > 1) {
    const summaryResult = await getOrCreateRollingSummary(
      db,
      oldestRecentId,
      sessionId,
      rollingSummaryInterval,
      deps.summarizer
    );
    rollingSummary = summaryResult.summary;
    newSummaryCreated = summaryResult.newSummaryCreated;
  }

  // 4. Get semantically relevant messages (if embeddings available and query provided)
  let relevantMessages: Array<{
    role: string;
    content: string;
    timestamp?: string;
    similarity?: number;
  }> = [];
  if (semanticRetrievalCount > 0 && currentQuery && deps.embeddingsReady) {
    relevantMessages = await searchRelevantMessages(
      db,
      currentQuery,
      sessionId,
      semanticRetrievalCount,
      recentMessages.map((m) => m.id) // Exclude recent messages
    );
  }

  // 5. Calculate total tokens
  let totalTokens = 0;
  for (const msg of recentMessages) {
    totalTokens += msg.token_count || estimateTokens(msg.content);
  }
  if (rollingSummary) {
    totalTokens += estimateTokens(rollingSummary);
  }
  for (const msg of relevantMessages) {
    totalTokens += estimateTokens(msg.content);
  }

  console.log(
    `[Memory] Smart context: ${recentMessages.length} recent, ${summarizedMessages} summarized, ${relevantMessages.length} relevant (${totalTokens} tokens)`
  );

  return {
    recentMessages: recentMessages.map((m) => ({
      role: m.role,
      content: m.content,
      timestamp: m.timestamp,
    })),
    rollingSummary,
    relevantMessages,
    totalTokens,
    stats: {
      totalMessages,
      summarizedMessages,
      recentCount: recentMessages.length,
      relevantCount: relevantMessages.length,
      newSummaryCreated,
    },
  };
}

// ============ Rolling Summaries ============

/**
 * Get or create a rolling summary for messages before the given ID.
 * Creates incremental summaries every N messages.
 * Returns both the summary and whether a new summary was created this turn.
 */
async function getOrCreateRollingSummary(
  db: Database.Database,
  beforeMessageId: number,
  sessionId: string,
  interval: number,
  summarizer?: SummarizerFn
): Promise<{ summary: string | null; newSummaryCreated: boolean }> {
  // Check for existing rolling summary that covers up to beforeMessageId-1
  const existingRow = db
    .prepare(
      `
    SELECT content, end_message_id FROM rolling_summaries
    WHERE session_id = ? AND end_message_id <= ?
    ORDER BY end_message_id DESC
    LIMIT 1
  `
    )
    .get(sessionId, beforeMessageId - 1) as { content: string; end_message_id: number } | undefined;

  const existingSummary = existingRow ? { content: existingRow.content } : undefined;
  const lastSummarizedId = existingRow?.end_message_id || 0;

  // Get messages that need summarizing (between last summary and beforeMessageId)
  // Limit to 500 to prevent loading unbounded message history into memory
  const unsummarizedMessages = db
    .prepare(
      `
    SELECT id, role, content, timestamp
    FROM messages
    WHERE session_id = ? AND id > ? AND id < ?
    ORDER BY id ASC
    LIMIT 500
  `
    )
    .all(sessionId, lastSummarizedId, beforeMessageId) as Message[];

  // Calculate token count for unsummarized messages
  const unsummarizedTokens = unsummarizedMessages.reduce(
    (sum, m) => sum + estimateTokens(m.content),
    0
  );

  // Token threshold for triggering summarization (prevents token blowup from long messages)
  const TOKEN_THRESHOLD = 15000;

  // Trigger summarization if either: enough messages OR too many tokens
  const shouldSummarize =
    summarizer &&
    (unsummarizedMessages.length >= interval || unsummarizedTokens >= TOKEN_THRESHOLD);

  if (shouldSummarize && unsummarizedMessages.length > 0) {
    console.log(
      `[Memory] Triggering summarization: ${unsummarizedMessages.length} messages, ${unsummarizedTokens} tokens (threshold: ${interval} msgs or ${TOKEN_THRESHOLD} tokens)`
    );
    const newSummary = await createRollingSummary(
      unsummarizedMessages,
      sessionId,
      summarizer,
      existingSummary?.content
    );

    // Store the new rolling summary
    const startId = unsummarizedMessages[0].id;
    const endId = unsummarizedMessages[unsummarizedMessages.length - 1].id;

    db.prepare(
      `
      INSERT INTO rolling_summaries (session_id, start_message_id, end_message_id, content, token_count)
      VALUES (?, ?, ?, ?, ?)
    `
    ).run(sessionId, startId, endId, newSummary, estimateTokens(newSummary));

    console.log(`[Memory] Created rolling summary for messages ${startId}-${endId}`);

    // Combine with existing summary
    if (existingSummary?.content) {
      return { summary: `${existingSummary.content}\n\n${newSummary}`, newSummaryCreated: true };
    }
    return { summary: newSummary, newSummaryCreated: true };
  }

  // Return existing summary combined with basic summary of recent unsummarized
  if (existingSummary?.content) {
    if (unsummarizedMessages.length > 0) {
      const basicSummary = createBasicSummary(unsummarizedMessages);
      return {
        summary: `${existingSummary.content}\n\n${basicSummary}`,
        newSummaryCreated: false,
      };
    }
    return { summary: existingSummary.content, newSummaryCreated: false };
  }

  // No existing summary - create basic summary if we have messages
  if (unsummarizedMessages.length > 0) {
    return { summary: createBasicSummary(unsummarizedMessages), newSummaryCreated: false };
  }

  return { summary: null, newSummaryCreated: false };
}

/**
 * Create a rolling summary from messages, optionally incorporating a previous summary.
 */
async function createRollingSummary(
  messages: Message[],
  sessionId: string,
  summarizer: SummarizerFn,
  previousSummary?: string
): Promise<string> {
  try {
    // If there's a previous summary, include it as context
    const messagesWithContext = previousSummary
      ? [
          {
            id: 0,
            role: 'system' as const,
            content: `[Previous summary]\n${previousSummary}`,
            timestamp: '',
          },
          ...messages,
        ]
      : messages;

    const summary = await summarizer(messagesWithContext);
    console.log(
      `[Memory] Created rolling summary for session ${sessionId} (${messages.length} messages, ${estimateTokens(summary)} tokens)`
    );
    return summary;
  } catch (error) {
    console.error('[Memory] Rolling summary failed, using basic summary:', error);
    return createBasicSummary(messages);
  }
}

/**
 * Create a basic (non-AI) summary of messages.
 */
export function createBasicSummary(messages: Message[]): string {
  const userMessages = messages.filter((m) => m.role === 'user');
  const topics = new Set<string>();

  for (const msg of userMessages.slice(-20)) {
    const topic = msg.content.slice(0, 100).replace(/\n/g, ' ');
    topics.add(topic);
  }

  const topicList = Array.from(topics).slice(0, 10);
  return `Previous conversation (${messages.length} messages) covered:\n${topicList.map((t) => `- ${t}...`).join('\n')}`;
}

// ============ Message Embedding Methods ============

/**
 * Search for semantically relevant past messages using embeddings.
 */
export async function searchRelevantMessages(
  db: Database.Database,
  query: string,
  sessionId: string,
  limit: number,
  excludeIds: number[]
): Promise<Array<{ role: string; content: string; timestamp?: string; similarity: number }>> {
  if (!hasEmbeddings()) {
    return [];
  }

  try {
    const queryEmbedding = await embed(query);

    // Get message embeddings (excluding recent messages)
    const placeholders = excludeIds.length > 0 ? excludeIds.map(() => '?').join(',') : '0';
    const params = excludeIds.length > 0 ? [sessionId, ...excludeIds] : [sessionId];
    const embeddings = db
      .prepare(
        `
      SELECT me.message_id, me.embedding, m.role, m.content, m.timestamp
      FROM message_embeddings me
      JOIN messages m ON me.message_id = m.id
      WHERE m.session_id = ? AND m.id NOT IN (${placeholders})
      ORDER BY m.id DESC
      LIMIT 200
    `
      )
      .all(...params) as Array<{
      message_id: number;
      embedding: Buffer;
      role: string;
      content: string;
      timestamp: string;
    }>;

    if (embeddings.length === 0) {
      return [];
    }

    // Calculate similarities
    const scored = embeddings.map((e) => ({
      role: e.role,
      content: e.content,
      timestamp: e.timestamp,
      similarity: cosineSimilarity(queryEmbedding, deserializeEmbedding(e.embedding)),
    }));

    // Sort by similarity and take top N
    scored.sort((a, b) => b.similarity - a.similarity);
    const relevant = scored.slice(0, limit).filter((m) => m.similarity > 0.3);

    if (relevant.length > 0) {
      console.log(
        `[Memory] Found ${relevant.length} relevant messages (top similarity: ${relevant[0].similarity.toFixed(3)})`
      );
    }

    return relevant;
  } catch (error) {
    console.error('[Memory] Semantic search failed:', error);
    return [];
  }
}

/**
 * Embed a message and store in message_embeddings table.
 * Called after saving a message to enable future semantic search.
 */
export async function embedMessage(db: Database.Database, messageId: number): Promise<void> {
  if (!hasEmbeddings()) {
    return;
  }

  try {
    const message = db
      .prepare(
        `
      SELECT content FROM messages WHERE id = ?
    `
      )
      .get(messageId) as { content: string } | undefined;

    if (!message) return;

    const embedding = await embed(message.content);
    const embeddingBuffer = serializeEmbedding(embedding);

    db.prepare(
      `
      INSERT OR REPLACE INTO message_embeddings (message_id, embedding)
      VALUES (?, ?)
    `
    ).run(messageId, embeddingBuffer);
  } catch (error) {
    console.error(`[Memory] Failed to embed message ${messageId}:`, error);
  }
}

/**
 * Embed recent messages that don't have embeddings yet.
 * Called periodically to backfill embeddings.
 */
export async function embedRecentMessages(
  db: Database.Database,
  sessionId: string = 'default',
  limit: number = 50
): Promise<number> {
  if (!hasEmbeddings()) {
    return 0;
  }

  const unembeddedMessages = db
    .prepare(
      `
    SELECT m.id, m.content
    FROM messages m
    LEFT JOIN message_embeddings me ON m.id = me.message_id
    WHERE m.session_id = ? AND me.id IS NULL
    ORDER BY m.id DESC
    LIMIT ?
  `
    )
    .all(sessionId, limit) as Array<{ id: number; content: string }>;

  // Process in sequential batches of 5 to avoid rate limits
  const batchSize = 5;
  let embedded = 0;
  for (let i = 0; i < unembeddedMessages.length; i += batchSize) {
    const batch = unembeddedMessages.slice(i, i + batchSize);
    await Promise.all(
      batch.map(async (msg) => {
        try {
          const embedding = await embed(msg.content);
          const embeddingBuffer = serializeEmbedding(embedding);

          db.prepare(
            `
            INSERT OR REPLACE INTO message_embeddings (message_id, embedding)
            VALUES (?, ?)
          `
          ).run(msg.id, embeddingBuffer);

          embedded++;
        } catch (error) {
          console.error(`[Memory] Failed to embed message ${msg.id}:`, error);
        }
      })
    );
  }

  if (embedded > 0) {
    console.log(`[Memory] Embedded ${embedded} messages for session ${sessionId}`);
  }

  return embedded;
}
