import { createCanvas } from '@napi-rs/canvas';
import path from 'path';

import { CANVAS_DIMENSIONS } from '../types';
import type { RenderInput, RenderResult } from '../types';
import { drawPillWatermark } from '../primitives/watermark';
import { parseRichHeadline, drawRichHeadline } from '../primitives/rich-text';
import { drawAssetDivider } from '../primitives/divider';
import { drawBgTopAligned } from './background';

/**
 * Bottom-bar layout — Douro Digital branded design.
 *
 * Layout: image top ~50%, divider at boundary, text bottom ~50%
 *   - Background top-aligned (subject matter visible, cropped from bottom)
 *   - Dark opaque bar (0.92) covers bottom text zone
 *   - Gradient bleed above bar for smooth transition
 *   - Circuit trace divider with centred Douro wordmark at boundary
 *   - Rich text: Anton font, white + Douro red accent ({brace} markup)
 *   - Pill-shaped watermark centred at bottom
 *   - 3px red accent stripe at very bottom
 */
export async function renderBottomBar(input: RenderInput): Promise<RenderResult> {
  const { headline, background, template, brandHandle } = input;
  const dims = CANVAS_DIMENSIONS[template.format];
  const canvas = createCanvas(dims.width, dims.height);
  const ctx = canvas.getContext('2d');

  // Layout split — image top ~50%, text bottom ~50%
  const splitRatio = 0.50;
  const splitY = Math.round(dims.height * splitRatio);
  const barHeight = dims.height - splitY;

  // 1 — Black fill (base)
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, dims.width, dims.height);

  // 2 — Background image in top zone (top-aligned cover-fit)
  await drawBgTopAligned(ctx, background, dims.width, splitY);

  // 3 — Gradient bleed above the bar for smooth image → bar transition
  const bleedHeight = 80;
  const gradient = ctx.createLinearGradient(0, splitY - bleedHeight, 0, splitY);
  gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0.92)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, splitY - bleedHeight, dims.width, bleedHeight);

  // 4 — Dark opaque bar covering bottom text zone
  ctx.fillStyle = 'rgba(0, 0, 0, 0.92)';
  ctx.fillRect(0, splitY, dims.width, barHeight);

  // 5 — Circuit trace divider + Douro logo at the split boundary
  const assetsDir = path.resolve(process.cwd(), 'assets');
  const dividerImagePath = path.join(assetsDir, 'divider-circuit-fade.png');
  const dividerLogoPath = path.join(assetsDir, 'logos', 'douro-digital-logo-white.png');

  await drawAssetDivider(ctx, dims.width, splitY, {
    dividerImagePath,
    logoPath: dividerLogoPath,
    logoHeight: 80,
    gap: 16,
    margin: 40,
  });

  // 6 — Rich text headline (Anton, white + Douro red for {brace} markup)
  const t = template.text;
  const runs = parseRichHeadline(
    t.uppercase ? headline.toUpperCase() : headline,
    t.color,
    '#d42918'
  );

  // Text zone: from below divider to above watermark area
  const textZoneTop = splitY + 60;
  const textZoneBottom = dims.height - 80;
  const textZoneHeight = textZoneBottom - textZoneTop;

  drawRichHeadline(ctx, dims.width, textZoneHeight, runs, {
    fontSize: t.fontSize,
    fontWeight: t.fontWeight,
    fontFamily: t.fontFamily,
    lineHeight: t.lineHeight,
    paddingX: t.paddingX,
    position: 'center',
    offsetY: textZoneTop,
    uppercase: false,
    strokeWidth: 0,
    strokeColor: '#000000',
    align: 'center',
  });

  // 7 — Pill-shaped watermark at bottom centre
  if (brandHandle) {
    drawPillWatermark(ctx, dims.width, dims.height, brandHandle, {
      fontSize: 16,
      textColor: '#d42918',
      marginBottom: 24,
    });
  }

  // 8 — 3px red accent stripe at the very bottom
  ctx.fillStyle = '#d42918';
  ctx.fillRect(0, dims.height - 3, dims.width, 3);

  // 9 — Export
  const buffer = canvas.toBuffer('image/png');
  return { buffer, mimeType: 'image/png', width: dims.width, height: dims.height };
}
