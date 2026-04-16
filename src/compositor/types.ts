// ---------------------------------------------------------------------------
// Compositor types
// ---------------------------------------------------------------------------

/** Canvas dimensions for common social media formats. */
export type CanvasFormat = 'square' | 'portrait' | 'story';

export const CANVAS_DIMENSIONS: Record<CanvasFormat, { width: number; height: number }> = {
  square: { width: 1080, height: 1080 },
  portrait: { width: 1080, height: 1350 },
  story: { width: 1080, height: 1920 },
};

/** Where the headline text block sits on the canvas. */
export type TextPosition = 'center' | 'bottom' | 'top';

/** CTA badge placement. */
export type CtaPosition = 'bottom-center' | 'bottom-right' | 'bottom-left';

/** Watermark placement. */
export type WatermarkPosition =
  | 'bottom-right'
  | 'bottom-left'
  | 'top-right'
  | 'top-left'
  | 'bottom-center';

// ---------------------------------------------------------------------------
// Template definition — the JSON schema for layout presets
// ---------------------------------------------------------------------------

export interface TemplateTextConfig {
  /** Where the text block is anchored. */
  position: TextPosition;
  /** Font family name (must be registered via GlobalFonts). */
  fontFamily: string;
  /** Font size in px. */
  fontSize: number;
  /** Font weight keyword (e.g. 'bold', '900'). */
  fontWeight: string;
  /** Fill colour. */
  color: string;
  /** Stroke colour for outline. */
  strokeColor: string;
  /** Stroke width in px (0 = no stroke). */
  strokeWidth: number;
  /** Line height multiplier (e.g. 1.2). */
  lineHeight: number;
  /** Horizontal padding from canvas edges in px. */
  paddingX: number;
  /** Vertical offset from the anchor position in px. */
  offsetY: number;
  /** Transform text to uppercase before rendering. */
  uppercase: boolean;
}

export interface TemplateOverlayConfig {
  /** Whether to apply a dark overlay on the background. */
  enabled: boolean;
  /** Overlay colour (typically black). */
  color: string;
  /** Overlay opacity 0–1. */
  opacity: number;
}

export interface TemplateCtaConfig {
  /** Whether to render a CTA badge. */
  enabled: boolean;
  /** Badge text (e.g. "SWIPE FOR MORE"). */
  text: string;
  /** Badge placement. */
  position: CtaPosition;
  /** Badge background colour. */
  backgroundColor: string;
  /** Badge text colour. */
  textColor: string;
  /** Font size for the CTA text. */
  fontSize: number;
  /** Corner radius of the badge. */
  borderRadius: number;
  /** Horizontal padding inside the badge. */
  paddingX: number;
  /** Vertical padding inside the badge. */
  paddingY: number;
  /** Distance from canvas edge. */
  margin: number;
}

export interface TemplateWatermarkConfig {
  /** Whether to render a watermark. */
  enabled: boolean;
  /** Placement on the canvas. */
  position: WatermarkPosition;
  /** Opacity 0–1. */
  opacity: number;
  /** Max width the logo is scaled to. */
  maxWidth: number;
  /** Max height the logo is scaled to. */
  maxHeight: number;
  /** Distance from canvas edge. */
  margin: number;
}

export interface TemplateDefinition {
  /** Unique template identifier (slug). */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Canvas format. */
  format: CanvasFormat;
  /** Background overlay settings. */
  overlay: TemplateOverlayConfig;
  /** Headline text settings. */
  text: TemplateTextConfig;
  /** CTA badge settings. */
  cta: TemplateCtaConfig;
  /** Watermark / logo settings. */
  watermark: TemplateWatermarkConfig;
}

// ---------------------------------------------------------------------------
// Compositor input / output
// ---------------------------------------------------------------------------

export interface RenderInput {
  /** Headline text to render on the image. */
  headline: string;
  /** Path to background image file, or a Buffer. */
  background: string | Buffer;
  /** Template to use for layout. */
  template: TemplateDefinition;
  /** Optional path to logo/watermark image. */
  logoPath?: string;
  /** Override the CTA text from the template. */
  ctaText?: string;
  /** Optional brand handle text rendered alongside or instead of logo. */
  brandHandle?: string;
}

export interface RenderResult {
  /** The rendered image as a Buffer (JPEG or PNG). */
  buffer: Buffer;
  /** MIME type of the output. */
  mimeType: 'image/jpeg' | 'image/png';
  /** Width of the output image. */
  width: number;
  /** Height of the output image. */
  height: number;
}

export interface BatchRenderInput {
  /** Array of headlines to render. */
  headlines: string[];
  /** Backgrounds — one per headline, or a single one reused for all. */
  backgrounds: Array<string | Buffer>;
  /** Template to use for all images. */
  template: TemplateDefinition;
  /** Optional path to logo/watermark image. */
  logoPath?: string;
  /** Optional brand handle. */
  brandHandle?: string;
  /** Optional per-slide CTA overrides. */
  ctaTexts?: string[];
}
