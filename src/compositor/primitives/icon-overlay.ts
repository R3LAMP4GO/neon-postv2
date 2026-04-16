import { loadImage } from '@napi-rs/canvas';
import type { SKRSContext2D } from '@napi-rs/canvas';

// ---------------------------------------------------------------------------
// Icon/logo overlay — large icon placed deliberately in the composition
// (separate from the watermark, which is small and in a corner)
// ---------------------------------------------------------------------------

export type IconPosition =
  | 'top-center'
  | 'top-left'
  | 'top-right'
  | 'center'
  | 'bottom-center';

/**
 * Draws a large icon/logo overlay on the canvas.
 *
 * Used for branding elements like the ChatGPT logo, Claude logo, etc.
 * that are part of the visual storytelling — not just a watermark.
 */
export async function drawIconOverlay(
  ctx: SKRSContext2D,
  canvasWidth: number,
  canvasHeight: number,
  iconPath: string,
  options: {
    position?: IconPosition;
    size?: number;
    opacity?: number;
    offsetX?: number;
    offsetY?: number;
  } = {}
): Promise<void> {
  const {
    position = 'top-center',
    size = 120,
    opacity = 0.9,
    offsetX = 0,
    offsetY = 0,
  } = options;

  const icon = await loadImage(iconPath);

  // Scale to fit within `size` while preserving aspect ratio
  const scale = Math.min(size / icon.width, size / icon.height);
  const drawW = Math.round(icon.width * scale);
  const drawH = Math.round(icon.height * scale);

  let x: number;
  let y: number;

  switch (position) {
    case 'top-center':
      x = (canvasWidth - drawW) / 2 + offsetX;
      y = 60 + offsetY;
      break;
    case 'top-left':
      x = 40 + offsetX;
      y = 60 + offsetY;
      break;
    case 'top-right':
      x = canvasWidth - drawW - 40 + offsetX;
      y = 60 + offsetY;
      break;
    case 'center':
      x = (canvasWidth - drawW) / 2 + offsetX;
      y = (canvasHeight - drawH) / 2 + offsetY;
      break;
    case 'bottom-center':
      x = (canvasWidth - drawW) / 2 + offsetX;
      y = canvasHeight - drawH - 60 + offsetY;
      break;
  }

  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.drawImage(icon, x, y, drawW, drawH);
  ctx.restore();
}
