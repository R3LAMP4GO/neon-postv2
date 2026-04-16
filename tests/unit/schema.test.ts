/**
 * Unit tests for settings schema definitions
 *
 * Verifies SETTINGS_SCHEMA structure, completeness, and consistency.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import { SETTINGS_SCHEMA, type SettingDefinition } from '../../src/settings/schema';

const VALID_TYPES = ['string', 'number', 'boolean', 'password', 'array', 'textarea'];

const EXPECTED_CATEGORIES = [
  'auth',
  'api_keys',
  'agent',
  'telegram',
  'ios',
  'memory',
  'browser',
  'scheduler',
  'notifications',
  'window',
  'appearance',
  'chat',
  'personalize',
  'onboarding',
  'profile',
];

describe('Settings Schema', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('SETTINGS_SCHEMA array', () => {
    it('should be a non-empty array', () => {
      expect(Array.isArray(SETTINGS_SCHEMA)).toBe(true);
      expect(SETTINGS_SCHEMA.length).toBeGreaterThan(0);
    });

    it('should have at least 20 settings defined', () => {
      expect(SETTINGS_SCHEMA.length).toBeGreaterThanOrEqual(20);
    });
  });

  describe('schema entry structure', () => {
    it('every entry should have required properties', () => {
      for (const setting of SETTINGS_SCHEMA) {
        expect(setting).toHaveProperty('key');
        expect(setting).toHaveProperty('defaultValue');
        expect(setting).toHaveProperty('encrypted');
        expect(setting).toHaveProperty('category');
        expect(setting).toHaveProperty('label');
        expect(setting).toHaveProperty('type');
      }
    });

    it('every entry should have a non-empty key', () => {
      for (const setting of SETTINGS_SCHEMA) {
        expect(typeof setting.key).toBe('string');
        expect(setting.key.length).toBeGreaterThan(0);
      }
    });

    it('every key should follow dot notation (category.name)', () => {
      for (const setting of SETTINGS_SCHEMA) {
        expect(setting.key).toContain('.');
      }
    });

    it('every entry should have a non-empty label', () => {
      for (const setting of SETTINGS_SCHEMA) {
        expect(typeof setting.label).toBe('string');
        expect(setting.label.length).toBeGreaterThan(0);
      }
    });

    it('encrypted should be boolean', () => {
      for (const setting of SETTINGS_SCHEMA) {
        expect(typeof setting.encrypted).toBe('boolean');
      }
    });

    it('defaultValue should be a string', () => {
      for (const setting of SETTINGS_SCHEMA) {
        expect(typeof setting.defaultValue).toBe('string');
      }
    });

    it('type should be one of valid types', () => {
      for (const setting of SETTINGS_SCHEMA) {
        expect(
          VALID_TYPES,
          `Setting "${setting.key}" has invalid type "${setting.type}"`
        ).toContain(setting.type);
      }
    });

    it('category should be a non-empty string', () => {
      for (const setting of SETTINGS_SCHEMA) {
        expect(typeof setting.category).toBe('string');
        expect(setting.category.length).toBeGreaterThan(0);
      }
    });
  });

  describe('keys uniqueness', () => {
    it('should have unique keys', () => {
      const keys = SETTINGS_SCHEMA.map((s) => s.key);
      const uniqueKeys = new Set(keys);
      expect(uniqueKeys.size).toBe(keys.length);
    });
  });

  describe('expected categories', () => {
    it('should cover all expected categories', () => {
      const categories = new Set(SETTINGS_SCHEMA.map((s) => s.category));
      for (const expected of EXPECTED_CATEGORIES) {
        expect(
          categories.has(expected),
          `Missing expected category: ${expected}`
        ).toBe(true);
      }
    });
  });

  describe('specific settings', () => {
    it('should have auth.method setting', () => {
      const setting = SETTINGS_SCHEMA.find((s) => s.key === 'auth.method');
      expect(setting).toBeDefined();
      expect(setting!.category).toBe('auth');
    });

    it('should have anthropic.apiKey as encrypted password', () => {
      const setting = SETTINGS_SCHEMA.find((s) => s.key === 'anthropic.apiKey');
      expect(setting).toBeDefined();
      expect(setting!.encrypted).toBe(true);
      expect(setting!.type).toBe('password');
    });

    it('should have agent.model with a default value', () => {
      const setting = SETTINGS_SCHEMA.find((s) => s.key === 'agent.model');
      expect(setting).toBeDefined();
      expect(setting!.defaultValue.length).toBeGreaterThan(0);
    });

    it('should have agent.mode defaulting to "coder"', () => {
      const setting = SETTINGS_SCHEMA.find((s) => s.key === 'agent.mode');
      expect(setting).toBeDefined();
      expect(setting!.defaultValue).toBe('coder');
    });

    it('should have telegram.botToken as encrypted', () => {
      const setting = SETTINGS_SCHEMA.find((s) => s.key === 'telegram.botToken');
      expect(setting).toBeDefined();
      expect(setting!.encrypted).toBe(true);
    });

    it('should have telegram.enabled defaulting to false', () => {
      const setting = SETTINGS_SCHEMA.find((s) => s.key === 'telegram.enabled');
      expect(setting).toBeDefined();
      expect(setting!.defaultValue).toBe('false');
      expect(setting!.type).toBe('boolean');
    });

    it('should have ui.skin in appearance category', () => {
      const setting = SETTINGS_SCHEMA.find((s) => s.key === 'ui.skin');
      expect(setting).toBeDefined();
      expect(setting!.category).toBe('appearance');
      expect(setting!.defaultValue).toBe('default');
    });

    it('should have profile.timezone setting', () => {
      const setting = SETTINGS_SCHEMA.find((s) => s.key === 'profile.timezone');
      expect(setting).toBeDefined();
      expect(setting!.category).toBe('profile');
    });

    it('should have profile.name setting', () => {
      const setting = SETTINGS_SCHEMA.find((s) => s.key === 'profile.name');
      expect(setting).toBeDefined();
      expect(setting!.category).toBe('profile');
    });

    it('should have personalize.agentName defaulting to "Frankie"', () => {
      const setting = SETTINGS_SCHEMA.find((s) => s.key === 'personalize.agentName');
      expect(setting).toBeDefined();
      expect(setting!.defaultValue).toBe('Frankie');
    });

    it('should have personalize.personality as textarea', () => {
      const setting = SETTINGS_SCHEMA.find((s) => s.key === 'personalize.personality');
      expect(setting).toBeDefined();
      expect(setting!.type).toBe('textarea');
    });

    it('should have scheduler.enabled defaulting to true', () => {
      const setting = SETTINGS_SCHEMA.find((s) => s.key === 'scheduler.enabled');
      expect(setting).toBeDefined();
      expect(setting!.defaultValue).toBe('true');
    });

    it('should have browser.enabled defaulting to true', () => {
      const setting = SETTINGS_SCHEMA.find((s) => s.key === 'browser.enabled');
      expect(setting).toBeDefined();
      expect(setting!.defaultValue).toBe('true');
    });

    it('should have onboarding.completed setting', () => {
      const setting = SETTINGS_SCHEMA.find((s) => s.key === 'onboarding.completed');
      expect(setting).toBeDefined();
      expect(setting!.category).toBe('onboarding');
    });
  });

  describe('encryption patterns', () => {
    it('all password type fields should be encrypted', () => {
      const passwords = SETTINGS_SCHEMA.filter((s) => s.type === 'password');
      for (const setting of passwords) {
        expect(
          setting.encrypted,
          `Password setting "${setting.key}" should be encrypted`
        ).toBe(true);
      }
    });

    it('API key settings should be encrypted', () => {
      const apiKeys = SETTINGS_SCHEMA.filter(
        (s) => s.key.includes('apiKey') || s.key.includes('Token')
      );
      for (const setting of apiKeys) {
        if (setting.key === 'auth.tokenExpiresAt') continue; // This is a timestamp, not a secret
        expect(
          setting.encrypted,
          `Setting "${setting.key}" should be encrypted`
        ).toBe(true);
      }
    });
  });
});
