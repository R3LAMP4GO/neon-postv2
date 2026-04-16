/**
 * Tool configurations for the agent
 *
 * Available capabilities:
 * - File/Terminal: Built-in with claude_code preset
 * - Browser: Three-tier system (HTTP, Electron, CDP)
 * - Desktop: Anthropic computer use tool (Docker recommended)
 *
 * Custom tools use SDK MCP servers (in-process) via createSdkMcpServer()
 */

import { execSync } from 'child_process';
import { getBrowserToolDefinition, handleBrowserTool } from '../browser';
import { getMemoryTools } from './memory-tools';
import { getSoulTools } from './soul-tools';
import { getSchedulerTools } from './scheduler-tools';
import { getNotifyToolDefinition, handleNotifyTool } from './macos';
import { getProjectTools } from './project-tools';
import { getSwitchAgentTool } from './agent-mode-tools';
import { getSocialTools } from './social-tools';
import { getCompositorTools } from './compositor-tools';
import { wrapToolHandler, getToolTimeout, logActiveToolsStatus } from './diagnostics';
import { getModeConfig } from '../agent/agent-modes';
import type { AgentModeId } from '../agent/agent-modes';

export { logActiveToolsStatus } from './diagnostics';

// Start periodic check for stuck tools (every 30 seconds)
setInterval(() => {
  logActiveToolsStatus();
}, 30000);

export { setMemoryManager } from './memory-tools';
export { setSoulMemoryManager } from './soul-tools';
export { setSocialMemoryManager, setImageJobTracker, socialToolEvents } from './social-tools';
export { setCompositorMemoryManager } from './compositor-tools';
export { getSchedulerTools } from './scheduler-tools';
export { getSocialTools } from './social-tools';
export { getCompositorTools } from './compositor-tools';
export { showNotification } from './macos';
export { setCurrentSessionId, getCurrentSessionId, runWithSessionId } from './session-context';

export interface MCPServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface ToolsConfig {
  mcpServers: Record<string, MCPServerConfig>;
  computerUse: {
    enabled: boolean;
    dockerized: boolean;
    displaySize?: { width: number; height: number };
  };
  browser: {
    enabled: boolean;
    cdpUrl?: string; // Default: http://localhost:9222
  };
}

/**
 * Default tools configuration
 */
export function getDefaultToolsConfig(): ToolsConfig {
  return {
    mcpServers: {},
    computerUse: {
      enabled: false,
      dockerized: true,
      displaySize: { width: 1920, height: 1080 },
    },
    browser: {
      enabled: true,
      cdpUrl: 'http://localhost:9222',
    },
  };
}

/**
 * Build MCP server configurations (for child process MCP servers)
 */
export function buildMCPServers(config: ToolsConfig): Record<string, MCPServerConfig> {
  const servers: Record<string, MCPServerConfig> = {};

  // Computer use server (for desktop automation) - runs as child process
  if (config.computerUse.enabled) {
    if (config.computerUse.dockerized) {
      servers['computer'] = {
        command: 'docker',
        args: [
          'run',
          '-i',
          '--rm',
          '-e',
          `DISPLAY_WIDTH=${config.computerUse.displaySize?.width || 1920}`,
          '-e',
          `DISPLAY_HEIGHT=${config.computerUse.displaySize?.height || 1080}`,
          'ghcr.io/anthropics/anthropic-quickstarts:computer-use-demo-latest',
        ],
      };
    } else {
      servers['computer'] = {
        command: 'npx',
        args: ['-y', '@anthropic-ai/computer-use-server'],
      };
    }
  }

  // Merge with any custom servers
  return { ...servers, ...config.mcpServers };
}

/**
 * Build SDK MCP servers (in-process tools)
 * These run in the same process as the agent, so they can access Electron APIs
 */
export async function buildSdkMcpServers(
  config: ToolsConfig,
  mode: AgentModeId = 'general'
): Promise<Record<string, unknown> | null> {
  // Dynamically import SDK to avoid CommonJS issues
  // Using Function constructor for dynamic ESM imports in CommonJS context
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dynamicImport = new Function('specifier', 'return import(specifier)') as <T = any>(
    specifier: string
  ) => Promise<T>;

  try {
    const sdk = await dynamicImport<typeof import('@anthropic-ai/claude-agent-sdk')>(
      '@anthropic-ai/claude-agent-sdk'
    );
    const { createSdkMcpServer, tool } = sdk;
    const zodModule = await dynamicImport<typeof import('zod')>('zod');
    const { z } = zodModule;

    const tools = [];

    // Wrap handlers with diagnostics (timing, logging, timeouts)
    const wrappedBrowserHandler = wrapToolHandler(
      'browser',
      handleBrowserTool,
      getToolTimeout('browser')
    );
    const wrappedNotifyHandler = wrapToolHandler(
      'notify',
      handleNotifyTool,
      getToolTimeout('notify')
    );

    // Browser tool (if enabled)
    if (config.browser.enabled) {
      const browserTool = tool(
        'browser',
        getBrowserToolDefinition().description,
        {
          action: z.enum([
            'navigate',
            'screenshot',
            'click',
            'type',
            'evaluate',
            'extract',
            'scroll',
            'hover',
            'download',
            'upload',
            'tabs_list',
            'tabs_open',
            'tabs_close',
            'tabs_focus',
          ]),
          url: z.string().optional(),
          selector: z.string().optional(),
          text: z.string().optional(),
          script: z.string().optional(),
          extract_type: z.enum(['text', 'html', 'links', 'tables', 'structured']).optional(),
          scroll_direction: z.enum(['up', 'down', 'left', 'right']).optional(),
          scroll_amount: z.number().optional(),
          download_path: z.string().optional(),
          file_path: z.string().optional(),
          tab_id: z.string().optional(),
          requires_auth: z.boolean().optional(),
          tier: z.enum(['electron', 'cdp']).optional(),
          wait_for: z.union([z.string(), z.number()]).optional(),
        },
        async (args) => {
          const result = await wrappedBrowserHandler(args);
          return { content: [{ type: 'text', text: result }] };
        }
      );
      tools.push(browserTool);
    }

    // Notify tool
    const notifyTool = tool(
      'notify',
      getNotifyToolDefinition().description,
      {
        title: z.string(),
        body: z.string().optional(),
        subtitle: z.string().optional(),
        silent: z.boolean().optional(),
        urgency: z.enum(['low', 'normal', 'critical']).optional(),
      },
      async (args) => {
        const result = await wrappedNotifyHandler(args);
        return { content: [{ type: 'text', text: result }] };
      }
    );
    tools.push(notifyTool);

    // Determine which tool sets this mode needs based on its allowedTools
    const modeConfig = getModeConfig(mode);
    const modeAllowedTools = modeConfig.allowedTools;
    const needsMemoryTools = modeAllowedTools.some((t) => t.startsWith('mcp__neon-post__remember'));
    const needsSoulTools = modeAllowedTools.some((t) => t.startsWith('mcp__neon-post__soul_'));
    const needsSchedulerTools = modeAllowedTools.some((t) =>
      t.startsWith('mcp__neon-post__schedule_')
    );

    // Memory tools (mode-dependent)
    if (needsMemoryTools) {
      const memoryTools = getMemoryTools();
      for (const memTool of memoryTools) {
        const wrappedHandler = wrapToolHandler(
          memTool.name,
          memTool.handler,
          getToolTimeout(memTool.name)
        );
        const sdkTool = tool(
          memTool.name,
          memTool.description,
          // Convert JSON schema to Zod (simplified - assumes string fields)
          Object.fromEntries(
            Object.entries(memTool.input_schema.properties || {}).map(
              ([key, value]: [string, unknown]) => {
                const prop = value as { type?: string };
                if (prop.type === 'string') return [key, z.string().optional()];
                if (prop.type === 'number') return [key, z.number().optional()];
                return [key, z.any().optional()];
              }
            )
          ),
          async (args) => {
            const result = await wrappedHandler(args);
            return { content: [{ type: 'text', text: result }] };
          }
        );
        tools.push(sdkTool);
      }
    }

    // Soul tools (mode-dependent)
    if (needsSoulTools) {
      const soulTools = getSoulTools();
      for (const soulTool of soulTools) {
        const wrappedHandler = wrapToolHandler(
          soulTool.name,
          soulTool.handler,
          getToolTimeout(soulTool.name)
        );
        const sdkTool = tool(
          soulTool.name,
          soulTool.description,
          Object.fromEntries(
            Object.entries(soulTool.input_schema.properties || {}).map(
              ([key, value]: [string, unknown]) => {
                const prop = value as { type?: string };
                if (prop.type === 'string') return [key, z.string().optional()];
                if (prop.type === 'number') return [key, z.number().optional()];
                return [key, z.any().optional()];
              }
            )
          ),
          async (args) => {
            const result = await wrappedHandler(args);
            return { content: [{ type: 'text', text: result }] };
          }
        );
        tools.push(sdkTool);
      }
    }

    // Scheduler tools (mode-dependent)
    if (needsSchedulerTools) {
      const schedulerTools = getSchedulerTools();
      for (const schedTool of schedulerTools) {
        const wrappedHandler = wrapToolHandler(
          schedTool.name,
          schedTool.handler,
          getToolTimeout(schedTool.name)
        );
        const sdkTool = tool(
          schedTool.name,
          schedTool.description,
          Object.fromEntries(
            Object.entries(schedTool.input_schema.properties || {}).map(
              ([key, value]: [string, unknown]) => {
                const prop = value as { type?: string };
                if (prop.type === 'string') return [key, z.string().optional()];
                if (prop.type === 'number') return [key, z.number().optional()];
                if (prop.type === 'boolean') return [key, z.boolean().optional()];
                return [key, z.any().optional()];
              }
            )
          ),
          async (args) => {
            const result = await wrappedHandler(args);
            return { content: [{ type: 'text', text: result }] };
          }
        );
        tools.push(sdkTool);
      }
    }

    // Social tools (always registered - API availability checked at runtime)
    const socialToolDefs = getSocialTools();
    for (const socialTool of socialToolDefs) {
      const wrappedHandler = wrapToolHandler(
        socialTool.name,
        socialTool.handler,
        getToolTimeout(socialTool.name)
      );
      const sdkTool = tool(
        socialTool.name,
        socialTool.description,
        Object.fromEntries(
          Object.entries(socialTool.input_schema.properties || {}).map(
            ([key, value]: [string, unknown]) => {
              const prop = value as { type?: string };
              if (prop.type === 'string') return [key, z.string().optional()];
              if (prop.type === 'number') return [key, z.number().optional()];
              if (prop.type === 'boolean') return [key, z.boolean().optional()];
              return [key, z.any().optional()];
            }
          )
        ),
        async (args) => {
          const result = await wrappedHandler(args);
          return { content: [{ type: 'text', text: result }] };
        }
      );
      tools.push(sdkTool);
    }

    // Compositor tools (always registered - generates post images locally)
    const compositorToolDefs = getCompositorTools();
    for (const compTool of compositorToolDefs) {
      const wrappedHandler = wrapToolHandler(
        compTool.name,
        compTool.handler,
        getToolTimeout(compTool.name)
      );
      const sdkTool = tool(
        compTool.name,
        compTool.description,
        Object.fromEntries(
          Object.entries(compTool.input_schema.properties || {}).map(
            ([key, value]: [string, unknown]) => {
              const prop = value as { type?: string; items?: unknown };
              if (prop.type === 'string') return [key, z.string().optional()];
              if (prop.type === 'number') return [key, z.number().optional()];
              if (prop.type === 'boolean') return [key, z.boolean().optional()];
              if (prop.type === 'array') return [key, z.array(z.any()).optional()];
              return [key, z.any().optional()];
            }
          )
        ),
        async (args) => {
          const result = await wrappedHandler(args);
          return { content: [{ type: 'text', text: result }] };
        }
      );
      tools.push(sdkTool);
    }

    // Project tools (with diagnostics wrapper)
    const projectTools = getProjectTools();
    for (const projTool of projectTools) {
      const wrappedHandler = wrapToolHandler(
        projTool.name,
        projTool.handler,
        getToolTimeout(projTool.name)
      );
      const sdkTool = tool(
        projTool.name,
        projTool.description,
        Object.fromEntries(
          Object.entries(projTool.input_schema.properties || {}).map(
            ([key, value]: [string, unknown]) => {
              const prop = value as { type?: string };
              if (prop.type === 'string') return [key, z.string().optional()];
              if (prop.type === 'number') return [key, z.number().optional()];
              return [key, z.any().optional()];
            }
          )
        ),
        async (args) => {
          const result = await wrappedHandler(args);
          return { content: [{ type: 'text', text: result }] };
        }
      );
      tools.push(sdkTool);
    }

    // switch_agent tool (available in all modes)
    const switchDef = getSwitchAgentTool();
    const wrappedSwitchHandler = wrapToolHandler(
      switchDef.name,
      switchDef.handler,
      getToolTimeout(switchDef.name)
    );
    const switchTool = tool(
      switchDef.name,
      switchDef.description,
      {
        mode: z.string(),
        reason: z.string(),
      },
      async (args) => {
        const result = await wrappedSwitchHandler(args);
        return { content: [{ type: 'text', text: result }] };
      }
    );
    tools.push(switchTool);

    // Create the SDK MCP server
    const server = createSdkMcpServer({
      name: 'neon-post-tools',
      version: '1.0.0',
      tools,
    });

    return { 'neon-post': server };
  } catch (error) {
    console.error('[Tools] Failed to build SDK MCP servers:', error);
    return null;
  }
}

/**
 * Get custom tools for the agent
 */
export function getCustomTools(config: ToolsConfig): Array<{
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  handler: (input: unknown) => Promise<string>;
}> {
  const tools: Array<{
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
    handler: (input: unknown) => Promise<string>;
  }> = [];

  // Memory tools (always enabled)
  const memoryTools = getMemoryTools();
  for (const tool of memoryTools) {
    tools.push({
      name: tool.name,
      description: tool.description,
      input_schema: tool.input_schema as Record<string, unknown>,
      handler: tool.handler,
    });
  }

  // Soul tools (always enabled)
  const soulTools = getSoulTools();
  for (const tool of soulTools) {
    tools.push({
      name: tool.name,
      description: tool.description,
      input_schema: tool.input_schema as Record<string, unknown>,
      handler: tool.handler,
    });
  }

  // Browser tool
  if (config.browser.enabled) {
    const browserDef = getBrowserToolDefinition();
    tools.push({
      name: browserDef.name,
      description: browserDef.description,
      input_schema: browserDef.input_schema as Record<string, unknown>,
      handler: handleBrowserTool,
    });
  }

  // Scheduler tools (always enabled - scheduler availability checked at runtime)
  const schedulerTools = getSchedulerTools();
  for (const tool of schedulerTools) {
    tools.push({
      name: tool.name,
      description: tool.description,
      input_schema: tool.input_schema as Record<string, unknown>,
      handler: tool.handler,
    });
  }

  // Social tools (always enabled - API availability checked at runtime)
  const socialTools = getSocialTools();
  for (const tool of socialTools) {
    tools.push({
      name: tool.name,
      description: tool.description,
      input_schema: tool.input_schema as Record<string, unknown>,
      handler: tool.handler,
    });
  }

  // Compositor tools (always enabled - generates post images locally)
  const compositorTools = getCompositorTools();
  for (const tool of compositorTools) {
    tools.push({
      name: tool.name,
      description: tool.description,
      input_schema: tool.input_schema as Record<string, unknown>,
      handler: tool.handler,
    });
  }

  // macOS tools (notifications and PTY exec)
  const notifyDef = getNotifyToolDefinition();
  tools.push({
    name: notifyDef.name,
    description: notifyDef.description,
    input_schema: notifyDef.input_schema as Record<string, unknown>,
    handler: handleNotifyTool,
  });

  // Project tools
  const projectTools = getProjectTools();
  for (const tool of projectTools) {
    tools.push({
      name: tool.name,
      description: tool.description,
      input_schema: tool.input_schema as Record<string, unknown>,
      handler: tool.handler,
    });
  }

  // switch_agent tool (available in all modes)
  const switchDef = getSwitchAgentTool();
  tools.push({
    name: switchDef.name,
    description: switchDef.description,
    input_schema: switchDef.input_schema as Record<string, unknown>,
    handler: switchDef.handler as (input: unknown) => Promise<string>,
  });

  return tools;
}

/**
 * Validate that required environment variables are set
 */
export function validateToolsConfig(config: ToolsConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (config.computerUse.enabled && config.computerUse.dockerized) {
    // Check if Docker is available
    try {
      execSync('docker --version', { stdio: 'ignore' });
    } catch {
      errors.push('Docker not available (required for safe computer use)');
    }
  }

  return { valid: errors.length === 0, errors };
}
