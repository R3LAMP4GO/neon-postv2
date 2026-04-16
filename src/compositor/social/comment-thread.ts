import { createCanvas, loadImage } from '@napi-rs/canvas';
import type { Image } from '@napi-rs/canvas';

import type { CommentCardData } from './types';
import { wrapLines, drawCircularAvatar } from './helpers';

/**
 * Renders a nested comment/reply card — stacked conversation view
 * with thread lines connecting avatars.
 */
export async function renderCommentThread(
  comments: CommentCardData[]
): Promise<Buffer> {
  const cardWidth = 520;
  const padding = 20;
  const avatarSize = 36;
  const contentLeft = padding + avatarSize + 10;
  const maxTextWidth = cardWidth - contentLeft - padding;
  const bodyFontSize = 14;
  const lineHeight = 20;
  const fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

  // Pre-measure all comments
  const measureCanvas = createCanvas(cardWidth, 100);
  const measureCtx = measureCanvas.getContext('2d');
  measureCtx.font = `${bodyFontSize}px ${fontFamily}`;

  interface MeasuredComment {
    data: CommentCardData;
    lines: string[];
    height: number;
    avatarImg: Image | null;
  }

  const measured: MeasuredComment[] = [];
  for (const c of comments) {
    const lines = wrapLines(measureCtx, c.body, maxTextWidth);
    const commentHeight = 28 + lines.length * lineHeight + 16;
    let avatarImg: Image | null = null;
    if (c.avatarUrl) {
      try { avatarImg = await loadImage(c.avatarUrl); } catch { /* */ }
    }
    measured.push({ data: c, lines, height: commentHeight, avatarImg });
  }

  const totalHeight = padding + measured.reduce((sum, m) => sum + m.height, 0) + padding;

  const canvas = createCanvas(cardWidth, totalHeight);
  const ctx = canvas.getContext('2d');

  // Card background
  ctx.fillStyle = '#16181c';
  ctx.beginPath();
  ctx.roundRect(0, 0, cardWidth, totalHeight, 16);
  ctx.fill();

  // Border
  ctx.strokeStyle = '#2f3336';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(0, 0, cardWidth, totalHeight, 16);
  ctx.stroke();

  let y = padding;

  for (let i = 0; i < measured.length; i++) {
    const m = measured[i];

    // Thread line connecting avatars (except last)
    if (i < measured.length - 1) {
      ctx.strokeStyle = '#2f3336';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(padding + avatarSize / 2, y + avatarSize + 4);
      ctx.lineTo(padding + avatarSize / 2, y + m.height);
      ctx.stroke();
    }

    // Avatar
    drawCircularAvatar(ctx, m.avatarImg, padding, y, avatarSize, m.data.displayName[0]);

    // Display name + handle
    ctx.fillStyle = '#e7e9ea';
    ctx.font = `bold 14px ${fontFamily}`;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillText(m.data.displayName, contentLeft, y + 2);

    const nameW = ctx.measureText(m.data.displayName).width;
    ctx.fillStyle = '#71767b';
    ctx.font = `13px ${fontFamily}`;
    ctx.fillText(` @${m.data.handle}`, contentLeft + nameW, y + 3);

    // Body
    let textY = y + 24;
    ctx.fillStyle = '#e7e9ea';
    ctx.font = `${bodyFontSize}px ${fontFamily}`;
    for (const line of m.lines) {
      ctx.fillText(line, contentLeft, textY);
      textY += lineHeight;
    }

    if (i < measured.length - 1) {
      y += m.height;
    }
  }

  return canvas.toBuffer('image/png');
}
