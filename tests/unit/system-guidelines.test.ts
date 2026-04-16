/**
 * Unit tests for system-guidelines.ts
 *
 * Tests the SYSTEM_GUIDELINES constant for content, structure, and correctness.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import { SYSTEM_GUIDELINES } from '../../src/config/system-guidelines';

describe('System Guidelines', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // ============ Basic structure ============

  describe('basic structure', () => {
    it('should be a non-empty string', () => {
      expect(typeof SYSTEM_GUIDELINES).toBe('string');
      expect(SYSTEM_GUIDELINES.length).toBeGreaterThan(0);
    });

    it('should be a substantial document (over 1000 chars)', () => {
      expect(SYSTEM_GUIDELINES.length).toBeGreaterThan(1000);
    });

    it('should be exportable as a named export', () => {
      expect(SYSTEM_GUIDELINES).toBeDefined();
    });
  });

  // ============ Memory section ============

  describe('Memory section', () => {
    it('should contain a Memory section header', () => {
      expect(SYSTEM_GUIDELINES).toContain('## Memory');
    });

    it('should mention the remember tool', () => {
      expect(SYSTEM_GUIDELINES).toContain('remember');
    });

    it('should instruct to save important information proactively', () => {
      expect(SYSTEM_GUIDELINES).toContain('save important information');
    });

    it('should include guidance on what to save', () => {
      expect(SYSTEM_GUIDELINES).toContain('Name, birthday, location');
      expect(SYSTEM_GUIDELINES).toContain('Preferences');
      expect(SYSTEM_GUIDELINES).toContain('Projects');
    });

    it('should include guidance on what NOT to save', () => {
      expect(SYSTEM_GUIDELINES).toContain("Don't save");
    });

    it('should include guidance on keeping facts small', () => {
      expect(SYSTEM_GUIDELINES).toContain('Max 25-30 words');
    });

    it('should include categories list', () => {
      expect(SYSTEM_GUIDELINES).toContain('user_info');
      expect(SYSTEM_GUIDELINES).toContain('preferences');
      expect(SYSTEM_GUIDELINES).toContain('projects');
      expect(SYSTEM_GUIDELINES).toContain('people');
    });

    it('should mention memory_search', () => {
      expect(SYSTEM_GUIDELINES).toContain('memory_search');
    });
  });

  // ============ Soul section ============

  describe('Soul section', () => {
    it('should contain a Soul section header', () => {
      expect(SYSTEM_GUIDELINES).toContain('## Soul');
    });

    it('should mention soul_set tool', () => {
      expect(SYSTEM_GUIDELINES).toContain('soul_set');
    });

    it('should describe when to record soul entries', () => {
      expect(SYSTEM_GUIDELINES).toContain('correct how you communicate');
    });
  });

  // ============ Routines vs Reminders section ============

  describe('Routines vs Reminders section', () => {
    it('should contain a Routines vs Reminders section', () => {
      expect(SYSTEM_GUIDELINES).toContain('## Routines vs Reminders');
    });

    it('should describe create_routine', () => {
      expect(SYSTEM_GUIDELINES).toContain('create_routine');
    });

    it('should describe create_reminder', () => {
      expect(SYSTEM_GUIDELINES).toContain('create_reminder');
    });

    it('should explain the difference between routines and reminders', () => {
      // Routines involve LLM; reminders just display a message
      expect(SYSTEM_GUIDELINES).toContain('PROMPT for the LLM');
      expect(SYSTEM_GUIDELINES).toContain('NO LLM involvement');
    });
  });

  // ============ Pocket CLI section ============

  describe('Pocket CLI section', () => {
    it('should contain a Pocket CLI section', () => {
      expect(SYSTEM_GUIDELINES).toContain('## Pocket CLI');
    });

    it('should describe discovery commands', () => {
      expect(SYSTEM_GUIDELINES).toContain('pocket commands');
      expect(SYSTEM_GUIDELINES).toContain('pocket integrations list');
    });

    it('should describe setup commands', () => {
      expect(SYSTEM_GUIDELINES).toContain('pocket setup list');
      expect(SYSTEM_GUIDELINES).toContain('pocket setup show');
      expect(SYSTEM_GUIDELINES).toContain('pocket setup set');
    });

    it('should include usage examples', () => {
      expect(SYSTEM_GUIDELINES).toContain('pocket news');
      expect(SYSTEM_GUIDELINES).toContain('pocket utility weather');
    });
  });

  // ============ Daily Log section ============

  describe('Daily Log section', () => {
    it('should contain a Daily Log section', () => {
      expect(SYSTEM_GUIDELINES).toContain('## Daily Log');
    });

    it('should mention daily_log tool', () => {
      expect(SYSTEM_GUIDELINES).toContain('daily_log');
    });

    it('should mention 3 days of context', () => {
      expect(SYSTEM_GUIDELINES).toContain('last 3 days');
    });

    it('should include guidance on what to log', () => {
      expect(SYSTEM_GUIDELINES).toContain('What the user worked on');
      expect(SYSTEM_GUIDELINES).toContain('Tasks completed');
    });

    it('should include guidance on when to log', () => {
      expect(SYSTEM_GUIDELINES).toContain('After a meaningful conversation');
    });
  });

  // ============ Agent Switching section ============

  describe('Agent Switching section', () => {
    it('should contain an Agent Switching section', () => {
      expect(SYSTEM_GUIDELINES).toContain('## Agent Switching');
    });

    it('should mention switch_agent tool', () => {
      expect(SYSTEM_GUIDELINES).toContain('switch_agent');
    });

    it('should list all available agents', () => {
      expect(SYSTEM_GUIDELINES).toContain('General');
      expect(SYSTEM_GUIDELINES).toContain('Coder');
      expect(SYSTEM_GUIDELINES).toContain('Researcher');
      expect(SYSTEM_GUIDELINES).toContain('Writer');
      expect(SYSTEM_GUIDELINES).toContain('Therapist');
    });

    it('should provide switching guidance', () => {
      expect(SYSTEM_GUIDELINES).toContain('Switch when');
    });

    it('should warn against unnecessary switching', () => {
      expect(SYSTEM_GUIDELINES).toContain('Do NOT switch for trivial requests');
    });
  });

  // ============ Formatting ============

  describe('formatting', () => {
    it('should use markdown headers (##)', () => {
      const headers = SYSTEM_GUIDELINES.match(/^## .+/gm);
      expect(headers).toBeTruthy();
      expect(headers!.length).toBeGreaterThanOrEqual(5);
    });

    it('should use bold markdown (**text**)', () => {
      expect(SYSTEM_GUIDELINES).toMatch(/\*\*.+?\*\*/);
    });

    it('should contain code formatting with backticks', () => {
      expect(SYSTEM_GUIDELINES).toMatch(/`.+?`/);
    });

    it('should contain list items (- or *)', () => {
      expect(SYSTEM_GUIDELINES).toMatch(/^- .+/m);
    });
  });
});
