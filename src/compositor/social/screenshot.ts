import type { SKRSContext2D } from '@napi-rs/canvas';
import { loadImage } from '@napi-rs/canvas';

// ---------------------------------------------------------------------------
// Social post screenshot compositing
// ---------------------------------------------------------------------------

/**
 * Takes a screenshot of a tweet/X post using Twitter's embed renderer.
 *
 * Uses neon-post's existing Electron BrowserWindow (headless) to navigate
 * to the embed URL, wait for the article to render, and screenshot it.
 *
 * @param tweetId The tweet/post ID (e.g. "1591870444776439810")
 * @param darkMode Whether to use dark theme (default: true)
 * @returns Buffer of the screenshot PNG
 */
export async function screenshotTweet(
  tweetId: string,
  darkMode: boolean = true
): Promise<Buffer> {
  // Dynamic import to avoid pulling Electron into non-Electron contexts
  const { BrowserWindow } = await import('electron');

  const win = new BrowserWindow({
    width: 550,
    height: 800,
    show: false,
    webPreferences: {
      offscreen: true,
      contextIsolation: true,
    },
  });

  const theme = darkMode ? 'dark' : 'light';
  const embedUrl =
    `https://platform.twitter.com/embed/Tweet.html` +
    `?id=${tweetId}&theme=${theme}&hideThread=true&hideCard=false` +
    `&frame=false&lang=en`;

  try {
    await win.loadURL(embedUrl);

    // Wait for the article element to render
    await win.webContents.executeJavaScript(`
      new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Tweet render timeout')), 15000);
        const check = () => {
          const article = document.querySelector('article');
          if (article) { clearTimeout(timeout); resolve(true); }
          else setTimeout(check, 200);
        };
        check();
      });
    `);

    // Get the article bounding rect
    const rect = await win.webContents.executeJavaScript(`
      (() => {
        const article = document.querySelector('article');
        if (!article) return null;
        const r = article.getBoundingClientRect();
        return { x: Math.floor(r.x), y: Math.floor(r.y), width: Math.ceil(r.width), height: Math.ceil(r.height) };
      })();
    `);

    if (!rect) throw new Error('Could not find tweet article element');

    // Screenshot just the article region
    const image = await win.webContents.capturePage({
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    });

    return image.toPNG();
  } finally {
    win.destroy();
  }
}

/**
 * Composites a social post screenshot onto the canvas.
 *
 * Centers the screenshot horizontally and positions it vertically
 * based on the anchor parameter.
 */
export async function drawPostScreenshot(
  ctx: SKRSContext2D,
  canvasWidth: number,
  canvasHeight: number,
  screenshotBuffer: Buffer,
  options: {
    /** Max width the screenshot is scaled to. */
    maxWidth?: number;
    /** Vertical anchor: 'center', 'top', 'bottom'. */
    verticalAnchor?: 'center' | 'top' | 'bottom';
    /** Vertical offset from the anchor. */
    offsetY?: number;
    /** Corner radius for the screenshot card. */
    borderRadius?: number;
  } = {}
): Promise<void> {
  const {
    maxWidth = canvasWidth * 0.85,
    verticalAnchor = 'center',
    offsetY = 0,
    borderRadius = 16,
  } = options;

  const img = await loadImage(screenshotBuffer);

  // Scale to fit maxWidth while preserving aspect ratio
  const scale = Math.min(maxWidth / img.width, 1);
  const drawWidth = Math.round(img.width * scale);
  const drawHeight = Math.round(img.height * scale);

  const x = (canvasWidth - drawWidth) / 2;
  let y: number;
  if (verticalAnchor === 'center') y = (canvasHeight - drawHeight) / 2 + offsetY;
  else if (verticalAnchor === 'top') y = offsetY;
  else y = canvasHeight - drawHeight - offsetY;

  // Draw with rounded corners
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, drawWidth, drawHeight, borderRadius);
  ctx.clip();
  ctx.drawImage(img, x, y, drawWidth, drawHeight);
  ctx.restore();
}
