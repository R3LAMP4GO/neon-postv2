import type { SKRSContext2D } from '@napi-rs/canvas';
import type { TemplateCtaConfig } from '../types';

// ---------------------------------------------------------------------------
// CTA badge rendering (e.g. "SWIPE FOR MORE")
// ---------------------------------------------------------------------------

/**
 * Draws a rounded-rectangle CTA badge on the canvas.
 */
export function drawCtaBadge(
  ctx: SKRSContext2D,
  canvasWidth: number,
  canvasHeight: number,
  config: TemplateCtaConfig
): void {
  const { text, position, backgroundColor, textColor, fontSize, borderRadius, paddingX, paddingY, margin } = config;

  ctx.save();
  ctx.font = `bold ${fontSize}px sans-serif`;

  const textMetrics = ctx.measureText(text);
  const textWidth = textMetrics.width;
  const textHeight = fontSize;

  const badgeWidth = textWidth + paddingX * 2;
  const badgeHeight = textHeight + paddingY * 2;

  // Position the badge
  let x: number;
  let y: number;

  switch (position) {
    case 'bottom-center':
      x = (canvasWidth - badgeWidth) / 2;
      y = canvasHeight - badgeHeight - margin;
      break;
    case 'bottom-right':
      x = canvasWidth - badgeWidth - margin;
      y = canvasHeight - badgeHeight - margin;
      break;
    case 'bottom-left':
      x = margin;
      y = canvasHeight - badgeHeight - margin;
      break;
  }

  // Draw rounded rectangle background
  ctx.fillStyle = backgroundColor;
  ctx.beginPath();
  ctx.roundRect(x, y, badgeWidth, badgeHeight, borderRadius);
  ctx.fill();

  // Draw text centered in the badge
  ctx.fillStyle = textColor;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + badgeWidth / 2, y + badgeHeight / 2);

  ctx.restore();
}
