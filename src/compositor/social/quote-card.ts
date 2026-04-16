import { createCanvas } from '@napi-rs/canvas';

import type { QuoteCardData } from './types';
import { wrapLines } from './helpers';

/**
 * Renders a minimal quote card — large quote mark, body text, attribution.
 * Dark background, elegant serif feel.
 */
export async function renderQuoteCard(data: QuoteCardData): Promise<Buffer> {
  const cardWidth = 520;
  const padding = 32;
  const maxTextWidth = cardWidth - padding * 2;
  const bodyFontSize = 18;
  const lineHeight = 28;
  const fontFamily = 'sans-serif';

  // Pre-measure
  const measureCanvas = createCanvas(cardWidth, 100);
  const measureCtx = measureCanvas.getContext('2d');
  measureCtx.font = `italic ${bodyFontSize}px ${fontFamily}`;
  const bodyLines = wrapLines(measureCtx, data.quote, maxTextWidth);

  const quoteMarkHeight = 50;
  const bodyHeight = bodyLines.length * lineHeight;
  const authorHeight = 40;
  const cardHeight = padding + quoteMarkHeight + bodyHeight + authorHeight + padding;

  const canvas = createCanvas(cardWidth, cardHeight);
  const ctx = canvas.getContext('2d');

  // Card background
  ctx.fillStyle = '#1a1a1a';
  ctx.beginPath();
  ctx.roundRect(0, 0, cardWidth, cardHeight, 16);
  ctx.fill();

  // Border
  ctx.strokeStyle = '#333333';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(0, 0, cardWidth, cardHeight, 16);
  ctx.stroke();

  // Left accent bar
  ctx.fillStyle = '#d42918';
  ctx.fillRect(0, 20, 4, cardHeight - 40);

  let y = padding;

  // Large quote mark
  ctx.fillStyle = 'rgba(212, 41, 24, 0.4)';
  ctx.font = `bold 72px Georgia, serif`;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillText('\u201C', padding, y - 10);
  y += quoteMarkHeight;

  // Body text (italic)
  ctx.fillStyle = '#e0e0e0';
  ctx.font = `italic ${bodyFontSize}px ${fontFamily}`;
  for (const line of bodyLines) {
    ctx.fillText(line, padding + 8, y);
    y += lineHeight;
  }

  y += 12;

  // Author line
  ctx.fillStyle = '#d42918';
  ctx.font = `bold 14px ${fontFamily}`;
  ctx.fillText(`— ${data.author}`, padding + 8, y);

  if (data.role) {
    const nameWidth = ctx.measureText(`— ${data.author}`).width;
    ctx.fillStyle = '#71767b';
    ctx.font = `13px ${fontFamily}`;
    ctx.fillText(`  ${data.role}`, padding + 8 + nameWidth, y);
  }

  return canvas.toBuffer('image/png');
}
