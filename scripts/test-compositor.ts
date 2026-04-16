/**
 * Quick visual test — renders sample images for each compositor layout
 * and saves them to Downloads for inspection.
 *
 * Run: npx tsx scripts/test-compositor.ts
 */
import { createCanvas } from '@napi-rs/canvas';
import fs from 'fs';
import path from 'path';

import { registerFonts, getTemplate } from '../src/templates/index';
import { renderPost, renderSplitCard, renderBottomBar } from '../src/compositor/canvas';

const OUT_DIR = '/mnt/c/Users/SPARTAN PC/Downloads';

// ---------------------------------------------------------------------------
// Generate a fake photo-like gradient background (no network needed)
// ---------------------------------------------------------------------------
function makeFakeBg(w: number, h: number, seed: 'warm' | 'cool' | 'neon'): Buffer {
  const c = createCanvas(w, h);
  const ctx = c.getContext('2d');

  // Base gradient
  const grad = ctx.createLinearGradient(0, 0, w, h);
  if (seed === 'warm') {
    grad.addColorStop(0, '#1a0a2e');
    grad.addColorStop(0.4, '#3d1a5c');
    grad.addColorStop(0.7, '#6b2fa0');
    grad.addColorStop(1, '#d4418e');
  } else if (seed === 'cool') {
    grad.addColorStop(0, '#0f2027');
    grad.addColorStop(0.5, '#203a43');
    grad.addColorStop(1, '#2c5364');
  } else {
    grad.addColorStop(0, '#000428');
    grad.addColorStop(0.5, '#004e92');
    grad.addColorStop(1, '#00d2ff');
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // Fake "subject" — a lighter circle in the upper third to simulate a person/object
  const cx = w * 0.5;
  const cy = h * 0.28;
  const r = Math.min(w, h) * 0.22;
  const radial = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  radial.addColorStop(0, 'rgba(255,255,255,0.18)');
  radial.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = radial;
  ctx.fillRect(0, 0, w, h);

  return c.toBuffer('image/png');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log('Registering fonts...');
  registerFonts(path.resolve(process.cwd(), 'assets'));

  const saves: string[] = [];

  // ── 1. Bottom Bar (primary Douro layout) ──────────────────────────────
  {
    console.log('Rendering: bottom-bar...');
    const tpl = getTemplate('bottom-bar')!;
    const bg = makeFakeBg(1080, 1350, 'warm');
    const result = await renderBottomBar({
      headline: '5 SECRET CODES {THAT MAKE CHATGPT 100X BETTER}',
      background: bg,
      template: tpl,
      brandHandle: '@wearedouro',
    });
    const out = path.join(OUT_DIR, 'compositor-test-bottom-bar.jpg');
    fs.writeFileSync(out, result.buffer);
    saves.push(out);
    console.log(`  → ${out} (${result.width}x${result.height})`);
  }

  // ── 2. Bottom Bar — no accent braces ──────────────────────────────────
  {
    console.log('Rendering: bottom-bar (no accent)...');
    const tpl = getTemplate('bottom-bar')!;
    const bg = makeFakeBg(1080, 1350, 'cool');
    const result = await renderBottomBar({
      headline: 'THIS CEO JUST REPLACED 40% OF HIS WORKFORCE WITH AI',
      background: bg,
      template: tpl,
      brandHandle: '@wearedouro',
    });
    const out = path.join(OUT_DIR, 'compositor-test-bottom-bar-plain.jpg');
    fs.writeFileSync(out, result.buffer);
    saves.push(out);
    console.log(`  → ${out} (${result.width}x${result.height})`);
  }

  // ── 3. Headline Center ────────────────────────────────────────────────
  {
    console.log('Rendering: headline-center...');
    const tpl = getTemplate('headline-center')!;
    const bg = makeFakeBg(1080, 1350, 'neon');
    const logoPath = path.resolve(process.cwd(), 'assets', 'logos', 'douro-digital-logo-white.png');
    const result = await renderPost({
      headline: 'THE FUTURE OF SOCIAL MEDIA IS HERE',
      background: bg,
      template: tpl,
      logoPath,
    });
    const out = path.join(OUT_DIR, 'compositor-test-headline-center.jpg');
    fs.writeFileSync(out, result.buffer);
    saves.push(out);
    console.log(`  → ${out} (${result.width}x${result.height})`);
  }

  // ── 4. Split Card ─────────────────────────────────────────────────────
  {
    console.log('Rendering: split-card...');
    const tpl = getTemplate('split-card')!;
    const bg = makeFakeBg(1080, 1080, 'warm');
    const result = await renderSplitCard({
      headline: 'AI AGENTS ARE REPLACING ENTIRE TEAMS',
      background: bg,
      template: tpl,
      brandHandle: '@mariofunez2077',
    });
    const out = path.join(OUT_DIR, 'compositor-test-split-card.jpg');
    fs.writeFileSync(out, result.buffer);
    saves.push(out);
    console.log(`  → ${out} (${result.width}x${result.height})`);
  }

  // ── 5. Carousel Slide ─────────────────────────────────────────────────
  {
    console.log('Rendering: carousel-slide...');
    const tpl = getTemplate('carousel-slide')!;
    const bg = makeFakeBg(1080, 1080, 'cool');
    const logoPath = path.resolve(process.cwd(), 'assets', 'logos', 'douro-digital-logo-white.png');
    const result = await renderPost({
      headline: 'STOP POSTING WITHOUT A STRATEGY',
      background: bg,
      template: tpl,
      logoPath,
    });
    const out = path.join(OUT_DIR, 'compositor-test-carousel.jpg');
    fs.writeFileSync(out, result.buffer);
    saves.push(out);
    console.log(`  → ${out} (${result.width}x${result.height})`);
  }

  // ── 6. Bottom Bar — personal brand ────────────────────────────────────
  {
    console.log('Rendering: bottom-bar (personal brand)...');
    const tpl = getTemplate('bottom-bar')!;
    const bg = makeFakeBg(1080, 1350, 'neon');
    const result = await renderBottomBar({
      headline: 'ELON MUSK JUST {DELETED HIS OWN TWEET} ABOUT AI SAFETY',
      background: bg,
      template: tpl,
      brandHandle: '@mariofunez2077',
    });
    const out = path.join(OUT_DIR, 'compositor-test-personal-brand.jpg');
    fs.writeFileSync(out, result.buffer);
    saves.push(out);
    console.log(`  → ${out} (${result.width}x${result.height})`);
  }

  console.log(`\nDone — ${saves.length} images saved to Downloads.`);
}

main().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
