import { loadImage } from '@napi-rs/canvas';
import type { SKRSContext2D } from '@napi-rs/canvas';
import type { WatermarkPosition } from '../types';

// ---------------------------------------------------------------------------
// Watermark / logo rendering
// ---------------------------------------------------------------------------

/**
 * Draws a logo image onto the canvas at the specified position.
 *
 * The logo is scaled down to fit within `maxWidth × maxHeight` while
 * preserving aspect ratio.
 */
export async function drawLogoWatermark(
  ctx: SKRSContext2D,
  canvasWidth: number,
  canvasHeight: number,
  logoPath: string,
  position: WatermarkPosition,
  opacity: number,
  maxWidth: number,
  maxHeight: number,
  margin: number
): Promise<void> {
  const logo = await loadImage(logoPath);
  const { drawWidth, drawHeight } = fitWithinBounds(
    logo.width,
    logo.height,
    maxWidth,
    maxHeight
  );

  const { x, y } = computePosition(
    canvasWidth,
    canvasHeight,
    drawWidth,
    drawHeight,
    position,
    margin
  );

  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.drawImage(logo, x, y, drawWidth, drawHeight);
  ctx.restore();
}

/**
 * Draws a text-based watermark (e.g. "@wearedouro") on the canvas.
 */
export function drawTextWatermark(
  ctx: SKRSContext2D,
  canvasWidth: number,
  canvasHeight: number,
  text: string,
  position: WatermarkPosition,
  opacity: number,
  fontSize: number,
  margin: number,
  color: string = '#ffffff',
  fontFamily: string = 'Space Grotesk'
): void {
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.font = `bold ${fontSize}px ${fontFamily}`;
  ctx.fillStyle = color;

  const metrics = ctx.measureText(text);
  const textWidth = metrics.width;
  const textHeight = fontSize;

  const { x, y } = computePosition(
    canvasWidth,
    canvasHeight,
    textWidth,
    textHeight,
    position,
    margin
  );

  ctx.fillText(text, x, y + textHeight);
  ctx.restore();
}

/**
 * Draws a pill-shaped watermark — text inside a rounded capsule with a
 * coloured tint background and matching border. Centred at the bottom.
 *
 * Default style: Douro red text (#d42918) in a dark capsule with a
 * subtle red-tinted background and red border.
 */
export function drawPillWatermark(
  ctx: SKRSContext2D,
  canvasWidth: number,
  canvasHeight: number,
  text: string,
  options: {
    fontSize?: number;
    fontFamily?: string;
    textColor?: string;
    bgColor?: string;
    borderColor?: string;
    borderWidth?: number;
    paddingX?: number;
    paddingY?: number;
    marginBottom?: number;
    opacity?: number;
  } = {}
): void {
  const {
    fontSize = 16,
    fontFamily = 'Space Grotesk',
    textColor = '#d42918',
    bgColor = 'rgba(212, 41, 24, 0.08)',
    borderColor = 'rgba(212, 41, 24, 0.35)',
    borderWidth = 1.5,
    paddingX = 24,
    paddingY = 10,
    marginBottom = 32,
    opacity = 1,
  } = options;

  ctx.save();
  ctx.globalAlpha = opacity;

  ctx.font = `bold ${fontSize}px ${fontFamily}`;
  const metrics = ctx.measureText(text);
  const textW = metrics.width;
  const textH = fontSize;

  const pillW = textW + paddingX * 2;
  const pillH = textH + paddingY * 2;
  const pillX = (canvasWidth - pillW) / 2;
  const pillY = canvasHeight - pillH - marginBottom;
  const radius = pillH / 2;

  // Pill background
  ctx.fillStyle = bgColor;
  ctx.beginPath();
  ctx.roundRect(pillX, pillY, pillW, pillH, radius);
  ctx.fill();

  // Pill border
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = borderWidth;
  ctx.beginPath();
  ctx.roundRect(pillX, pillY, pillW, pillH, radius);
  ctx.stroke();

  // Text centred inside
  ctx.fillStyle = textColor;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvasWidth / 2, pillY + pillH / 2);

  ctx.restore();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fitWithinBounds(
  srcWidth: number,
  srcHeight: number,
  maxWidth: number,
  maxHeight: number
): { drawWidth: number; drawHeight: number } {
  const scale = Math.min(maxWidth / srcWidth, maxHeight / srcHeight, 1);
  return {
    drawWidth: Math.round(srcWidth * scale),
    drawHeight: Math.round(srcHeight * scale),
  };
}

function computePosition(
  canvasWidth: number,
  canvasHeight: number,
  elementWidth: number,
  elementHeight: number,
  position: WatermarkPosition,
  margin: number
): { x: number; y: number } {
  switch (position) {
    case 'bottom-right':
      return {
        x: canvasWidth - elementWidth - margin,
        y: canvasHeight - elementHeight - margin,
      };
    case 'bottom-left':
      return { x: margin, y: canvasHeight - elementHeight - margin };
    case 'top-right':
      return { x: canvasWidth - elementWidth - margin, y: margin };
    case 'top-left':
      return { x: margin, y: margin };
    case 'bottom-center':
      return {
        x: (canvasWidth - elementWidth) / 2,
        y: canvasHeight - elementHeight - margin,
      };
  }
}
