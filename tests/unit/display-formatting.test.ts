/**
 * Unit tests for agent display formatting utilities
 *
 * Tests subagent messages, tool name formatting, tool input formatting,
 * pocket CLI detection, and pocket command formatting.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  getSubagentMessage,
  formatToolName,
  formatToolInput,
  isPocketCliCommand,
  formatPocketCommand,
} from '../../src/agent/display-formatting';

describe('Display Formatting', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // ============ getSubagentMessage ============

  describe('getSubagentMessage', () => {
    it('should return message for Explore agent', () => {
      expect(getSubagentMessage('Explore')).toBe('sent a curious kitten to explore');
    });

    it('should return message for Plan agent', () => {
      expect(getSubagentMessage('Plan')).toBe('calling in the architect cat');
    });

    it('should return message for Bash agent', () => {
      expect(getSubagentMessage('Bash')).toBe('summoning a terminal tabby');
    });

    it('should return message for general-purpose agent', () => {
      expect(getSubagentMessage('general-purpose')).toBe('summoning a helper kitty');
    });

    it('should return fallback message for unknown agent type', () => {
      expect(getSubagentMessage('CustomAgent')).toBe('summoning CustomAgent cat friend');
    });

    it('should return fallback for empty string', () => {
      expect(getSubagentMessage('')).toBe('summoning  cat friend');
    });
  });

  // ============ formatToolName ============

  describe('formatToolName', () => {
    it('should format SDK built-in tools', () => {
      expect(formatToolName('Read')).toBe('sniffing this file');
      expect(formatToolName('Write')).toBe('scratching notes down');
      expect(formatToolName('Edit')).toBe('pawing at some code');
      expect(formatToolName('Bash')).toBe('hacking at the terminal');
      expect(formatToolName('Glob')).toBe('hunting for files');
      expect(formatToolName('Grep')).toBe('digging through code');
      expect(formatToolName('WebSearch')).toBe('prowling the web');
      expect(formatToolName('WebFetch')).toBe('fetching that page');
      expect(formatToolName('Task')).toBe('summoning a helper kitty');
    });

    it('should format memory tools', () => {
      expect(formatToolName('remember')).toBe('stashing in my cat brain');
      expect(formatToolName('forget')).toBe('knocking it off the shelf');
      expect(formatToolName('list_facts')).toBe('checking my memories');
      expect(formatToolName('memory_search')).toBe('sniffing through archives');
    });

    it('should format browser tool', () => {
      expect(formatToolName('browser')).toBe('pouncing on browser');
    });

    it('should format computer use tool', () => {
      expect(formatToolName('computer')).toBe('walking on the keyboard');
    });

    it('should format scheduler tools', () => {
      expect(formatToolName('schedule_task')).toBe('setting an alarm meow');
      expect(formatToolName('list_scheduled_tasks')).toBe('checking the schedule');
      expect(formatToolName('delete_scheduled_task')).toBe('knocking that off');
    });

    it('should format agent teams tools', () => {
      expect(formatToolName('TeammateTool')).toBe('rallying the squad');
      expect(formatToolName('TeamCreate')).toBe('rallying the squad');
      expect(formatToolName('SendMessage')).toBe('passing a note');
    });

    it('should return raw name for unknown tools', () => {
      expect(formatToolName('some_custom_tool')).toBe('some_custom_tool');
      expect(formatToolName('mcp__my_server__tool')).toBe('mcp__my_server__tool');
    });
  });

  // ============ formatToolInput ============

  describe('formatToolInput', () => {
    it('should return empty string for null/undefined/falsy input', () => {
      expect(formatToolInput(null)).toBe('');
      expect(formatToolInput(undefined)).toBe('');
      expect(formatToolInput(0)).toBe('');
      expect(formatToolInput('')).toBe('');
    });

    it('should truncate string input to 100 chars', () => {
      const shortStr = 'hello world';
      expect(formatToolInput(shortStr)).toBe('hello world');

      const longStr = 'a'.repeat(200);
      expect(formatToolInput(longStr)).toBe('a'.repeat(100));
    });

    it('should extract file_path from object', () => {
      expect(formatToolInput({ file_path: '/src/index.ts' })).toBe('/src/index.ts');
    });

    it('should extract notebook_path from object', () => {
      expect(formatToolInput({ notebook_path: '/notebooks/test.ipynb' })).toBe(
        '/notebooks/test.ipynb'
      );
    });

    it('should extract pattern from object', () => {
      expect(formatToolInput({ pattern: '*.ts' })).toBe('*.ts');
    });

    it('should extract query from object', () => {
      expect(formatToolInput({ query: 'search term' })).toBe('search term');
    });

    it('should extract and truncate command from object', () => {
      expect(formatToolInput({ command: 'ls -la' })).toBe('ls -la');
      const longCommand = 'echo ' + 'a'.repeat(100);
      expect(formatToolInput({ command: longCommand }).length).toBeLessThanOrEqual(80);
    });

    it('should extract url from object', () => {
      expect(formatToolInput({ url: 'https://example.com' })).toBe('https://example.com');
    });

    it('should extract prompt from object', () => {
      expect(formatToolInput({ prompt: 'do something' })).toBe('do something');
    });

    it('should extract category/subject combination', () => {
      expect(formatToolInput({ category: 'user_info', subject: 'name' })).toBe('user_info/name');
    });

    it('should format browser navigate action (url extracted first)', () => {
      // Note: `url` is checked before `action` in the code, so url is returned directly
      expect(formatToolInput({ action: 'navigate', url: 'https://example.com' })).toBe(
        'https://example.com'
      );
    });

    it('should format browser navigate action without url', () => {
      expect(formatToolInput({ action: 'navigate' })).toBe('navigating');
    });

    it('should format browser screenshot action', () => {
      expect(formatToolInput({ action: 'screenshot' })).toBe('capturing screen');
    });

    it('should format browser click action with selector', () => {
      expect(formatToolInput({ action: 'click', selector: '#submit' })).toBe('clicking #submit');
    });

    it('should format browser type action with text', () => {
      expect(formatToolInput({ action: 'type', text: 'hello' })).toBe('typing "hello"');
    });

    it('should format computer use coordinate input', () => {
      expect(formatToolInput({ coordinate: [100, 200] })).toBe('at (100, 200)');
    });

    it('should format agent teams SendMessage input', () => {
      expect(formatToolInput({ to: 'bob', message: 'hey there' })).toBe('→ bob: hey there');
    });

    it('should format agent teams with name and team_name', () => {
      expect(formatToolInput({ name: 'alice', team_name: 'devs' })).toBe('alice in devs');
    });

    it('should return empty string for object with no recognized keys', () => {
      expect(formatToolInput({ foo: 'bar' })).toBe('');
    });
  });

  // ============ isPocketCliCommand ============

  describe('isPocketCliCommand', () => {
    it('should return true for pocket command', () => {
      expect(isPocketCliCommand({ command: 'pocket news' })).toBe(true);
    });

    it('should return true for pocket command with leading spaces', () => {
      expect(isPocketCliCommand({ command: '  pocket utility' })).toBe(true);
    });

    it('should return false for non-pocket commands', () => {
      expect(isPocketCliCommand({ command: 'ls -la' })).toBe(false);
      expect(isPocketCliCommand({ command: 'npm install' })).toBe(false);
    });

    it('should return false for null/undefined', () => {
      expect(isPocketCliCommand(null)).toBe(false);
      expect(isPocketCliCommand(undefined)).toBe(false);
    });

    it('should return false for non-object input', () => {
      expect(isPocketCliCommand('pocket news')).toBe(false);
      expect(isPocketCliCommand(42)).toBe(false);
    });

    it('should return false when command is not a string', () => {
      expect(isPocketCliCommand({ command: 123 })).toBe(false);
    });
  });

  // ============ formatPocketCommand ============

  describe('formatPocketCommand', () => {
    it('should format pocket news command', () => {
      expect(formatPocketCommand({ command: 'pocket news' })).toBe('fetching the latest news');
    });

    it('should format pocket utility command', () => {
      expect(formatPocketCommand({ command: 'pocket utility' })).toBe('running pocket utility');
    });

    it('should format pocket knowledge command', () => {
      expect(formatPocketCommand({ command: 'pocket knowledge' })).toBe(
        'checking the knowledge base'
      );
    });

    it('should format pocket dev command', () => {
      expect(formatPocketCommand({ command: 'pocket dev' })).toBe('querying dev tools');
    });

    it('should format pocket commands command', () => {
      expect(formatPocketCommand({ command: 'pocket commands' })).toBe(
        'listing pocket commands'
      );
    });

    it('should format pocket setup command', () => {
      expect(formatPocketCommand({ command: 'pocket setup' })).toBe('configuring pocket');
    });

    it('should format pocket integrations command', () => {
      expect(formatPocketCommand({ command: 'pocket integrations' })).toBe(
        'checking integrations'
      );
    });

    it('should return default for unknown subcommand', () => {
      expect(formatPocketCommand({ command: 'pocket unknown' })).toBe('running pocket cli');
    });

    it('should return default for null/undefined input', () => {
      expect(formatPocketCommand(null)).toBe('running pocket cli');
      expect(formatPocketCommand(undefined)).toBe('running pocket cli');
    });

    it('should return default for non-object input', () => {
      expect(formatPocketCommand('not an object')).toBe('running pocket cli');
    });

    it('should handle pocket command with no subcommand', () => {
      expect(formatPocketCommand({ command: 'pocket' })).toBe('running pocket cli');
    });
  });
});
