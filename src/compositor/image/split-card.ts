import { createCanvas, loadImage } from '@napi-rs/canvas';

import { CANVAS_DIMENSIONS } from '../types';
import type { RenderInput, RenderResult } from '../types';
import { drawLogoWatermark, drawTextWatermark } from '../primitives/watermark';
import { parseRichHeadline, drawRichHeadline } from '../primitives/rich-text';

/**
 * Split-card layout — left panel (solid dark + text), right panel (image).
 * Red accent stripe at the split edge.
 */
export async function renderSplitCard(input: RenderInput): Promise<RenderResult> {
  const { headline, background, template, logoPath, brandHandle } = input;
  const dims = CANVAS_DIMENSIONS[template.format];
  const canvas = createCanvas(dims.width, dims.height);
  const ctx = canvas.getContext('2d');

  const splitX = Math.round(dims.width * 0.48);

  // Right panel — image
  const img = await loadImage(background);
  const panelW = dims.width - splitX;
  const scale = Math.max(panelW / img.width, dims.height / img.height);
  const scaledW = img.width * scale;
  const scaledH = img.height * scale;
  const imgX = splitX + (panelW - scaledW) / 2;
  const imgY = (dims.height - scaledH) / 2;

  ctx.save();
  ctx.beginPath();
  ctx.rect(splitX, 0, panelW, dims.height);
  ctx.clip();
  ctx.drawImage(img, imgX, imgY, scaledW, scaledH);
  ctx.restore();

  // Left panel — solid dark background
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(0, 0, splitX, dims.height);

  // Accent stripe along the split edge
  ctx.fillStyle = '#d42918';
  ctx.fillRect(splitX - 3, 0, 3, dims.height);

  // Rich text on the left panel (white + Douro red accent)
  const t = template.text;
  const runs = parseRichHeadline(
    t.uppercase ? headline.toUpperCase() : headline,
    t.color,
    '#d42918'
  );

  const leftPadding = 48;
  drawRichHeadline(ctx, splitX, dims.height, runs, {
    fontSize: t.fontSize,
    fontWeight: t.fontWeight,
    fontFamily: t.fontFamily,
    lineHeight: t.lineHeight,
    paddingX: leftPadding,
    position: 'center',
    offsetY: 0,
    uppercase: false,
    strokeWidth: 0,
    strokeColor: '#000000',
    align: 'left',
  });

  // Watermark
  if (template.watermark.enabled) {
    if (logoPath) {
      await drawLogoWatermark(
        ctx, dims.width, dims.height, logoPath,
        template.watermark.position, template.watermark.opacity,
        template.watermark.maxWidth, template.watermark.maxHeight,
        template.watermark.margin
      );
    } else if (brandHandle) {
      drawTextWatermark(
        ctx, dims.width, dims.height, brandHandle,
        template.watermark.position, template.watermark.opacity,
        18, template.watermark.margin
      );
    }
  }

  const buffer = canvas.toBuffer('image/png');
  return { buffer, mimeType: 'image/png', width: dims.width, height: dims.height };
}
