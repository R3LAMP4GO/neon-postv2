import { loadImage } from '@napi-rs/canvas';
import type { SKRSContext2D, Canvas } from '@napi-rs/canvas';

// ---------------------------------------------------------------------------
// Background — cover-fit (source-crop approach for correct aspect ratio)
// ---------------------------------------------------------------------------

/**
 * Computes the source crop region for cover-fit scaling.
 * Crops from the centre of the source image so it fills `dstW × dstH`
 * without distortion.
 */
export function coverFitCrop(
  srcW: number, srcH: number, dstW: number, dstH: number, topAlign = false
): { sx: number; sy: number; sw: number; sh: number } {
  const srcAspect = srcW / srcH;
  const dstAspect = dstW / dstH;

  let sx: number, sy: number, sw: number, sh: number;

  if (srcAspect > dstAspect) {
    // Source is wider — crop left/right, keep full height
    sh = srcH;
    sw = srcH * dstAspect;
    sx = (srcW - sw) / 2;
    sy = 0;
  } else {
    // Source is taller — crop top/bottom
    sw = srcW;
    sh = srcW / dstAspect;
    sx = 0;
    sy = topAlign ? 0 : (srcH - sh) / 2;
  }

  return { sx, sy, sw, sh };
}

export async function drawBackground(
  ctx: SKRSContext2D,
  canvas: Canvas,
  source: string | Buffer
): Promise<void> {
  const img = await loadImage(source);
  const { sx, sy, sw, sh } = coverFitCrop(img.width, img.height, canvas.width, canvas.height);
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
}

/**
 * Draws a background image cover-fit into the top portion of the canvas.
 * The image is top-aligned (subject matter stays visible at top) and cropped
 * from the bottom if the source is taller than the target region.
 */
export async function drawBgTopAligned(
  ctx: SKRSContext2D,
  source: string | Buffer,
  dstW: number,
  dstH: number
): Promise<void> {
  const img = await loadImage(source);
  const { sx, sy, sw, sh } = coverFitCrop(img.width, img.height, dstW, dstH, true);
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, dstW, dstH);
}
