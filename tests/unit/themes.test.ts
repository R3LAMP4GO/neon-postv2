/**
 * Unit tests for theme definitions
 *
 * Verifies THEMES object structure, required properties, and palette completeness.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import { THEMES, type ThemeDefinition, type ThemePalette } from '../../src/settings/themes';

const REQUIRED_PALETTE_KEYS: (keyof ThemePalette)[] = [
  'bg-primary',
  'bg-secondary',
  'bg-tertiary',
  'border',
  'text-primary',
  'text-secondary',
  'text-muted',
  'accent',
  'accent-secondary',
  'accent-hover',
  'error',
  'success',
  'warning',
  'orange',
  'user-bubble',
  'user-bubble-solid',
  'assistant-bubble',
];

describe('Themes', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('THEMES object', () => {
    it('should be a non-empty object', () => {
      expect(typeof THEMES).toBe('object');
      expect(Object.keys(THEMES).length).toBeGreaterThan(0);
    });

    it('should contain default theme', () => {
      expect(THEMES).toHaveProperty('default');
    });

    it('should contain light theme', () => {
      expect(THEMES).toHaveProperty('light');
    });

    it('should contain emerald theme', () => {
      expect(THEMES).toHaveProperty('emerald');
    });

    it('should contain sandstone theme', () => {
      expect(THEMES).toHaveProperty('sandstone');
    });

    it('should contain ocean theme', () => {
      expect(THEMES).toHaveProperty('ocean');
    });

    it('should contain rose theme', () => {
      expect(THEMES).toHaveProperty('rose');
    });

    it('should contain nord theme', () => {
      expect(THEMES).toHaveProperty('nord');
    });

    it('should contain cyberpunk theme', () => {
      expect(THEMES).toHaveProperty('cyberpunk');
    });

    it('should contain tavern theme', () => {
      expect(THEMES).toHaveProperty('tavern');
    });
  });

  describe('theme structure', () => {
    it('every theme should have id, name, and palette properties', () => {
      for (const [key, theme] of Object.entries(THEMES)) {
        expect(theme).toHaveProperty('id');
        expect(theme).toHaveProperty('name');
        expect(theme).toHaveProperty('palette');
        // id should match the key
        expect(theme.id).toBe(key);
      }
    });

    it('every theme should have a non-empty name', () => {
      for (const theme of Object.values(THEMES)) {
        expect(typeof theme.name).toBe('string');
        expect(theme.name.length).toBeGreaterThan(0);
      }
    });

    it('every theme should have a non-empty id', () => {
      for (const theme of Object.values(THEMES)) {
        expect(typeof theme.id).toBe('string');
        expect(theme.id.length).toBeGreaterThan(0);
      }
    });
  });

  describe('default theme', () => {
    it('should have null palette (no overrides)', () => {
      expect(THEMES.default.palette).toBeNull();
    });

    it('should have id "default"', () => {
      expect(THEMES.default.id).toBe('default');
    });

    it('should have name "Default"', () => {
      expect(THEMES.default.name).toBe('Default');
    });
  });

  describe('non-default themes', () => {
    const nonDefaultThemes = Object.entries(THEMES).filter(([key]) => key !== 'default');

    it('should all have non-null palettes', () => {
      for (const [key, theme] of nonDefaultThemes) {
        expect(theme.palette).not.toBeNull();
        expect(typeof theme.palette).toBe('object');
      }
    });

    it('should all have all required palette keys', () => {
      for (const [key, theme] of nonDefaultThemes) {
        for (const paletteKey of REQUIRED_PALETTE_KEYS) {
          expect(
            theme.palette,
            `Theme "${key}" missing palette key "${paletteKey}"`
          ).toHaveProperty(paletteKey);
        }
      }
    });

    it('should have non-empty string values for all palette properties', () => {
      for (const [key, theme] of nonDefaultThemes) {
        const palette = theme.palette!;
        for (const paletteKey of REQUIRED_PALETTE_KEYS) {
          const value = palette[paletteKey];
          expect(typeof value).toBe('string');
          expect(value.length, `Theme "${key}" has empty value for "${paletteKey}"`).toBeGreaterThan(
            0
          );
        }
      }
    });

    it('should have color values that look like CSS colors or gradients', () => {
      for (const [key, theme] of nonDefaultThemes) {
        const palette = theme.palette!;
        for (const paletteKey of REQUIRED_PALETTE_KEYS) {
          const value = palette[paletteKey];
          // Should start with # (hex), rgb, hsl, or linear-gradient
          expect(
            value.startsWith('#') ||
              value.startsWith('rgb') ||
              value.startsWith('hsl') ||
              value.startsWith('linear-gradient'),
            `Theme "${key}" property "${paletteKey}" has unexpected format: "${value}"`
          ).toBe(true);
        }
      }
    });

    it('should have user-bubble as a gradient for all themes', () => {
      for (const [key, theme] of nonDefaultThemes) {
        expect(
          theme.palette!['user-bubble'].startsWith('linear-gradient'),
          `Theme "${key}" user-bubble should be a gradient`
        ).toBe(true);
      }
    });

    it('should have user-bubble-solid as a hex color for all themes', () => {
      for (const [key, theme] of nonDefaultThemes) {
        expect(
          theme.palette!['user-bubble-solid'].startsWith('#'),
          `Theme "${key}" user-bubble-solid should be a hex color`
        ).toBe(true);
      }
    });
  });
});
