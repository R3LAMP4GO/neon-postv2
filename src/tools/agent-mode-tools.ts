/**
 * Agent mode switching tool — allows the agent to switch its operating mode mid-conversation.
 *
 * Registered as an MCP tool in all modes. When called, it updates the session's mode
 * in the database and signals the UI to update.
 */

import { ALL_MODE_IDS, AGENT_MODES, isValidModeId } from '../agent/agent-modes';
import type { AgentModeId } from '../agent/agent-modes';

// Callback set by AgentManager to handle the actual mode switch
let switchModeCallback:
  | ((sessionId: string, newMode: AgentModeId, reason: string) => Promise<string>)
  | null = null;

// Callback to get the current session ID from the tool execution context
let getSessionIdCallback: (() => string | null) | null = null;

export function setSwitchModeCallback(
  cb: (sessionId: string, newMode: AgentModeId, reason: string) => Promise<string>
): void {
  switchModeCallback = cb;
}

export function setGetSessionIdCallback(cb: () => string | null): void {
  getSessionIdCallback = cb;
}

export interface AgentModeTool {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
  };
  handler: (input: Record<string, unknown>) => Promise<string>;
}

export function getSwitchAgentTool(): AgentModeTool {
  return {
    name: 'switch_agent',
    description: `Switch to a different agent mode. The conversation continues with the same context — only the system prompt and available tools change. Available modes: ${ALL_MODE_IDS.map((id) => `${id} (${AGENT_MODES[id].name})`).join(', ')}`,
    input_schema: {
      type: 'object',
      properties: {
        mode: {
          type: 'string',
          enum: ALL_MODE_IDS,
          description: 'The agent mode to switch to',
        },
        reason: {
          type: 'string',
          description: 'Brief reason for switching (shown to user)',
        },
      },
      required: ['mode', 'reason'],
    },
    handler: async (input: Record<string, unknown>): Promise<string> => {
      const mode = input.mode as string;
      const reason = (input.reason as string) || 'Mode switch requested';

      if (!isValidModeId(mode)) {
        return `Error: Invalid mode "${mode}". Valid modes: ${ALL_MODE_IDS.join(', ')}`;
      }

      const sessionId = getSessionIdCallback?.();
      if (!sessionId) {
        return 'Error: No active session context for mode switch';
      }

      if (!switchModeCallback) {
        return 'Error: Mode switching not initialized';
      }

      try {
        return await switchModeCallback(sessionId, mode as AgentModeId, reason);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        return `Error switching mode: ${msg}`;
      }
    },
  };
}
