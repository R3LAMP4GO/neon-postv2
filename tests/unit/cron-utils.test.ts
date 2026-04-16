/**
 * Unit tests for cron/schedule utilities
 *
 * Tests cron field matching, schedule parsing, datetime parsing, validation, and next-run calculation.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  matchesCronField,
  parseSchedule,
  parseDateTime,
  validateCron,
  calculateNextRun,
} from '../../src/utils/cron';

describe('Cron Utilities', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // ============ matchesCronField ============

  describe('matchesCronField', () => {
    it('should match wildcard * for any value', () => {
      expect(matchesCronField('*', 0, 0, 59)).toBe(true);
      expect(matchesCronField('*', 30, 0, 59)).toBe(true);
      expect(matchesCronField('*', 59, 0, 59)).toBe(true);
    });

    it('should match exact integer value', () => {
      expect(matchesCronField('5', 5, 0, 59)).toBe(true);
      expect(matchesCronField('5', 6, 0, 59)).toBe(false);
      expect(matchesCronField('0', 0, 0, 59)).toBe(true);
    });

    it('should match ranges (N-M)', () => {
      expect(matchesCronField('1-5', 3, 0, 59)).toBe(true);
      expect(matchesCronField('1-5', 1, 0, 59)).toBe(true);
      expect(matchesCronField('1-5', 5, 0, 59)).toBe(true);
      expect(matchesCronField('1-5', 0, 0, 59)).toBe(false);
      expect(matchesCronField('1-5', 6, 0, 59)).toBe(false);
    });

    it('should match step with wildcard (*/N)', () => {
      expect(matchesCronField('*/15', 0, 0, 59)).toBe(true);
      expect(matchesCronField('*/15', 15, 0, 59)).toBe(true);
      expect(matchesCronField('*/15', 30, 0, 59)).toBe(true);
      expect(matchesCronField('*/15', 45, 0, 59)).toBe(true);
      expect(matchesCronField('*/15', 10, 0, 59)).toBe(false);
    });

    it('should match step with range (N-M/S)', () => {
      expect(matchesCronField('0-30/10', 0, 0, 59)).toBe(true);
      expect(matchesCronField('0-30/10', 10, 0, 59)).toBe(true);
      expect(matchesCronField('0-30/10', 20, 0, 59)).toBe(true);
      expect(matchesCronField('0-30/10', 30, 0, 59)).toBe(true);
      expect(matchesCronField('0-30/10', 5, 0, 59)).toBe(false);
      expect(matchesCronField('0-30/10', 40, 0, 59)).toBe(false);
    });

    it('should match step with start value (N/S)', () => {
      // e.g. "5/10" means starting at 5, every 10 → 5, 15, 25, 35, 45, 55
      expect(matchesCronField('5/10', 5, 0, 59)).toBe(true);
      expect(matchesCronField('5/10', 15, 0, 59)).toBe(true);
      expect(matchesCronField('5/10', 25, 0, 59)).toBe(true);
      expect(matchesCronField('5/10', 6, 0, 59)).toBe(false);
    });

    it('should match comma-separated lists', () => {
      expect(matchesCronField('1,5,10', 1, 0, 59)).toBe(true);
      expect(matchesCronField('1,5,10', 5, 0, 59)).toBe(true);
      expect(matchesCronField('1,5,10', 10, 0, 59)).toBe(true);
      expect(matchesCronField('1,5,10', 3, 0, 59)).toBe(false);
    });

    it('should handle comma-separated with ranges', () => {
      expect(matchesCronField('1-3,7-9', 2, 0, 59)).toBe(true);
      expect(matchesCronField('1-3,7-9', 8, 0, 59)).toBe(true);
      expect(matchesCronField('1-3,7-9', 5, 0, 59)).toBe(false);
    });

    it('should handle edge case: value at min boundary', () => {
      expect(matchesCronField('0', 0, 0, 59)).toBe(true);
      expect(matchesCronField('1', 1, 1, 31)).toBe(true);
    });

    it('should handle edge case: value at max boundary', () => {
      expect(matchesCronField('59', 59, 0, 59)).toBe(true);
      expect(matchesCronField('23', 23, 0, 23)).toBe(true);
    });
  });

  // ============ parseSchedule ============

  describe('parseSchedule', () => {
    it('should parse "every Nm" as recurring interval (minutes)', () => {
      const result = parseSchedule('every 30m');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('every');
      expect(result!.intervalMs).toBe(30 * 60 * 1000);
    });

    it('should parse "every Nh" as recurring interval (hours)', () => {
      const result = parseSchedule('every 2h');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('every');
      expect(result!.intervalMs).toBe(2 * 60 * 60 * 1000);
    });

    it('should parse "every Nd" as recurring interval (days)', () => {
      const result = parseSchedule('every 1d');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('every');
      expect(result!.intervalMs).toBe(24 * 60 * 60 * 1000);
    });

    it('should parse "every N minutes" as recurring interval', () => {
      const result = parseSchedule('every 15 minutes');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('every');
      expect(result!.intervalMs).toBe(15 * 60 * 1000);
    });

    it('should parse "every N hours" as recurring interval', () => {
      const result = parseSchedule('every 3 hours');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('every');
      expect(result!.intervalMs).toBe(3 * 60 * 60 * 1000);
    });

    it('should parse bare duration "30m" as one-shot at type', () => {
      const before = Date.now();
      const result = parseSchedule('30m');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('at');
      expect(result!.runAt).toBeDefined();
      const runAtTime = new Date(result!.runAt!).getTime();
      expect(runAtTime).toBeGreaterThanOrEqual(before + 30 * 60 * 1000 - 1000);
      expect(runAtTime).toBeLessThanOrEqual(before + 30 * 60 * 1000 + 1000);
    });

    it('should parse bare duration "2h" as one-shot', () => {
      const result = parseSchedule('2h');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('at');
      expect(result!.runAt).toBeDefined();
    });

    it('should parse "tomorrow 3pm" as at type', () => {
      const result = parseSchedule('tomorrow 3pm');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('at');
      expect(result!.runAt).toBeDefined();
      const runDate = new Date(result!.runAt!);
      expect(runDate.getHours()).toBe(15);
    });

    it('should parse "today 9am" as at type', () => {
      const result = parseSchedule('today 9am');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('at');
    });

    it('should parse "in 10 minutes" as at type', () => {
      const result = parseSchedule('in 10 minutes');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('at');
      expect(result!.runAt).toBeDefined();
    });

    it('should parse valid cron expression', () => {
      const result = parseSchedule('0 9 * * *');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('cron');
      expect(result!.schedule).toBe('0 9 * * *');
    });

    it('should parse "*/5 * * * *" as cron', () => {
      const result = parseSchedule('*/5 * * * *');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('cron');
      expect(result!.schedule).toBe('*/5 * * * *');
    });

    it('should return null for unrecognized input', () => {
      expect(parseSchedule('foobar nonsense')).toBeNull();
    });

    it('should handle whitespace in input', () => {
      const result = parseSchedule('  every 5m  ');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('every');
    });
  });

  // ============ parseDateTime ============

  describe('parseDateTime', () => {
    it('should parse "today Npm" format', () => {
      const result = parseDateTime('today 3pm');
      expect(result).not.toBeNull();
      const date = new Date(result!);
      expect(date.getHours()).toBe(15);
      expect(date.getMinutes()).toBe(0);
    });

    it('should parse "tomorrow Nam" format', () => {
      const result = parseDateTime('tomorrow 9am');
      expect(result).not.toBeNull();
      const date = new Date(result!);
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      expect(date.getDate()).toBe(tomorrow.getDate());
      expect(date.getHours()).toBe(9);
    });

    it('should parse "tomorrow N:MMpm" format', () => {
      const result = parseDateTime('tomorrow 2:30pm');
      expect(result).not.toBeNull();
      const date = new Date(result!);
      expect(date.getHours()).toBe(14);
      expect(date.getMinutes()).toBe(30);
    });

    it('should parse day of week format', () => {
      const result = parseDateTime('monday 10am');
      expect(result).not.toBeNull();
      const date = new Date(result!);
      expect(date.getDay()).toBe(1); // Monday
      expect(date.getHours()).toBe(10);
    });

    it('should handle 12am as midnight', () => {
      const result = parseDateTime('tomorrow 12am');
      expect(result).not.toBeNull();
      const date = new Date(result!);
      expect(date.getHours()).toBe(0);
    });

    it('should handle 12pm as noon', () => {
      const result = parseDateTime('tomorrow 12pm');
      expect(result).not.toBeNull();
      const date = new Date(result!);
      expect(date.getHours()).toBe(12);
    });

    it('should parse "in N hours" format', () => {
      const before = Date.now();
      const result = parseDateTime('in 2 hours');
      expect(result).not.toBeNull();
      const date = new Date(result!);
      expect(date.getTime()).toBeGreaterThanOrEqual(before + 2 * 3600000 - 1000);
      expect(date.getTime()).toBeLessThanOrEqual(before + 2 * 3600000 + 1000);
    });

    it('should parse "in N minutes" format', () => {
      const before = Date.now();
      const result = parseDateTime('in 30 minutes');
      expect(result).not.toBeNull();
      const date = new Date(result!);
      expect(date.getTime()).toBeGreaterThanOrEqual(before + 30 * 60000 - 1000);
    });

    it('should parse "in N days" format', () => {
      const before = Date.now();
      const result = parseDateTime('in 3 days');
      expect(result).not.toBeNull();
      const date = new Date(result!);
      expect(date.getTime()).toBeGreaterThanOrEqual(before + 3 * 86400000 - 1000);
    });

    it('should parse future ISO date strings', () => {
      const futureDate = new Date(Date.now() + 86400000).toISOString();
      const result = parseDateTime(futureDate);
      expect(result).not.toBeNull();
    });

    it('should return null for past ISO dates', () => {
      const pastDate = new Date('2020-01-01').toISOString();
      const result = parseDateTime(pastDate);
      expect(result).toBeNull();
    });

    it('should return null for invalid strings', () => {
      expect(parseDateTime('not a date')).toBeNull();
    });
  });

  // ============ validateCron ============

  describe('validateCron', () => {
    it('should validate standard cron expressions', () => {
      expect(validateCron('0 9 * * *')).toBe(true);
      expect(validateCron('*/5 * * * *')).toBe(true);
      expect(validateCron('0 0 1 1 *')).toBe(true);
    });

    it('should validate wildcard-only expressions', () => {
      expect(validateCron('* * * * *')).toBe(true);
    });

    it('should validate ranges', () => {
      expect(validateCron('0-30 * * * *')).toBe(true);
      expect(validateCron('* 9-17 * * *')).toBe(true);
    });

    it('should validate steps', () => {
      expect(validateCron('*/10 * * * *')).toBe(true);
      expect(validateCron('0 */2 * * *')).toBe(true);
    });

    it('should validate comma lists', () => {
      expect(validateCron('0,15,30,45 * * * *')).toBe(true);
    });

    it('should reject wrong number of fields', () => {
      expect(validateCron('0 9 * *')).toBe(false); // 4 fields
      expect(validateCron('0 9 * * * *')).toBe(false); // 6 fields
      expect(validateCron('0 9')).toBe(false); // 2 fields
    });

    it('should reject out-of-range minute values', () => {
      expect(validateCron('60 * * * *')).toBe(false);
      expect(validateCron('99 * * * *')).toBe(false);
    });

    it('should reject out-of-range hour values', () => {
      expect(validateCron('0 24 * * *')).toBe(false);
    });

    it('should reject out-of-range day values', () => {
      expect(validateCron('0 0 0 * *')).toBe(false); // day must be 1-31
      expect(validateCron('0 0 32 * *')).toBe(false);
    });

    it('should reject out-of-range month values', () => {
      expect(validateCron('0 0 * 0 *')).toBe(false); // month must be 1-12
      expect(validateCron('0 0 * 13 *')).toBe(false);
    });

    it('should reject non-numeric values (not ranges/steps/commas)', () => {
      expect(validateCron('abc * * * *')).toBe(false);
    });

    it('should accept weekday 0-7 (both 0 and 7 are Sunday)', () => {
      expect(validateCron('0 0 * * 0')).toBe(true);
      expect(validateCron('0 0 * * 7')).toBe(true);
    });
  });

  // ============ calculateNextRun ============

  describe('calculateNextRun', () => {
    it('should return runAt for "at" type if in the future', () => {
      const futureDate = new Date(Date.now() + 3600000).toISOString();
      const result = calculateNextRun('at', null, futureDate, null);
      expect(result).toBe(futureDate);
    });

    it('should return null for "at" type if runAt is in the past', () => {
      const pastDate = new Date(Date.now() - 3600000).toISOString();
      const result = calculateNextRun('at', null, pastDate, null);
      expect(result).toBeNull();
    });

    it('should return future time for "every" type based on intervalMs', () => {
      const before = Date.now();
      const result = calculateNextRun('every', null, null, 60000);
      expect(result).not.toBeNull();
      const resultTime = new Date(result!).getTime();
      expect(resultTime).toBeGreaterThanOrEqual(before + 60000 - 1000);
      expect(resultTime).toBeLessThanOrEqual(before + 60000 + 1000);
    });

    it('should calculate next run for "cron" type "* * * * *" (every minute)', () => {
      const result = calculateNextRun('cron', '* * * * *', null, null);
      expect(result).not.toBeNull();
      const nextRun = new Date(result!);
      const now = new Date();
      // Should be within 2 minutes
      expect(nextRun.getTime() - now.getTime()).toBeLessThanOrEqual(2 * 60 * 1000);
      expect(nextRun.getTime()).toBeGreaterThan(now.getTime());
    });

    it('should calculate next run for specific hour cron', () => {
      // Use next hour to ensure it's in the future within 48h
      const nextHour = (new Date().getHours() + 1) % 24;
      const result = calculateNextRun('cron', `0 ${nextHour} * * *`, null, null);
      expect(result).not.toBeNull();
      const nextRun = new Date(result!);
      expect(nextRun.getHours()).toBe(nextHour);
      expect(nextRun.getMinutes()).toBe(0);
    });

    it('should return null for invalid cron (wrong field count)', () => {
      const result = calculateNextRun('cron', '0 9 *', null, null);
      expect(result).toBeNull();
    });

    it('should return null for unknown type', () => {
      const result = calculateNextRun('unknown', null, null, null);
      expect(result).toBeNull();
    });

    it('should return null for "at" with no runAt', () => {
      const result = calculateNextRun('at', null, null, null);
      expect(result).toBeNull();
    });

    it('should return null for "every" with no intervalMs', () => {
      const result = calculateNextRun('every', null, null, null);
      expect(result).toBeNull();
    });
  });
});
