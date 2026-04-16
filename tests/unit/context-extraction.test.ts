/**
 * Unit tests for context extraction utilities
 *
 * Tests timestamp parsing, temporal context building, and fact extraction.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock SettingsManager before importing the module
vi.mock('../../src/settings', () => ({
  SettingsManager: {
    get: vi.fn().mockReturnValue(''),
  },
}));

import { SettingsManager } from '../../src/settings';
import {
  parseDbTimestamp,
  buildTemporalContext,
  extractAndStoreFacts,
} from '../../src/agent/context-extraction';

describe('Context Extraction', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Default: no timezone configured
    vi.mocked(SettingsManager.get).mockReturnValue('');
  });

  // ============ parseDbTimestamp ============

  describe('parseDbTimestamp', () => {
    it('should parse ISO timestamp with Z suffix directly', () => {
      const result = parseDbTimestamp('2024-12-25T15:00:00.000Z');
      expect(result).toBeInstanceOf(Date);
      expect(result.toISOString()).toBe('2024-12-25T15:00:00.000Z');
    });

    it('should parse timestamp with positive timezone offset', () => {
      const result = parseDbTimestamp('2024-12-25T15:00:00+05:00');
      expect(result).toBeInstanceOf(Date);
      // +05:00 means 15:00 local = 10:00 UTC
      expect(result.getUTCHours()).toBe(10);
    });

    it('should parse timestamp with negative timezone offset', () => {
      const result = parseDbTimestamp('2024-12-25T15:00:00-08:00');
      expect(result).toBeInstanceOf(Date);
      // -08:00 means 15:00 local = 23:00 UTC
      expect(result.getUTCHours()).toBe(23);
    });

    it('should treat plain timestamp as UTC when user timezone is set', () => {
      vi.mocked(SettingsManager.get).mockReturnValue('America/New_York');
      const result = parseDbTimestamp('2024-12-25 15:00:00');
      expect(result).toBeInstanceOf(Date);
      // Should be treated as UTC
      expect(result.getUTCHours()).toBe(15);
    });

    it('should treat plain timestamp as local when no timezone configured', () => {
      vi.mocked(SettingsManager.get).mockReturnValue('');
      const result = parseDbTimestamp('2024-12-25 15:00:00');
      expect(result).toBeInstanceOf(Date);
      // Should be treated as local time (so local hours = 15)
      expect(result.getHours()).toBe(15);
    });

    it('should normalize space to T in plain timestamps', () => {
      vi.mocked(SettingsManager.get).mockReturnValue('UTC');
      const result = parseDbTimestamp('2024-06-15 09:30:00');
      expect(result).toBeInstanceOf(Date);
      expect(result.getUTCHours()).toBe(9);
      expect(result.getUTCMinutes()).toBe(30);
    });

    it('should handle T-formatted plain timestamp without timezone', () => {
      vi.mocked(SettingsManager.get).mockReturnValue('');
      const result = parseDbTimestamp('2024-06-15T09:30:00');
      expect(result).toBeInstanceOf(Date);
      expect(result.getHours()).toBe(9);
    });
  });

  // ============ buildTemporalContext ============

  describe('buildTemporalContext', () => {
    it('should include current time header', () => {
      const result = buildTemporalContext();
      expect(result).toContain('## Current Time');
    });

    it('should include day name', () => {
      const result = buildTemporalContext();
      const dayNames = [
        'Sunday',
        'Monday',
        'Tuesday',
        'Wednesday',
        'Thursday',
        'Friday',
        'Saturday',
      ];
      const today = dayNames[new Date().getDay()];
      expect(result).toContain(today);
    });

    it('should include "It is" with date and time', () => {
      const result = buildTemporalContext();
      expect(result).toMatch(/It is \w+, \w+ \d+, \d{4} at/);
    });

    it('should include "just now" for very recent message', () => {
      const recentTimestamp = new Date().toISOString();
      const result = buildTemporalContext(recentTimestamp);
      expect(result).toContain('just now');
    });

    it('should include minutes ago for message within last hour', () => {
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const result = buildTemporalContext(fiveMinAgo);
      expect(result).toMatch(/\d+ minutes? ago/);
    });

    it('should include hours ago for message within last day', () => {
      const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
      const result = buildTemporalContext(threeHoursAgo);
      expect(result).toMatch(/\d+ hours? ago/);
    });

    it('should include days ago for message within last week', () => {
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
      const result = buildTemporalContext(twoDaysAgo);
      expect(result).toMatch(/\d+ days? ago/);
    });

    it('should show date for message older than a week', () => {
      const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
      const result = buildTemporalContext(twoWeeksAgo);
      // Should contain a short month name
      expect(result).toMatch(/Last message from user was \w+ \d+/);
    });

    it('should handle 1 minute ago (singular)', () => {
      const oneMinAgo = new Date(Date.now() - 1 * 60 * 1000 - 1000).toISOString();
      const result = buildTemporalContext(oneMinAgo);
      expect(result).toContain('1 minute ago');
    });

    it('should handle 1 hour ago (singular)', () => {
      const oneHourAgo = new Date(Date.now() - 1 * 60 * 60 * 1000 - 1000).toISOString();
      const result = buildTemporalContext(oneHourAgo);
      expect(result).toContain('1 hour ago');
    });

    it('should handle 1 day ago (singular)', () => {
      const oneDayAgo = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000 - 1000).toISOString();
      const result = buildTemporalContext(oneDayAgo);
      expect(result).toContain('1 day ago');
    });

    it('should not include last message line when no timestamp provided', () => {
      const result = buildTemporalContext();
      expect(result).not.toContain('Last message from user');
    });

    it('should handle invalid timestamp gracefully', () => {
      // Should not throw, just skip the last message section
      const result = buildTemporalContext('not-a-valid-timestamp');
      expect(result).toContain('## Current Time');
      // May or may not contain last message depending on how Date parses it
    });
  });

  // ============ extractAndStoreFacts ============

  describe('extractAndStoreFacts', () => {
    let mockMemory: { saveFact: ReturnType<typeof vi.fn> };

    beforeEach(() => {
      mockMemory = { saveFact: vi.fn() };
    });

    it('should do nothing when memory is null', () => {
      // Should not throw
      extractAndStoreFacts(null, 'my name is Alice');
    });

    it('should extract "my name is X" pattern', () => {
      extractAndStoreFacts(mockMemory as any, 'my name is Alice');
      expect(mockMemory.saveFact).toHaveBeenCalledWith('user_info', 'name', 'Alice');
    });

    it('should extract "call me X" pattern', () => {
      extractAndStoreFacts(mockMemory as any, 'call me Bob');
      expect(mockMemory.saveFact).toHaveBeenCalledWith('user_info', 'name', 'Bob');
    });

    it('should extract "I live in X" pattern', () => {
      extractAndStoreFacts(mockMemory as any, 'I live in New York');
      expect(mockMemory.saveFact).toHaveBeenCalledWith('user_info', 'location', 'New York');
    });

    it('should extract "I\'m from X" pattern', () => {
      extractAndStoreFacts(mockMemory as any, "I'm from San Francisco");
      expect(mockMemory.saveFact).toHaveBeenCalledWith('user_info', 'location', 'San Francisco');
    });

    it('should extract "I work at X" pattern', () => {
      extractAndStoreFacts(mockMemory as any, 'I work at Google');
      expect(mockMemory.saveFact).toHaveBeenCalledWith('work', 'employer', 'Google');
    });

    it('should extract "I work for X" pattern', () => {
      extractAndStoreFacts(mockMemory as any, 'I work for Microsoft');
      expect(mockMemory.saveFact).toHaveBeenCalledWith('work', 'employer', 'Microsoft');
    });

    it('should extract "I work as a X" pattern', () => {
      extractAndStoreFacts(mockMemory as any, 'I work as a software engineer');
      expect(mockMemory.saveFact).toHaveBeenCalledWith('work', 'role', 'software engineer');
    });

    it('should extract "my job is X" pattern', () => {
      extractAndStoreFacts(mockMemory as any, 'my job is data scientist');
      expect(mockMemory.saveFact).toHaveBeenCalledWith('work', 'role', 'data scientist');
    });

    it('should not extract facts from unmatched messages', () => {
      extractAndStoreFacts(mockMemory as any, 'hello how are you');
      expect(mockMemory.saveFact).not.toHaveBeenCalled();
    });

    it('should extract multiple facts from one message', () => {
      extractAndStoreFacts(mockMemory as any, 'my name is Alice, I live in NYC');
      expect(mockMemory.saveFact).toHaveBeenCalledTimes(2);
    });

    it('should trim extracted location values', () => {
      // Location pattern uses ([^.,]+) which can capture trailing spaces; trim cleans them
      extractAndStoreFacts(mockMemory as any, 'I live in Tokyo ');
      expect(mockMemory.saveFact).toHaveBeenCalledWith('user_info', 'location', 'Tokyo');
    });

    it('should stop location at comma', () => {
      extractAndStoreFacts(mockMemory as any, 'I live in Denver, Colorado.');
      // Pattern is ([^.,]+) so it captures up to comma
      expect(mockMemory.saveFact).toHaveBeenCalledWith('user_info', 'location', 'Denver');
    });

    it('should be case-insensitive for patterns', () => {
      extractAndStoreFacts(mockMemory as any, 'MY NAME IS Alice');
      expect(mockMemory.saveFact).toHaveBeenCalledWith('user_info', 'name', 'Alice');
    });
  });
});
