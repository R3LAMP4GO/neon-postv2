import { loadImage } from '@napi-rs/canvas';
import type { SKRSContext2D } from '@napi-rs/canvas';

// ---------------------------------------------------------------------------
// Branded divider — circuit trace pattern + centred Douro logo
// ---------------------------------------------------------------------------

/**
 * Draws a branded divider line across the canvas.
 *
 * Pattern: ────── DOURO DIGITAL ──────
 *
 * Text-only fallback: a horizontal line with the brand name centred.
 */
export function drawBrandedDivider(
  ctx: SKRSContext2D,
  canvasWidth: number,
  y: number,
  brandText: string,
  options: {
    lineColor?: string;
    textColor?: string;
    fontSize?: number;
    fontFamily?: string;
    lineWidth?: number;
    gap?: number;
    opacity?: number;
  } = {}
): void {
  const {
    lineColor = 'rgba(255,255,255,0.35)',
    textColor = 'rgba(255,255,255,0.6)',
    fontSize = 11,
    fontFamily = 'Space Grotesk',
    lineWidth = 1,
    gap = 12,
    opacity = 1,
  } = options;

  ctx.save();
  ctx.globalAlpha = opacity;

  // Measure text
  ctx.font = `600 ${fontSize}px ${fontFamily}`;
  const textWidth = ctx.measureText(brandText).width;
  const centerX = canvasWidth / 2;
  const textStartX = centerX - textWidth / 2;
  const textEndX = centerX + textWidth / 2;

  const lineMargin = 40;

  // Left line
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  ctx.moveTo(lineMargin, y);
  ctx.lineTo(textStartX - gap, y);
  ctx.stroke();

  // Right line
  ctx.beginPath();
  ctx.moveTo(textEndX + gap, y);
  ctx.lineTo(canvasWidth - lineMargin, y);
  ctx.stroke();

  // Brand text
  ctx.fillStyle = textColor;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(brandText, centerX, y);

  ctx.restore();
}

// ---------------------------------------------------------------------------
// Asset-based divider — circuit trace PNGs + centred Douro wordmark logo
// ---------------------------------------------------------------------------

export interface AssetDividerOptions {
  /** Path to the circuit trace fade image (solid end → transparent). */
  dividerImagePath: string;
  /** Path to the Douro wordmark logo (white on transparent). */
  logoPath: string;
  /** Height to render the logo at (default 80). */
  logoHeight?: number;
  /** Gap between logo edges and circuit trace images (default 16). */
  gap?: number;
  /** Horizontal margin from canvas edges (default 40). */
  margin?: number;
  /** Overall opacity (default 1). */
  opacity?: number;
}

/**
 * Draws a branded divider using actual image assets:
 *   [circuit-fade (mirrored)] ── [Douro logo] ── [circuit-fade]
 *
 * The divider-circuit-fade.png has the solid end on the LEFT and fades
 * to transparent on the RIGHT. The left trace is flipped horizontally
 * so the solid end faces the logo and the fade faces outward.
 */
export async function drawAssetDivider(
  ctx: SKRSContext2D,
  canvasWidth: number,
  y: number,
  options: AssetDividerOptions
): Promise<void> {
  const {
    dividerImagePath,
    logoPath,
    logoHeight = 80,
    gap = 16,
    margin = 40,
    opacity = 1,
  } = options;

  ctx.save();
  ctx.globalAlpha = opacity;

  // Load assets
  const [dividerImg, logoImg] = await Promise.all([
    loadImage(dividerImagePath),
    loadImage(logoPath),
  ]);

  // Scale logo to target height, preserve aspect ratio
  const logoScale = logoHeight / logoImg.height;
  const logoW = Math.round(logoImg.width * logoScale);
  const logoH = logoHeight;
  const logoX = (canvasWidth - logoW) / 2;
  const logoY = y - logoH / 2;

  // Draw centred logo
  ctx.drawImage(logoImg, logoX, logoY, logoW, logoH);

  // Circuit trace dimensions — fill available space on each side
  const traceAvailW = logoX - gap - margin;
  if (traceAvailW > 0) {
    const traceScale = Math.min(traceAvailW / dividerImg.width, 1);
    const traceW = dividerImg.width * traceScale;
    const traceH = dividerImg.height * traceScale;
    const traceY = y - traceH / 2;

    // LEFT trace — mirrored so solid end faces logo, fade faces left edge
    // The source image has solid on LEFT, fade on RIGHT.
    // We want: fade on LEFT, solid on RIGHT (facing logo).
    // So flip horizontally.
    ctx.save();
    const leftTraceX = logoX - gap - traceW;
    ctx.translate(leftTraceX + traceW, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(dividerImg, 0, traceY, traceW, traceH);
    ctx.restore();

    // RIGHT trace — solid end faces logo (natural orientation: solid LEFT)
    // But we need solid facing LEFT (towards logo). The image has solid on LEFT
    // which IS facing the logo when placed to the right. So NO flip needed.
    // Wait — the image solid is on LEFT. Placed to the right of the logo,
    // the LEFT side of this image faces the logo. So solid faces logo. Correct.
    const rightTraceX = logoX + logoW + gap;
    ctx.drawImage(dividerImg, rightTraceX, traceY, traceW, traceH);
  }

  ctx.restore();
}
