import { createCanvas } from '@napi-rs/canvas';

import { CANVAS_DIMENSIONS } from '../types';
import type { RenderInput, RenderResult } from '../types';
import { drawOverlay, drawGradientOverlay } from '../primitives/overlay';
import { drawLogoWatermark, drawTextWatermark } from '../primitives/watermark';
import { drawCtaBadge } from '../primitives/cta-badge';
import { parseRichHeadline, drawRichHeadline } from '../primitives/rich-text';
import { drawBackground } from './background';

/**
 * Renders a single post image.
 *
 * Pipeline:
 *   1. Create canvas at template dimensions
 *   2. Draw & scale background image (cover-fit)
 *   3. Apply overlay
 *   4. Draw rich headline text (white + accent)
 *   5. Draw CTA badge
 *   6. Draw watermark (logo or text)
 *   7. Export buffer
 */
export async function renderPost(input: RenderInput): Promise<RenderResult> {
  const { headline, background, template, logoPath, ctaText, brandHandle } = input;
  const dims = CANVAS_DIMENSIONS[template.format];
  const canvas = createCanvas(dims.width, dims.height);
  const ctx = canvas.getContext('2d');

  // 1 — Background
  await drawBackground(ctx, canvas, background);

  // 2 — Overlay
  if (template.overlay.enabled) {
    if (template.text.position === 'bottom') {
      drawGradientOverlay(ctx, dims.width, dims.height, template.overlay.color, template.overlay.opacity);
    } else {
      drawOverlay(ctx, dims.width, dims.height, template.overlay.color, template.overlay.opacity);
    }
  }

  // 3 — Rich headline text (white + Douro red accent for {brace} markup)
  const t = template.text;
  const runs = parseRichHeadline(
    t.uppercase ? headline.toUpperCase() : headline,
    t.color,
    '#d42918'
  );
  drawRichHeadline(ctx, dims.width, dims.height, runs, {
    fontSize: t.fontSize,
    fontWeight: t.fontWeight,
    fontFamily: t.fontFamily,
    lineHeight: t.lineHeight,
    paddingX: t.paddingX,
    position: t.position,
    offsetY: t.offsetY,
    uppercase: false,
    strokeWidth: t.strokeWidth,
    strokeColor: t.strokeColor,
    align: 'center',
  });

  // 4 — CTA badge
  if (template.cta.enabled) {
    const ctaConfig = ctaText
      ? { ...template.cta, text: ctaText }
      : template.cta;
    drawCtaBadge(ctx, dims.width, dims.height, ctaConfig);
  }

  // 5 — Watermark
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

  // 6 — Export
  const buffer = canvas.toBuffer('image/png');
  return { buffer, mimeType: 'image/png', width: dims.width, height: dims.height };
}
