import type { SKRSContext2D } from '@napi-rs/canvas';

// ---------------------------------------------------------------------------
// Background overlays
// ---------------------------------------------------------------------------

/**
 * Draws a solid colour overlay on top of the current canvas content.
 * Typically used to darken a background image so white text is legible.
 */
export function drawOverlay(
  ctx: SKRSContext2D,
  width: number,
  height: number,
  color: string,
  opacity: number
): void {
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

/**
 * Draws a vertical gradient overlay (e.g. transparent at top, dark at bottom).
 * Useful for bottom-anchored text layouts.
 */
export function drawGradientOverlay(
  ctx: SKRSContext2D,
  width: number,
  height: number,
  colorStop: string,
  opacity: number
): void {
  ctx.save();
  ctx.globalAlpha = opacity;

  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, 'transparent');
  gradient.addColorStop(0.5, 'transparent');
  gradient.addColorStop(1, colorStop);

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}
