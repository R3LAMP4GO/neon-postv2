/**
 * Pre-tool-use safety validation for Neon Post
 *
 * Blocks dangerous commands that should NEVER be executed under any circumstances.
 * These patterns represent catastrophic operations with no legitimate use case.
 *
 * Pattern data lives in ./safety-patterns.ts; this file contains only logic.
 */

import path from 'path';

import {
  DANGEROUS_BASH_PATTERNS,
  DANGEROUS_BROWSER_PATTERNS,
  DANGEROUS_WRITE_PATHS,
} from './safety-patterns';

interface ValidationResult {
  allowed: boolean;
  reason?: string;
}

// ============================================================================
// VALIDATION FUNCTIONS
// ============================================================================

/**
 * Validate a Bash command against dangerous patterns
 */
export function validateBashCommand(command: string): ValidationResult {
  const normalizedCommand = command.trim();

  for (const { pattern, reason } of DANGEROUS_BASH_PATTERNS) {
    if (pattern.test(normalizedCommand)) {
      console.warn(`[Safety] BLOCKED bash command: ${reason}`);
      console.warn(`[Safety] Command was: ${normalizedCommand.slice(0, 100)}...`);
      return { allowed: false, reason };
    }
  }

  return { allowed: true };
}

/**
 * Validate a file path for write operations
 */
export function validateWritePath(filePath: string): ValidationResult {
  // Expand ~ to home directory for pattern matching (cross-platform)
  const homeDir =
    process.env.HOME ||
    process.env.USERPROFILE ||
    (process.platform === 'win32' ? 'C:\\Users\\user' : '/home/user');
  const expandedPath = filePath.replace(/^~/, homeDir);

  // Normalize to resolve ../ traversal attempts and canonicalize separators
  const normalizedPath = path.resolve(expandedPath);

  for (const { pattern, reason } of DANGEROUS_WRITE_PATHS) {
    if (pattern.test(filePath) || pattern.test(expandedPath) || pattern.test(normalizedPath)) {
      console.warn(`[Safety] BLOCKED write path: ${reason}`);
      console.warn(`[Safety] Path was: ${filePath}`);
      return { allowed: false, reason };
    }
  }

  return { allowed: true };
}

/**
 * Validate a browser URL
 */
export function validateBrowserUrl(url: string): ValidationResult {
  for (const { pattern, reason } of DANGEROUS_BROWSER_PATTERNS) {
    if (pattern.test(url)) {
      console.warn(`[Safety] BLOCKED browser URL: ${reason}`);
      console.warn(`[Safety] URL was: ${url}`);
      return { allowed: false, reason };
    }
  }

  return { allowed: true };
}

/**
 * Main validation function for tool calls
 * Called by the SDK's canUseTool callback
 */
export function validateToolCall(
  toolName: string,
  input: Record<string, unknown>
): ValidationResult {
  // Bash command validation
  if (toolName === 'Bash') {
    const command = (input.command as string) || '';
    return validateBashCommand(command);
  }

  // Write/Edit file validation
  if (toolName === 'Write' || toolName === 'Edit') {
    const filePath = (input.file_path as string) || '';
    return validateWritePath(filePath);
  }

  // Browser URL validation
  if (toolName === 'mcp__neon-post__browser') {
    const url = (input.url as string) || '';
    const action = (input.action as string) || '';

    if (action === 'navigate' && url) {
      return validateBrowserUrl(url);
    }
  }

  // All other tools pass through
  return { allowed: true };
}

/**
 * Build the canUseTool callback for SDK options
 */
export function buildCanUseToolCallback(): (
  toolName: string,
  input: Record<string, unknown>,
  options: { signal: AbortSignal; toolUseID: string }
) => Promise<{ behavior: 'allow' } | { behavior: 'deny'; message: string; interrupt: boolean }> {
  return async (toolName, input) => {
    console.log(`[Safety] canUseTool called for: ${toolName}`);
    const validation = validateToolCall(toolName, input);

    if (!validation.allowed) {
      console.log(`[Safety] DENIED: ${validation.reason}`);
      return {
        behavior: 'deny',
        message: `🚫 Safety block: ${validation.reason}`,
        interrupt: false, // Don't interrupt the entire session, just block this tool
      };
    }

    console.log(`[Safety] ALLOWED: ${toolName}`);
    return { behavior: 'allow' };
  };
}

// Status emitter type for UI updates
type StatusEmitter = (status: {
  type: 'tool_blocked';
  toolName: string;
  message: string;
  blockedReason: string;
}) => void;

// Module-level status emitter (set by agent)
let statusEmitter: StatusEmitter | null = null;

/**
 * Set the status emitter for UI updates when tools are blocked
 */
export function setStatusEmitter(emitter: StatusEmitter): void {
  statusEmitter = emitter;
}

/**
 * Build PreToolUse hook for SDK options
 * Returns { hookSpecificOutput: { permissionDecision: 'deny' } } to block tools
 * See: https://github.com/anthropics/claude-code/issues/4362
 */
export function buildPreToolUseHook(): {
  hooks: Array<
    (input: { tool_name: string; tool_input: unknown }) => Promise<{
      hookSpecificOutput: {
        hookEventName: 'PreToolUse';
        permissionDecision: 'allow' | 'deny';
        permissionDecisionReason?: string;
      };
    }>
  >;
} {
  return {
    hooks: [
      async (input: { tool_name: string; tool_input: unknown }) => {
        console.log(`[Safety] PreToolUse hook called for: ${input.tool_name}`);
        const validation = validateToolCall(
          input.tool_name,
          (input.tool_input as Record<string, unknown>) || {}
        );

        if (!validation.allowed) {
          console.log(`[Safety] HOOK DENIED: ${validation.reason}`);

          // Emit status for UI
          console.log(`[Safety] statusEmitter available: ${!!statusEmitter}`);
          if (statusEmitter) {
            console.log(`[Safety] Emitting tool_blocked status`);
            statusEmitter({
              type: 'tool_blocked',
              toolName: input.tool_name,
              message: '🙀 whoa! not allowed!',
              blockedReason: validation.reason || 'Dangerous operation blocked',
            });
          } else {
            console.log(`[Safety] WARNING: No status emitter set!`);
          }

          return {
            hookSpecificOutput: {
              hookEventName: 'PreToolUse' as const,
              permissionDecision: 'deny' as const,
              permissionDecisionReason: `🚫 Safety block: ${validation.reason}`,
            },
          };
        }

        console.log(`[Safety] HOOK ALLOWED: ${input.tool_name}`);
        return {
          hookSpecificOutput: {
            hookEventName: 'PreToolUse' as const,
            permissionDecision: 'allow' as const,
          },
        };
      },
    ],
  };
}
