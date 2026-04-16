import type { SKRSContext2D, Image } from '@napi-rs/canvas';

export function wrapLines(ctx: SKRSContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines: string[] = [];
  let current = words[0];
  for (let i = 1; i < words.length; i++) {
    const test = `${current} ${words[i]}`;
    if (ctx.measureText(test).width > maxWidth) {
      lines.push(current);
      current = words[i];
    } else {
      current = test;
    }
  }
  lines.push(current);
  return lines;
}

export function drawCircularAvatar(
  ctx: SKRSContext2D,
  img: Image | null,
  x: number,
  y: number,
  size: number,
  fallbackChar: string,
  borderColor: string = '#2f3336'
): void {
  const cx = x + size / 2;
  const cy = y + size / 2;
  const r = size / 2;

  if (img) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(img, x, y, size, size);
    ctx.restore();
  } else {
    ctx.fillStyle = '#1d9bf0';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${Math.round(size * 0.45)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(fallbackChar.toUpperCase(), cx, cy);
    ctx.textAlign = 'left';
  }

  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, r + 1, 0, Math.PI * 2);
  ctx.stroke();
}

export function formatMetric(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
