import { GlobalFonts } from '@napi-rs/canvas';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { TemplateDefinition } from '../compositor/types';

// ---------------------------------------------------------------------------
// Template registry — loaded from JSON at runtime to avoid
// ERR_IMPORT_ATTRIBUTE_MISSING in Node 22+ / Electron 40+
// ---------------------------------------------------------------------------

function loadPreset(name: string): TemplateDefinition {
  // Resolve relative to this file's directory (works in both dev and packaged)
  const thisDir = path.dirname(fileURLToPath(import.meta.url));
  const filePath = path.join(thisDir, 'presets', `${name}.json`);
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as TemplateDefinition;
}

let _presets: Map<string, TemplateDefinition> | null = null;

function getPresets(): Map<string, TemplateDefinition> {
  if (!_presets) {
    _presets = new Map([
      ['headline-center', loadPreset('headline-center')],
      ['headline-bottom', loadPreset('headline-bottom')],
      ['split-card', loadPreset('split-card')],
      ['carousel-slide', loadPreset('carousel-slide')],
      ['bottom-bar', loadPreset('bottom-bar')],
      ['social-embed', loadPreset('social-embed')],
    ]);
  }
  return _presets;
}

export function getTemplate(id: string): TemplateDefinition | null {
  return getPresets().get(id) ?? null;
}

export function listTemplates(): TemplateDefinition[] {
  return [...getPresets().values()];
}

export function listTemplateIds(): string[] {
  return [...getPresets().keys()];
}

// ---------------------------------------------------------------------------
// Font registration
// ---------------------------------------------------------------------------

let fontsRegistered = false;

/**
 * Registers the Douro brand fonts with the canvas runtime.
 * Safe to call multiple times — only registers once.
 */
export function registerFonts(assetsDir?: string): void {
  if (fontsRegistered) return;

  // Default: <project-root>/assets/fonts
  const fontsDir = assetsDir
    ? path.join(assetsDir, 'fonts')
    : path.resolve(process.cwd(), 'assets', 'fonts');

  const fonts = [
    { file: 'space-grotesk.woff2', family: 'Space Grotesk' },
    { file: 'press-start-2p.woff2', family: 'Press Start 2P' },
    { file: 'fragment-mono.woff2', family: 'Fragment Mono' },
    { file: 'instrument-serif.woff2', family: 'Instrument Serif' },
    { file: 'instrument-serif-italic.woff2', family: 'Instrument Serif Italic' },
    { file: 'Anton-Regular.ttf', family: 'Anton' },
    { file: 'BebasNeue-Regular.ttf', family: 'Bebas Neue' },
  ];

  for (const { file, family } of fonts) {
    const fontPath = path.join(fontsDir, file);
    try {
      GlobalFonts.registerFromPath(fontPath, family);
    } catch {
      console.warn(`[templates] Failed to register font: ${fontPath}`);
    }
  }

  fontsRegistered = true;
}

// ---------------------------------------------------------------------------
// Logo paths helper
// ---------------------------------------------------------------------------

export function getLogoPath(
  variant: 'icon' | 'wordmark' | 'wordmark-dark' | 'wordmark-white' | 'wordmark-red',
  assetsDir?: string
): string {
  const logosDir = assetsDir
    ? path.join(assetsDir, 'logos')
    : path.resolve(process.cwd(), 'assets', 'logos');

  switch (variant) {
    case 'icon':
      return path.join(logosDir, 'douro-logo.png');
    case 'wordmark':
      return path.join(logosDir, 'douro-digital-logo.png');
    case 'wordmark-dark':
      return path.join(logosDir, 'douro-wordmark.jpeg');
    case 'wordmark-white':
      return path.join(logosDir, 'douro-digital-logo-white.png');
    case 'wordmark-red':
      return path.join(logosDir, 'douro-digital-logo-red.png');
  }
}

// ---------------------------------------------------------------------------
// Divider asset paths
// ---------------------------------------------------------------------------

export function getDividerPath(
  variant: 'circuit-fade' | 'circuit-line',
  assetsDir?: string
): string {
  const baseDir = assetsDir ?? path.resolve(process.cwd(), 'assets');

  switch (variant) {
    case 'circuit-fade':
      return path.join(baseDir, 'divider-circuit-fade.png');
    case 'circuit-line':
      return path.join(baseDir, 'divider-circuit-line.png');
  }
}
