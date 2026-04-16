/**
 * Queue and Stop management functions extracted from AgentManager.
 *
 * These operate on shared Maps/Sets passed in rather than class state,
 * keeping them as pure standalone functions.
 */

import type { PersistentSDKSession } from './persistent-session';
import type { ChatEngine } from './chat-engine';

/** The shape of a queued message item (matches AgentManager's queue). */
export interface QueueItem {
  message: string;
  channel: string;
  images?: unknown[];
  attachmentInfo?: unknown;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  resolve: (result: any) => void;
  reject: (error: Error) => void;
}

/** Maps and Sets needed by queue-management functions. */
export interface QueueMaps {
  messageQueueBySession: Map<string, QueueItem[]>;
  processingBySession: Map<string, boolean>;
  persistentSessions: Map<string, PersistentSDKSession>;
  stoppedByUserSession: Set<string>;
  sdkToolTimers: Map<string, { timer: ReturnType<typeof setTimeout>; sessionId: string }>;
  abortControllersBySession: Map<string, AbortController>;
}

/**
 * Get the number of queued messages for a session.
 */
export function getQueueLength(
  maps: Pick<QueueMaps, 'messageQueueBySession'>,
  sessionId: string = 'default'
): number {
  return maps.messageQueueBySession.get(sessionId)?.length || 0;
}

/**
 * Clear the message queue for a session. Rejects all pending messages.
 */
export function clearQueue(
  maps: Pick<QueueMaps, 'messageQueueBySession'>,
  sessionId: string = 'default'
): void {
  const queue = maps.messageQueueBySession.get(sessionId);
  if (queue && queue.length > 0) {
    // Reject all pending messages
    for (const item of queue) {
      item.reject(new Error('Queue cleared'));
    }
    // Delete the key entirely to prevent memory leak from accumulated empty arrays
    maps.messageQueueBySession.delete(sessionId);
    console.log(`[AgentManager] Queue cleared for session ${sessionId}`);
  } else if (queue) {
    // Clean up empty queue entries
    maps.messageQueueBySession.delete(sessionId);
  }
}

/**
 * Stop the current turn for a specific session (or any running query if no sessionId).
 * Uses interrupt() on persistent sessions to stop the current turn while keeping
 * the subprocess alive (preserving background tasks).
 * Also clears any queued messages for that session.
 *
 * @param mode - current agent mode ('general' or 'coder')
 * @param chatEngine - optional ChatEngine instance (used in general mode)
 */
export function stopQuery(
  maps: QueueMaps,
  mode: string,
  chatEngine: ChatEngine | null,
  sessionId?: string,
  clearQueuedMessages: boolean = true
): boolean {
  // Delegate to Chat engine in General mode
  if (mode === 'general' && chatEngine) {
    return chatEngine.stopQuery(sessionId);
  }

  // Clear SDK tool timeout timers for the session being stopped
  const targetSessionId =
    sessionId || [...maps.processingBySession.entries()].find(([, v]) => v)?.[0];
  if (targetSessionId) {
    for (const [id, entry] of maps.sdkToolTimers.entries()) {
      if (entry.sessionId === targetSessionId) {
        clearTimeout(entry.timer);
        maps.sdkToolTimers.delete(id);
      }
    }
  }

  if (sessionId) {
    // Clear the queue first
    if (clearQueuedMessages) {
      clearQueue(maps, sessionId);
    }

    const session = maps.persistentSessions.get(sessionId);
    if (session?.isAlive() && maps.processingBySession.get(sessionId)) {
      console.log(
        `[AgentManager] Interrupting persistent session ${sessionId} (bg tasks survive)...`
      );
      maps.stoppedByUserSession.add(sessionId);
      session.interrupt().catch((err) => {
        console.error(`[AgentManager] Interrupt failed for ${sessionId}:`, err);
      });
      return true;
    }

    // Fallback to abort controller (for non-persistent queries)
    const abortController = maps.abortControllersBySession.get(sessionId);
    if (maps.processingBySession.get(sessionId) && abortController) {
      console.log(`[AgentManager] Stopping query for session ${sessionId} via abort...`);
      maps.stoppedByUserSession.add(sessionId);
      abortController.abort();
      return true;
    }
    return false;
  }

  // Legacy: stop any running query (first one found)
  for (const [sid, isProcessing] of maps.processingBySession.entries()) {
    if (isProcessing) {
      if (clearQueuedMessages) {
        clearQueue(maps, sid);
      }

      const session = maps.persistentSessions.get(sid);
      if (session?.isAlive()) {
        console.log(`[AgentManager] Interrupting persistent session ${sid}...`);
        maps.stoppedByUserSession.add(sid);
        session.interrupt().catch((err) => {
          console.error(`[AgentManager] Interrupt failed for ${sid}:`, err);
        });
        return true;
      }

      const abortController = maps.abortControllersBySession.get(sid);
      if (abortController) {
        console.log(`[AgentManager] Stopping query for session ${sid} via abort...`);
        maps.stoppedByUserSession.add(sid);
        abortController.abort();
        return true;
      }
    }
  }
  return false;
}

/**
 * Check if a query is currently processing (optionally for a specific session).
 */
export function isQueryProcessing(
  maps: Pick<QueueMaps, 'processingBySession'>,
  mode: string,
  chatEngine: ChatEngine | null,
  sessionId?: string
): boolean {
  // Check Chat engine in General mode
  if (mode === 'general' && chatEngine) {
    return chatEngine.isQueryProcessing(sessionId);
  }

  if (sessionId) {
    return maps.processingBySession.get(sessionId) || false;
  }
  // Check if any session is processing
  for (const isProcessing of maps.processingBySession.values()) {
    if (isProcessing) return true;
  }
  return false;
}
