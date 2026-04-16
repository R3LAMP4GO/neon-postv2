/**
 * Unit tests for date/schedule formatting utilities
 *
 * Tests formatDateTime, formatDuration, and formatScheduleDisplay.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  formatDateTime,
  formatDuration,
  formatScheduleDisplay,
} from '../../src/utils/date-format';

describe('Date Format Utilities', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // ============ formatDateTime ============

  describe('formatDateTime', () => {
    it('should return null for null input', () => {
      expect(formatDateTime(null)).toBeNull();
    });

    it('should return null for empty string', () => {
      // Empty string is falsy in JS
      expect(formatDateTime('')).toBeNull();
    });

    it('should format a valid ISO string', () => {
      const result = formatDateTime('2024-12-25T15:00:00.000Z');
      expect(result).not.toBeNull();
      expect(typeof result).toBe('string');
      // Should contain readable parts (locale-dependent, but should have basic components)
      expect(result!).toContain('Dec');
      expect(result!).toContain('25');
    });

    it('should include weekday in output', () => {
      const result = formatDateTime('2024-12-25T15:00:00.000Z');
      expect(result).not.toBeNull();
      // Dec 25 2024 is a Wednesday
      expect(result!).toContain('Wed');
    });

    it('should use 12-hour format with AM/PM', () => {
      const result = formatDateTime('2024-06-15T14:30:00.000Z');
      expect(result).not.toBeNull();
      // Should contain AM or PM
      expect(result!).toMatch(/AM|PM/);
    });

    it('should handle midnight ISO string', () => {
      const result = formatDateTime('2024-01-01T00:00:00.000Z');
      expect(result).not.toBeNull();
      expect(typeof result).toBe('string');
    });

    it('should handle end-of-year ISO string', () => {
      const result = formatDateTime('2024-12-31T23:59:59.000Z');
      expect(result).not.toBeNull();
      expect(result!).toContain('Dec');
      expect(result!).toContain('31');
    });
  });

  // ============ formatDuration ============

  describe('formatDuration', () => {
    it('should format milliseconds under a minute as seconds', () => {
      expect(formatDuration(5000)).toBe('5s');
      expect(formatDuration(30000)).toBe('30s');
      expect(formatDuration(59999)).toBe('60s');
    });

    it('should format zero milliseconds as 0s', () => {
      expect(formatDuration(0)).toBe('0s');
    });

    it('should format milliseconds in minutes range', () => {
      expect(formatDuration(60000)).toBe('1m');
      expect(formatDuration(1800000)).toBe('30m');
      expect(formatDuration(3599999)).toBe('60m');
    });

    it('should format milliseconds in hours range', () => {
      expect(formatDuration(3600000)).toBe('1h');
      expect(formatDuration(7200000)).toBe('2h');
      expect(formatDuration(43200000)).toBe('12h');
    });

    it('should format milliseconds in days range', () => {
      expect(formatDuration(86400000)).toBe('1d');
      expect(formatDuration(172800000)).toBe('2d');
      expect(formatDuration(604800000)).toBe('7d');
    });

    it('should handle boundary between seconds and minutes (59999ms)', () => {
      // 59999 < 60000, so still seconds
      expect(formatDuration(59999)).toBe('60s');
    });

    it('should handle boundary between minutes and hours (3599999ms)', () => {
      // 3599999 < 3600000, so still minutes
      expect(formatDuration(3599999)).toBe('60m');
    });

    it('should handle boundary between hours and days (86399999ms)', () => {
      // 86399999 < 86400000, so still hours
      expect(formatDuration(86399999)).toBe('24h');
    });

    it('should round values correctly', () => {
      // 90000ms = 1.5 minutes → Math.round → 2m
      expect(formatDuration(90000)).toBe('2m');
      // 45000ms = 45s → Math.round(45000/1000) = 45s
      expect(formatDuration(45000)).toBe('45s');
    });
  });

  // ============ formatScheduleDisplay ============

  describe('formatScheduleDisplay', () => {
    it('should format cron type with schedule', () => {
      const result = formatScheduleDisplay({
        schedule_type: 'cron',
        schedule: '0 9 * * *',
      });
      expect(result).toBe('cron: 0 9 * * *');
    });

    it('should format at type with run_at', () => {
      const result = formatScheduleDisplay({
        schedule_type: 'at',
        schedule: null,
        run_at: '2024-12-25T15:00:00.000Z',
      });
      expect(result).toContain('at:');
      expect(result).toContain('Dec');
      expect(result).toContain('25');
    });

    it('should format every type with interval_ms', () => {
      const result = formatScheduleDisplay({
        schedule_type: 'every',
        schedule: null,
        interval_ms: 1800000,
      });
      expect(result).toBe('every 30m');
    });

    it('should format every type with hours interval', () => {
      const result = formatScheduleDisplay({
        schedule_type: 'every',
        schedule: null,
        interval_ms: 7200000,
      });
      expect(result).toBe('every 2h');
    });

    it('should format every type with days interval', () => {
      const result = formatScheduleDisplay({
        schedule_type: 'every',
        schedule: null,
        interval_ms: 86400000,
      });
      expect(result).toBe('every 1d');
    });

    it('should fallback to schedule string if type not matched', () => {
      const result = formatScheduleDisplay({
        schedule_type: 'unknown',
        schedule: '0 */2 * * *',
      });
      expect(result).toBe('0 */2 * * *');
    });

    it('should fallback to run_at when type unknown and no schedule', () => {
      const result = formatScheduleDisplay({
        schedule_type: 'unknown',
        schedule: null,
        run_at: '2024-12-25T15:00:00.000Z',
      });
      expect(result).toContain('at:');
    });

    it('should fallback to interval_ms when type unknown and nothing else', () => {
      const result = formatScheduleDisplay({
        schedule_type: 'unknown',
        schedule: null,
        interval_ms: 60000,
      });
      expect(result).toBe('every 1m');
    });

    it('should return "unknown" when no info available', () => {
      const result = formatScheduleDisplay({
        schedule: null,
      });
      expect(result).toBe('unknown');
    });

    it('should default to cron type when schedule_type not provided', () => {
      const result = formatScheduleDisplay({
        schedule: '*/15 * * * *',
      });
      expect(result).toBe('cron: */15 * * * *');
    });

    it('should handle at type with null run_at gracefully', () => {
      const result = formatScheduleDisplay({
        schedule_type: 'at',
        schedule: null,
        run_at: null,
      });
      // Falls through to fallback logic, no schedule, no run_at, no interval
      expect(result).toBe('unknown');
    });
  });
});
