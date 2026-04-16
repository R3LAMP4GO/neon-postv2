/**
 * End-to-end test: renderVideoFrame → composeVideo → branded MP4.
 * Run: node scripts/test-video-compose.mjs
 */
import { GlobalFonts } from '@napi-rs/canvas';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const { renderVideoFrame } = await import(path.join(ROOT, 'dist/compositor/video/frame.js'));
const { composeVideo } = await import(path.join(ROOT, 'dist/compositor/video/compose.js'));

const OUT_DIR = '/mnt/c/Users/SPARTAN PC/Downloads';

// Register fonts
GlobalFonts.registerFromPath(path.join(ROOT, 'assets/fonts/Anton-Regular.ttf'), 'Anton');
GlobalFonts.registerFromPath(path.join(ROOT, 'assets/fonts/space-grotesk.woff2'), 'Space Grotesk');
console.log('Fonts registered.');

// Load template
const tpl = JSON.parse(fs.readFileSync(
  path.join(ROOT, 'src/templates/presets/bottom-bar.json'), 'utf8'
));

// Step 1: Render the overlay frame PNG
console.log('Step 1: Rendering video overlay frame...');
const frame = await renderVideoFrame({
  headline: 'THIS CEO JUST {REPLACED 40% OF HIS WORKFORCE} WITH AI',
  template: tpl,
  brandHandle: '@wearedouro',
});

const framePath = path.join(OUT_DIR, 'video-overlay-frame.png');
fs.writeFileSync(framePath, frame.buffer);
console.log(`  → Frame saved: ${framePath} (${frame.width}x${frame.height})`);

// Step 2: Compose video + overlay → branded MP4
console.log('Step 2: Composing video + overlay...');
const outputPath = path.join(OUT_DIR, 'branded-video-test.mp4');

const result = await composeVideo({
  videoPath: '/tmp/compositor-test/stock-video.mp4',
  overlayPath: framePath,
  outputPath,
  format: 'portrait',
  splitRatio: 0.50,
  crf: 18,
  preset: 'fast',
  trimEnd: 10, // just first 10 seconds for testing
});

if (result.success) {
  console.log(`  → Video saved: ${result.outputPath}`);
  console.log(`    ${result.width}x${result.height}, ~${result.duration?.toFixed(1)}s`);
} else {
  console.error('  ✗ FAILED:', result.error);
}

console.log('\nDone.');
