import { createCanvas, loadImage } from '@napi-rs/canvas';

import type { TweetCardData } from './types';
import { wrapLines, drawCircularAvatar, formatMetric } from './helpers';

/**
 * Renders a tweet/X post card on a transparent canvas.
 * Returns a Buffer (PNG) that can be composited onto a template.
 */
export async function renderTweetCard(data: TweetCardData): Promise<Buffer> {
  const cardWidth = 520;
  const padding = 20;
  const avatarSize = 44;
  const contentLeft = padding + avatarSize + 12;
  const maxTextWidth = cardWidth - contentLeft - padding;
  const bodyFontSize = 15;
  const lineHeight = 22;
  const fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

  // Pre-measure to get card height
  const measureCanvas = createCanvas(cardWidth, 100);
  const measureCtx = measureCanvas.getContext('2d');
  measureCtx.font = `${bodyFontSize}px ${fontFamily}`;
  const bodyLines = wrapLines(measureCtx, data.body, maxTextWidth);

  const headerHeight = 48;
  const bodyHeight = bodyLines.length * lineHeight;
  const metricsHeight = data.likes !== undefined ? 36 : 0;
  const timestampHeight = data.timestamp ? 28 : 0;
  const cardHeight = padding + headerHeight + bodyHeight + metricsHeight + timestampHeight + padding;

  const canvas = createCanvas(cardWidth, cardHeight);
  const ctx = canvas.getContext('2d');

  // Card background
  ctx.fillStyle = '#16181c';
  ctx.beginPath();
  ctx.roundRect(0, 0, cardWidth, cardHeight, 16);
  ctx.fill();

  // Border
  ctx.strokeStyle = '#2f3336';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(0, 0, cardWidth, cardHeight, 16);
  ctx.stroke();

  let y = padding;

  // Avatar
  let avatarImg = null;
  if (data.avatarUrl) {
    try { avatarImg = await loadImage(data.avatarUrl); } catch { /* fallback */ }
  }
  drawCircularAvatar(ctx, avatarImg, padding, y, avatarSize, data.displayName[0]);

  // Display name
  ctx.fillStyle = '#e7e9ea';
  ctx.font = `bold 15px ${fontFamily}`;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillText(data.displayName, contentLeft, y + 4);

  // Verified badge
  if (data.verified) {
    const nameWidth = ctx.measureText(data.displayName).width;
    ctx.fillStyle = '#1d9bf0';
    ctx.beginPath();
    ctx.arc(contentLeft + nameWidth + 10, y + 12, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold 9px ${fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('✓', contentLeft + nameWidth + 10, y + 12);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
  }

  // Handle
  ctx.fillStyle = '#71767b';
  ctx.font = `14px ${fontFamily}`;
  ctx.fillText(`@${data.handle}`, contentLeft, y + 24);

  y += headerHeight;

  // Body text
  ctx.fillStyle = '#e7e9ea';
  ctx.font = `${bodyFontSize}px ${fontFamily}`;
  for (const line of bodyLines) {
    ctx.fillText(line, contentLeft, y);
    y += lineHeight;
  }

  // Metrics row
  if (data.likes !== undefined || data.retweets !== undefined || data.replies !== undefined) {
    y += 8;
    ctx.font = `13px ${fontFamily}`;
    let mx = contentLeft;

    if (data.replies !== undefined) {
      ctx.fillStyle = '#71767b';
      ctx.fillText(`💬 ${formatMetric(data.replies)}`, mx, y);
      mx += 80;
    }
    if (data.retweets !== undefined) {
      ctx.fillStyle = '#71767b';
      ctx.fillText(`🔁 ${formatMetric(data.retweets)}`, mx, y);
      mx += 80;
    }
    if (data.likes !== undefined) {
      ctx.fillStyle = '#71767b';
      ctx.fillText(`❤️ ${formatMetric(data.likes)}`, mx, y);
    }
  }

  // Timestamp
  if (data.timestamp) {
    y += 28;
    ctx.fillStyle = '#71767b';
    ctx.font = `13px ${fontFamily}`;
    ctx.fillText(data.timestamp, contentLeft, y);
  }

  return canvas.toBuffer('image/png');
}
