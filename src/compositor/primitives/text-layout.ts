import type { SKRSContext2D } from '@napi-rs/canvas';

// ---------------------------------------------------------------------------
// Pixel-width text wrapping
// ---------------------------------------------------------------------------

/**
 * Wraps text into lines that fit within `maxWidth` pixels.
 *
 * Uses `ctx.measureText()` for pixel-accurate measurement — not character
 * count, which is unreliable with proportional fonts.
 *
 * Adapted from the MoneyPrinterTurbo wrap_text algorithm (MIT).
 */
export function wrapText(
  ctx: SKRSContext2D,
  text: string,
  maxWidth: number
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const lines: string[] = [];
  let currentLine = words[0];

  for (let i = 1; i < words.length; i++) {
    const testLine = `${currentLine} ${words[i]}`;
    const { width } = ctx.measureText(testLine);

    if (width > maxWidth) {
      lines.push(currentLine);
      currentLine = words[i];
    } else {
      currentLine = testLine;
    }
  }
  lines.push(currentLine);

  return lines;
}

// ---------------------------------------------------------------------------
// Text block measurement
// ---------------------------------------------------------------------------

export interface TextBlockMetrics {
  /** Each wrapped line. */
  lines: string[];
  /** Width of the widest line in px. */
  maxLineWidth: number;
  /** Total height of the text block in px. */
  totalHeight: number;
  /** Computed line height in px. */
  lineHeightPx: number;
}

/**
 * Measures a text block after wrapping.
 *
 * @param ctx        Canvas 2D context (font must already be set).
 * @param text       The raw headline string.
 * @param maxWidth   Maximum pixel width for wrapping.
 * @param fontSize   Font size in px (used with lineHeight multiplier).
 * @param lineHeight Line height multiplier (e.g. 1.2).
 */
export function measureTextBlock(
  ctx: SKRSContext2D,
  text: string,
  maxWidth: number,
  fontSize: number,
  lineHeight: number
): TextBlockMetrics {
  const lines = wrapText(ctx, text, maxWidth);
  const lineHeightPx = fontSize * lineHeight;

  let maxLineWidth = 0;
  for (const line of lines) {
    const w = ctx.measureText(line).width;
    if (w > maxLineWidth) maxLineWidth = w;
  }

  const totalHeight = lines.length * lineHeightPx;

  return { lines, maxLineWidth, totalHeight, lineHeightPx };
}

// ---------------------------------------------------------------------------
// Vertical position calculation
// ---------------------------------------------------------------------------

export type Anchor = 'center' | 'top' | 'bottom';

/**
 * Returns the Y coordinate for the first line of a text block
 * given the anchor position and canvas height.
 */
export function computeStartY(
  anchor: Anchor,
  canvasHeight: number,
  totalTextHeight: number,
  offsetY: number
): number {
  switch (anchor) {
    case 'center':
      return (canvasHeight - totalTextHeight) / 2 + offsetY;
    case 'top':
      return offsetY;
    case 'bottom':
      return canvasHeight - totalTextHeight - offsetY;
  }
}
