/**
 * Quick visual test — renders sample images with real stock photos.
 * Run: node scripts/test-compositor.mjs
 */
import { GlobalFonts } from '@napi-rs/canvas';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const { renderPost, renderSplitCard, renderBottomBar } = await import(
  path.join(ROOT, 'dist', 'compositor', 'canvas.js')
);

const OUT_DIR = '/mnt/c/Users/SPARTAN PC/Downloads';
const PHOTOS = '/tmp/compositor-test';

// Register fonts
const fontsDir = path.join(ROOT, 'assets', 'fonts');
for (const [file, family] of [
  ['space-grotesk.woff2', 'Space Grotesk'],
  ['Anton-Regular.ttf', 'Anton'],
  ['BebasNeue-Regular.ttf', 'Bebas Neue'],
]) {
  try { GlobalFonts.registerFromPath(path.join(fontsDir, file), family); } catch {}
}
console.log('Fonts registered.');

function loadTemplate(name) {
  return JSON.parse(fs.readFileSync(
    path.join(ROOT, 'src', 'templates', 'presets', `${name}.json`), 'utf8'
  ));
}

const logoPath = path.join(ROOT, 'assets', 'logos', 'douro-digital-logo-white.png');
const saves = [];

// 1. Bottom Bar — real photo + accent braces
{
  console.log('Rendering: bottom-bar (real photo, accent)...');
  const result = await renderBottomBar({
    headline: '5 SECRET CODES {THAT MAKE CHATGPT 100X BETTER}',
    background: path.join(PHOTOS, 'tech-person.jpg'),
    template: loadTemplate('bottom-bar'),
    brandHandle: '@wearedouro',
  });
  const out = path.join(OUT_DIR, 'real-bottom-bar-accent.jpg');
  fs.writeFileSync(out, result.buffer);
  saves.push(out);
  console.log(`  → saved (${result.width}x${result.height})`);
}

// 2. Bottom Bar — real photo, no braces
{
  console.log('Rendering: bottom-bar (real photo, plain)...');
  const result = await renderBottomBar({
    headline: 'THIS CEO JUST REPLACED 40% OF HIS WORKFORCE WITH AI',
    background: path.join(PHOTOS, 'woman-laptop.jpg'),
    template: loadTemplate('bottom-bar'),
    brandHandle: '@wearedouro',
  });
  const out = path.join(OUT_DIR, 'real-bottom-bar-plain.jpg');
  fs.writeFileSync(out, result.buffer);
  saves.push(out);
  console.log(`  → saved (${result.width}x${result.height})`);
}

// 3. Headline Center — real photo + accent
{
  console.log('Rendering: headline-center (real photo, accent)...');
  const result = await renderPost({
    headline: 'THE FUTURE OF {SOCIAL MEDIA} IS HERE',
    background: path.join(PHOTOS, 'ai-robot.jpg'),
    template: loadTemplate('headline-center'),
    logoPath,
  });
  const out = path.join(OUT_DIR, 'real-headline-center.jpg');
  fs.writeFileSync(out, result.buffer);
  saves.push(out);
  console.log(`  → saved (${result.width}x${result.height})`);
}

// 4. Split Card — real photo + accent
{
  console.log('Rendering: split-card (real photo, accent)...');
  const result = await renderSplitCard({
    headline: 'AI AGENTS ARE {REPLACING ENTIRE TEAMS}',
    background: path.join(PHOTOS, 'tech-person.jpg'),
    template: loadTemplate('split-card'),
    brandHandle: '@mariofunez2077',
  });
  const out = path.join(OUT_DIR, 'real-split-card.jpg');
  fs.writeFileSync(out, result.buffer);
  saves.push(out);
  console.log(`  → saved (${result.width}x${result.height})`);
}

// 5. Carousel Slide — real photo + accent
{
  console.log('Rendering: carousel-slide (real photo, accent)...');
  const result = await renderPost({
    headline: 'STOP POSTING {WITHOUT A STRATEGY}',
    background: path.join(PHOTOS, 'woman-laptop.jpg'),
    template: loadTemplate('carousel-slide'),
    logoPath,
  });
  const out = path.join(OUT_DIR, 'real-carousel.jpg');
  fs.writeFileSync(out, result.buffer);
  saves.push(out);
  console.log(`  → saved (${result.width}x${result.height})`);
}

// 6. Bottom Bar — personal brand
{
  console.log('Rendering: bottom-bar (personal brand)...');
  const result = await renderBottomBar({
    headline: 'ELON MUSK JUST {DELETED HIS OWN TWEET} ABOUT AI SAFETY',
    background: path.join(PHOTOS, 'ai-robot.jpg'),
    template: loadTemplate('bottom-bar'),
    brandHandle: '@mariofunez2077',
  });
  const out = path.join(OUT_DIR, 'real-personal-brand.jpg');
  fs.writeFileSync(out, result.buffer);
  saves.push(out);
  console.log(`  → saved (${result.width}x${result.height})`);
}

console.log(`\nDone — ${saves.length} images saved to Downloads.`);
