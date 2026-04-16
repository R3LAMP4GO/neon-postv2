import { createCanvas } from '@napi-rs/canvas';
import path from 'path';

import { CANVAS_DIMENSIONS } from '../types';
import type { RenderResult, TemplateDefinition } from '../types';
import { drawPillWatermark } from '../primitives/watermark';
import { parseRichHeadline, drawRichHeadline } from '../primitives/rich-text';
import { drawAssetDivider } from '../primitives/divider';

/**
 * Renders the branded video overlay frame as a transparent PNG.
 *
 * This produces the bottom-bar template (divider + text + watermark + stripe)
 * with the top half transparent — ready to be composited onto video frames
 * via FFmpeg.
 *
 * The top portion is fully transparent so the source video shows through.
 */
export async function renderVideoFrame(options: {
  headline: string;
  template: TemplateDefinition;
  brandHandle?: string;
}): Promise<RenderResult> {
  const { headline, template, brandHandle } = options;
  const dims = CANVAS_DIMENSIONS[template.format];
  const canvas = createCanvas(dims.width, dims.height);
  const ctx = canvas.getContext('2d');

  // Canvas starts fully transparent (PNG)

  // Layout split
  const splitRatio = 0.50;
  const splitY = Math.round(dims.height * splitRatio);
  const barHeight = dims.height - splitY;

  // Dark opaque bar covering bottom text zone
  ctx.fillStyle = 'rgba(0, 0, 0, 0.92)';
  ctx.fillRect(0, splitY, dims.width, barHeight);

  // Gradient bleed above the bar
  const bleedHeight = 80;
  const gradient = ctx.createLinearGradient(0, splitY - bleedHeight, 0, splitY);
  gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0.92)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, splitY - bleedHeight, dims.width, bleedHeight);

  // Circuit trace divider + Douro logo
  const assetsDir = path.resolve(process.cwd(), 'assets');
  await drawAssetDivider(ctx, dims.width, splitY, {
    dividerImagePath: path.join(assetsDir, 'divider-circuit-fade.png'),
    logoPath: path.join(assetsDir, 'logos', 'douro-digital-logo-white.png'),
    logoHeight: 80,
    gap: 16,
    margin: 40,
  });

  // Rich text headline
  const t = template.text;
  const runs = parseRichHeadline(
    t.uppercase ? headline.toUpperCase() : headline,
    t.color,
    '#d42918'
  );

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

  // Pill watermark
  if (brandHandle) {
    drawPillWatermark(ctx, dims.width, dims.height, brandHandle, {
      fontSize: 16,
      textColor: '#d42918',
      marginBottom: 24,
    });
  }

  // 3px red accent stripe at bottom
  ctx.fillStyle = '#d42918';
  ctx.fillRect(0, dims.height - 3, dims.width, 3);

  const buffer = canvas.toBuffer('image/png');
  return { buffer, mimeType: 'image/png', width: dims.width, height: dims.height };
}
