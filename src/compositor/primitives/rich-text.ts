import type { SKRSContext2D } from '@napi-rs/canvas';

// ---------------------------------------------------------------------------
// Rich text rendering — per-segment colour/weight within a single headline
// ---------------------------------------------------------------------------

/**
 * A styled text segment. Split your headline into these to render
 * multi-colour/multi-weight text.
 *
 * Example: "THIS CEO JUST REPLACED | 40% OF HIS WORKFORCE"
 *   → [{ text: "THIS CEO JUST REPLACED", color: "#fff" },
 *      { text: "40% OF HIS WORKFORCE", color: "#d42918", fontWeight: "900" }]
 */
export interface TextRun {
  text: string;
  color?: string;
  fontWeight?: string;
  fontSize?: number;
}

/**
 * Parses a headline string with markup into TextRuns.
 *
 * Markup format: wrap accent text in curly braces.
 *   "5 SECRET CODES {THAT MAKE CHATGPT 100X BETTER}"
 *   → normal text + accent text
 *
 * @param raw        The marked-up headline.
 * @param baseColor  Default text colour.
 * @param accentColor Colour for text inside {braces}.
 */
export function parseRichHeadline(
  raw: string,
  baseColor: string = '#ffffff',
  accentColor: string = '#d42918'
): TextRun[] {
  const runs: TextRun[] = [];
  const regex = /\{([^}]+)\}/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(raw)) !== null) {
    // Text before the brace
    if (match.index > lastIndex) {
      runs.push({ text: raw.slice(lastIndex, match.index).trim(), color: baseColor });
    }
    // Accented text inside braces
    runs.push({ text: match[1].trim(), color: accentColor, fontWeight: '900' });
    lastIndex = match.index + match[0].length;
  }

  // Remaining text after last brace
  if (lastIndex < raw.length) {
    runs.push({ text: raw.slice(lastIndex).trim(), color: baseColor });
  }

  // If no braces found, return the whole thing as one run
  if (runs.length === 0) {
    runs.push({ text: raw, color: baseColor });
  }

  return runs.filter((r) => r.text.length > 0);
}

// ---------------------------------------------------------------------------
// Word-level rich wrapping + rendering
// ---------------------------------------------------------------------------

interface RichWord {
  word: string;
  color: string;
  fontWeight: string;
}

/**
 * Flattens TextRuns into individual words with their styles attached.
 */
function flattenToWords(runs: TextRun[], defaultWeight: string): RichWord[] {
  const words: RichWord[] = [];
  for (const run of runs) {
    const runWords = run.text.split(/\s+/).filter(Boolean);
    for (const w of runWords) {
      words.push({
        word: w,
        color: run.color ?? '#ffffff',
        fontWeight: run.fontWeight ?? defaultWeight,
      });
    }
  }
  return words;
}

interface RichLine {
  words: RichWord[];
  width: number;
}

/**
 * Wraps rich text into lines that fit within maxWidth, preserving per-word styles.
 */
function wrapRichWords(
  ctx: SKRSContext2D,
  words: RichWord[],
  maxWidth: number,
  fontSize: number,
  fontFamily: string
): RichLine[] {
  const lines: RichLine[] = [];
  let currentWords: RichWord[] = [];
  let currentWidth = 0;
  const spaceWidth = ctx.measureText(' ').width;

  for (const w of words) {
    ctx.font = `${w.fontWeight} ${fontSize}px ${fontFamily}`;
    const wordWidth = ctx.measureText(w.word).width;
    const testWidth = currentWords.length > 0 ? currentWidth + spaceWidth + wordWidth : wordWidth;

    if (testWidth > maxWidth && currentWords.length > 0) {
      lines.push({ words: currentWords, width: currentWidth });
      currentWords = [w];
      currentWidth = wordWidth;
    } else {
      currentWords.push(w);
      currentWidth = testWidth;
    }
  }
  if (currentWords.length > 0) {
    lines.push({ words: currentWords, width: currentWidth });
  }

  return lines;
}

/**
 * Renders a rich-text headline — each word can have its own colour/weight.
 *
 * Supports centered and left-aligned text. Each word is drawn individually
 * with its own fillStyle, advancing the X cursor by the measured width.
 */
export function drawRichHeadline(
  ctx: SKRSContext2D,
  canvasWidth: number,
  canvasHeight: number,
  runs: TextRun[],
  options: {
    fontSize: number;
    fontWeight: string;
    fontFamily: string;
    lineHeight: number;
    paddingX: number;
    position: 'center' | 'top' | 'bottom';
    offsetY: number;
    uppercase: boolean;
    strokeWidth: number;
    strokeColor: string;
    align?: 'center' | 'left';
  }
): void {
  const {
    fontSize, fontWeight, fontFamily, lineHeight, paddingX,
    position, offsetY, uppercase, strokeWidth, strokeColor,
    align = 'center',
  } = options;

  // Apply uppercase
  const processedRuns = uppercase
    ? runs.map((r) => ({ ...r, text: r.text.toUpperCase() }))
    : runs;

  const words = flattenToWords(processedRuns, fontWeight);
  const maxWidth = canvasWidth - paddingX * 2;

  // Set base font for wrapping measurement
  ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
  const lines = wrapRichWords(ctx, words, maxWidth, fontSize, fontFamily);

  const lineHeightPx = fontSize * lineHeight;
  const totalHeight = lines.length * lineHeightPx;
  const spaceWidth = ctx.measureText(' ').width;

  // Compute start Y
  let startY: number;
  if (position === 'center') startY = (canvasHeight - totalHeight) / 2 + offsetY;
  else if (position === 'bottom') startY = canvasHeight - totalHeight - offsetY;
  else startY = offsetY;

  ctx.textBaseline = 'top';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const y = startY + i * lineHeightPx;

    // Compute line start X
    let x: number;
    if (align === 'center') {
      x = (canvasWidth - line.width) / 2;
    } else {
      x = paddingX;
    }

    for (let j = 0; j < line.words.length; j++) {
      const w = line.words[j];
      ctx.font = `${w.fontWeight} ${fontSize}px ${fontFamily}`;

      // Stroke
      if (strokeWidth > 0) {
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = strokeWidth;
        ctx.lineJoin = 'round';
        ctx.textAlign = 'left';
        ctx.strokeText(w.word, x, y);
      }

      // Fill
      ctx.fillStyle = w.color;
      ctx.textAlign = 'left';
      ctx.fillText(w.word, x, y);

      // Advance cursor
      x += ctx.measureText(w.word).width + spaceWidth;
    }
  }
}
