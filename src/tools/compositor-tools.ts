/**
 * Compositor tools for the agent
 *
 * 5 tools for programmatic post image generation:
 * - render_post_image: Render a single post image from headline + background + template
 * - render_carousel: Render a multi-slide carousel
 * - list_templates: List available layout templates
 * - fetch_background: Search and download background images from stock APIs or local folders
 * - preview_template: Render a quick preview of a template with sample text
 */

import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { app } from 'electron';

import { renderPost, renderSplitCard, renderBottomBar } from '../compositor';
import { renderVideoFrame, composeVideo } from '../compositor';
import type { RenderInput, RenderResult } from '../compositor';
import { getTemplate, listTemplates, listTemplateIds, registerFonts, getLogoPath } from '../templates';
import { getBackgrounds } from '../assets';
import type { AssetSource } from '../assets';
import { MemoryManager } from '../memory';
import type { GeneratedContentType } from '../memory/generated-content';

let memoryManager: MemoryManager | null = null;

export function setCompositorMemoryManager(memory: MemoryManager): void {
  memoryManager = memory;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SINGLE_POST_TEMPLATES = ['bottom-bar', 'headline-center', 'headline-bottom', 'split-card', 'social-embed'];

function pickRandomTemplate(): string {
  return SINGLE_POST_TEMPLATES[Math.floor(Math.random() * SINGLE_POST_TEMPLATES.length)];
}

function getMediaDir(): string {
  const dir = join(app.getPath('documents'), 'Neon-post', 'media');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function resolveLogoPath(_brandName?: string): string | undefined {
  // Default: Douro Digital wordmark (light version for dark backgrounds)
  const wordmark = getLogoPath('wordmark');
  if (existsSync(wordmark)) return wordmark;
  return undefined;
}

async function saveRenderResult(
  result: RenderResult,
  headline: string,
  templateId: string,
  platform?: string,
  brandConfigId?: string,
  groupId?: string,
  contentType?: GeneratedContentType
): Promise<string> {
  const ext = result.mimeType === 'image/png' ? 'png' : 'jpg';
  const fileName = `post-${randomUUID().slice(0, 8)}.${ext}`;
  const filePath = join(getMediaDir(), fileName);
  writeFileSync(filePath, result.buffer);

  // Save to generated_content gallery
  if (memoryManager) {
    memoryManager.generatedContent.create({
      content_type: contentType ?? 'image',
      platform: platform ?? null,
      prompt_used: headline,
      output: headline,
      media_url: filePath,
      brand_config_id: brandConfigId ?? null,
      group_id: groupId ?? null,
      metadata: JSON.stringify({
        template: templateId,
        width: result.width,
        height: result.height,
        generated_by: 'compositor',
      }),
    });
  }

  return filePath;
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

function getRenderPostImageDefinition() {
  return {
    name: 'render_post_image',
    description:
      'Render a social media post image with a headline overlaid on a background image. ' +
      'Uses the compositor engine with brand fonts, templates, and watermarks. ' +
      'The result is saved to Documents/Neon-post/media/ and added to the gallery automatically. ' +
      'The file_path in the response shows the exact output location. There is NO output_path parameter — the save location is automatic. ' +
      'For background images, either provide a local file path or use fetch_background first to get stock images.',
    input_schema: {
      type: 'object' as const,
      properties: {
        headline: {
          type: 'string',
          description:
            'The headline text to render on the image. Supports {brace} markup for red accent text — ' +
            'wrap 1-2 key words in curly braces to highlight them in brand red (#d42918). ' +
            'Example: "THIS CEO JUST {REPLACED 40%} OF HIS WORKFORCE WITH AI". ' +
            'ALWAYS use {brace} markup on at least one word per headline for visual impact.',
        },
        background_path: {
          type: 'string',
          description: 'Local file path to the background image',
        },
        template: {
          type: 'string',
          description:
            'Template ID — VARY your choice across renders for visual diversity. Do NOT always use the same template. Options: ' +
            '"bottom-bar" (branded — image top, circuit divider, text bottom with logo — BEST for branded posts), ' +
            '"headline-center" (text centered over image with dark overlay), ' +
            '"headline-bottom" (text at bottom with gradient fade), ' +
            '"split-card" (left panel text + right panel image — great for quotes/tips), ' +
            '"social-embed" (social post embed style), ' +
            '"carousel-slide" (carousel step with swipe CTA — use with render_carousel).',
        },
        cta_text: {
          type: 'string',
          description: 'Override the CTA badge text (e.g. "SWIPE FOR MORE", "LINK IN BIO"). Leave empty to use template default.',
        },
        brand_name: {
          type: 'string',
          description:
            'Brand name for watermark. Leave empty to use the Douro Digital wordmark logo. ' +
            'Set to a personal name (e.g. "Danny") to render a text watermark in brand red instead.',
        },
        brand_color: {
          type: 'string',
          description: 'Hex color for the text watermark (default: "#d42918" — Douro red). Only used when brand_name is set.',
        },
        platform: {
          type: 'string',
          description: 'Target platform for gallery tagging (e.g. "instagram", "linkedin")',
        },
        brand_config_id: {
          type: 'string',
          description: 'Brand config ID from the database (optional, for gallery association)',
        },
      },
      required: ['headline', 'background_path'],
    },
  };
}

async function handleRenderPostImage(input: unknown): Promise<string> {
  const {
    headline,
    background_path,
    template: templateId,
    cta_text,
    brand_name,
    platform,
    brand_config_id,
  } = input as {
    headline: string;
    background_path: string;
    template?: string;
    cta_text?: string;
    brand_name?: string;
    brand_color?: string;
    platform?: string;
    brand_config_id?: string;
  };

  if (!headline) return JSON.stringify({ error: 'Missing required field: headline' });
  if (!background_path) return JSON.stringify({ error: 'Missing required field: background_path' });
  if (!existsSync(background_path)) return JSON.stringify({ error: `Background image not found: ${background_path}` });

  registerFonts();

  const tid = templateId || pickRandomTemplate();
  const tmpl = getTemplate(tid);
  if (!tmpl) return JSON.stringify({ error: `Unknown template: ${tid}. Available: ${listTemplateIds().join(', ')}` });

  const logoPath = brand_name ? undefined : resolveLogoPath();
  const brandHandle = brand_name || undefined;

  const renderInput: RenderInput = {
    headline,
    background: background_path,
    template: tmpl,
    logoPath,
    ctaText: cta_text,
    brandHandle,
  };

  try {
    let renderFn: (input: RenderInput) => Promise<RenderResult>;
    if (tid === 'split-card') renderFn = renderSplitCard;
    else if (tid === 'bottom-bar') renderFn = renderBottomBar;
    else renderFn = renderPost;

    const result = await renderFn(renderInput);
    const filePath = await saveRenderResult(result, headline, tid, platform, brand_config_id);

    return JSON.stringify({
      success: true,
      file_path: filePath,
      template: tid,
      dimensions: `${result.width}x${result.height}`,
      message: `Post image rendered and saved to gallery. File: ${filePath}`,
    });
  } catch (error) {
    return JSON.stringify({ error: error instanceof Error ? error.message : String(error) });
  }
}

// ---------------------------------------------------------------------------

function getRenderCarouselDefinition() {
  return {
    name: 'render_carousel',
    description:
      'Render a multi-slide carousel. Provide an array of headlines and either one shared background ' +
      'or one background per slide. Each slide is rendered with the carousel-slide template (or a specified template). ' +
      'All slides are saved to Documents/Neon-post/media/ and added to the gallery automatically. ' +
      'There is NO output_path parameter — the save location is automatic. Check file_paths in the response for exact locations.',
    input_schema: {
      type: 'object' as const,
      properties: {
        headlines: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Array of headline strings, one per slide. Use {brace} markup to highlight key words in brand red — ' +
            'e.g. "YOUR COMPETITOR JUST {SHIPPED} WHAT YOU PLANNED". ALWAYS use {brace} on at least one word per slide.',
        },
        background_paths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of background image paths. If only one is provided, it is reused for all slides.',
        },
        template: {
          type: 'string',
          description: 'Template ID (default: "carousel-slide")',
        },
        brand_name: {
          type: 'string',
          description: 'Personal brand name for text watermark (omit for Douro logo)',
        },
        platform: {
          type: 'string',
          description: 'Target platform for gallery tagging',
        },
      },
      required: ['headlines', 'background_paths'],
    },
  };
}

async function handleRenderCarousel(input: unknown): Promise<string> {
  const { headlines, background_paths, template: templateId, brand_name, platform } = input as {
    headlines: string[];
    background_paths: string[];
    template?: string;
    brand_name?: string;
    platform?: string;
  };

  if (!headlines?.length) return JSON.stringify({ error: 'Missing required field: headlines' });
  if (!background_paths?.length) return JSON.stringify({ error: 'Missing required field: background_paths' });

  registerFonts();

  const tid = templateId || 'carousel-slide';
  const tmpl = getTemplate(tid);
  if (!tmpl) return JSON.stringify({ error: `Unknown template: ${tid}` });

  const logoPath = brand_name ? undefined : resolveLogoPath();
  const brandHandle = brand_name || undefined;

  let renderFn: (input: RenderInput) => Promise<RenderResult>;
  if (tid === 'split-card') renderFn = renderSplitCard;
  else if (tid === 'bottom-bar') renderFn = renderBottomBar;
  else renderFn = renderPost;

  const filePaths: string[] = [];
  const groupId = randomUUID();

  try {
    for (let i = 0; i < headlines.length; i++) {
      const bgPath = background_paths.length === 1 ? background_paths[0] : background_paths[i];
      if (!bgPath || !existsSync(bgPath)) {
        return JSON.stringify({ error: `Background not found for slide ${i + 1}: ${bgPath}` });
      }

      const ctaText = i < headlines.length - 1 ? 'SWIPE →' : undefined;

      const result = await renderFn({
        headline: headlines[i],
        background: bgPath,
        template: tmpl,
        logoPath,
        ctaText,
        brandHandle,
      });

      const filePath = await saveRenderResult(result, headlines[i], tid, platform, undefined, groupId, 'carousel');
      filePaths.push(filePath);
    }

    return JSON.stringify({
      success: true,
      slides: filePaths.length,
      file_paths: filePaths,
      group_id: groupId,
      template: tid,
      message: `Carousel rendered: ${filePaths.length} slides saved to gallery.`,
    });
  } catch (error) {
    return JSON.stringify({ error: error instanceof Error ? error.message : String(error) });
  }
}

// ---------------------------------------------------------------------------

function getListTemplatesDefinition() {
  return {
    name: 'list_templates',
    description: 'List all available post image templates with their settings.',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  };
}

async function handleListTemplates(): Promise<string> {
  const templates = listTemplates();
  const summary = templates.map((t) => ({
    id: t.id,
    name: t.name,
    format: t.format,
    text_position: t.text.position,
    uppercase: t.text.uppercase,
    has_cta: t.cta.enabled,
    cta_text: t.cta.enabled ? t.cta.text : null,
    overlay_opacity: t.overlay.opacity,
  }));
  return JSON.stringify({ templates: summary });
}

// ---------------------------------------------------------------------------

function getFetchBackgroundDefinition() {
  return {
    name: 'fetch_background',
    description:
      'Search and download background images for post rendering. ' +
      'Supports Pexels (free stock photos, needs API key), Unsplash (free stock photos, needs API key), ' +
      'and local folder scanning. Returns local file paths that can be passed to render_post_image.',
    input_schema: {
      type: 'object' as const,
      properties: {
        source: {
          type: 'string',
          description: 'Image source: "pexels", "unsplash", or "local"',
        },
        query: {
          type: 'string',
          description:
            'Search query for stock APIs (e.g. "business meeting", "technology abstract"). ' +
            'For "local" source, this is the folder path to scan.',
        },
        orientation: {
          type: 'string',
          description: 'Preferred orientation: "landscape", "portrait", or "square". Stock APIs only.',
        },
        count: {
          type: 'number',
          description: 'Number of images to return (default: 5, max: 20)',
        },
      },
      required: ['source', 'query'],
    },
  };
}

async function handleFetchBackground(input: unknown): Promise<string> {
  const { source, query, orientation, count } = input as {
    source: string;
    query: string;
    orientation?: 'landscape' | 'portrait' | 'square';
    count?: number;
  };

  if (!source) return JSON.stringify({ error: 'Missing required field: source' });
  if (!query) return JSON.stringify({ error: 'Missing required field: query' });

  const validSources: AssetSource[] = ['pexels', 'unsplash', 'local'];
  if (!validSources.includes(source as AssetSource)) {
    return JSON.stringify({ error: `Invalid source: ${source}. Must be: ${validSources.join(', ')}` });
  }

  try {
    const assets = await getBackgrounds(source as AssetSource, {
      query,
      orientation,
      count: Math.min(count ?? 5, 20),
    });

    const results = assets.map((a) => ({
      id: a.id,
      source: a.source,
      local_path: a.localPath,
      dimensions: `${a.width}x${a.height}`,
      attribution: a.attribution,
    }));

    return JSON.stringify({
      success: true,
      count: results.length,
      images: results,
      message: `Found ${results.length} background image(s) from ${source}.`,
    });
  } catch (error) {
    return JSON.stringify({ error: error instanceof Error ? error.message : String(error) });
  }
}

// ---------------------------------------------------------------------------

function getPreviewTemplateDefinition() {
  return {
    name: 'preview_template',
    description:
      'Render a quick preview of a template with sample text on a solid dark background. ' +
      'Useful for showing the user what a template looks like before using it with a real background.',
    input_schema: {
      type: 'object' as const,
      properties: {
        template: {
          type: 'string',
          description: 'Template ID to preview',
        },
        sample_text: {
          type: 'string',
          description: 'Sample headline text (default: "Your headline goes here")',
        },
      },
      required: ['template'],
    },
  };
}

async function handlePreviewTemplate(input: unknown): Promise<string> {
  const { template: templateId, sample_text } = input as {
    template: string;
    sample_text?: string;
  };

  if (!templateId) return JSON.stringify({ error: 'Missing required field: template' });

  const tmpl = getTemplate(templateId);
  if (!tmpl) return JSON.stringify({ error: `Unknown template: ${templateId}. Available: ${listTemplateIds().join(', ')}` });

  registerFonts();

  // Create a simple dark gradient background in-memory
  const { createCanvas } = await import('@napi-rs/canvas');
  const dims = { width: templateId === 'headline-center' || templateId === 'headline-bottom' ? 1080 : 1080, height: templateId === 'headline-center' || templateId === 'headline-bottom' ? 1350 : 1080 };
  const bgCanvas = createCanvas(dims.width, dims.height);
  const bgCtx = bgCanvas.getContext('2d');
  const gradient = bgCtx.createLinearGradient(0, 0, dims.width, dims.height);
  gradient.addColorStop(0, '#1a1a2e');
  gradient.addColorStop(0.5, '#16213e');
  gradient.addColorStop(1, '#0f3460');
  bgCtx.fillStyle = gradient;
  bgCtx.fillRect(0, 0, dims.width, dims.height);
  const bgBuffer = bgCanvas.toBuffer('image/png');

  const headline = sample_text || 'Your headline goes here and it will wrap across multiple lines';
  const logoPath = resolveLogoPath();

  try {
    let previewRenderFn: (input: RenderInput) => Promise<RenderResult>;
    if (templateId === 'split-card') previewRenderFn = renderSplitCard;
    else if (templateId === 'bottom-bar') previewRenderFn = renderBottomBar;
    else previewRenderFn = renderPost;

    const result = await previewRenderFn({
      headline,
      background: bgBuffer,
      template: tmpl,
      logoPath,
      brandHandle: templateId === 'bottom-bar' ? '@wearedouro' : undefined,
    });

    const previewExt = result.mimeType === 'image/png' ? 'png' : 'jpg';
    const filePath = join(getMediaDir(), `preview-${templateId}-${Date.now()}.${previewExt}`);
    writeFileSync(filePath, result.buffer);

    return JSON.stringify({
      success: true,
      file_path: filePath,
      template: templateId,
      dimensions: `${result.width}x${result.height}`,
      message: `Template preview saved: ${filePath}`,
    });
  } catch (error) {
    return JSON.stringify({ error: error instanceof Error ? error.message : String(error) });
  }
}

// ---------------------------------------------------------------------------

function getRenderVideoDefinition() {
  return {
    name: 'render_video',
    description:
      'Template a video with the Douro branded layout — video plays in the top half, ' +
      'branded bar with headline text in the bottom half, circuit divider, pill watermark, red accent stripe. ' +
      'Takes a source video (e.g. downloaded news clip, YouTube video, podcast segment) ' +
      'and composites the branded overlay onto it. Outputs an H.264 MP4. ' +
      'Use this for repurposing existing video content with the brand template.',
    input_schema: {
      type: 'object' as const,
      properties: {
        headline: {
          type: 'string',
          description:
            'Headline text for the bottom bar. Supports {brace} markup for red accent text. ' +
            'Example: "THIS CEO JUST {REPLACED 40% OF HIS WORKFORCE} WITH AI"',
        },
        video_path: {
          type: 'string',
          description: 'Local file path to the source video',
        },
        brand_handle: {
          type: 'string',
          description: 'Brand handle for pill watermark (e.g. "@wearedouro", "@mariofunez2077")',
        },
        trim_start: {
          type: 'number',
          description: 'Start time in seconds to trim from (optional)',
        },
        trim_end: {
          type: 'number',
          description: 'End time in seconds to trim to (optional)',
        },
        platform: {
          type: 'string',
          description: 'Target platform for gallery tagging (e.g. "instagram", "tiktok")',
        },
      },
      required: ['headline', 'video_path'],
    },
  };
}

async function handleRenderVideo(input: unknown): Promise<string> {
  const { headline, video_path, brand_handle, trim_start, trim_end, platform } = input as {
    headline: string;
    video_path: string;
    brand_handle?: string;
    trim_start?: number;
    trim_end?: number;
    platform?: string;
  };

  if (!headline) return JSON.stringify({ error: 'Missing required field: headline' });
  if (!video_path) return JSON.stringify({ error: 'Missing required field: video_path' });
  if (!existsSync(video_path)) return JSON.stringify({ error: `Video not found: ${video_path}` });

  registerFonts();

  const tmpl = getTemplate('bottom-bar');
  if (!tmpl) return JSON.stringify({ error: 'bottom-bar template not found' });

  try {
    // Step 1: Render the branded overlay frame PNG
    const frame = await renderVideoFrame({
      headline,
      template: tmpl,
      brandHandle: brand_handle || '@wearedouro',
    });

    // Save overlay frame to temp
    const frameFileName = `video-frame-${randomUUID().slice(0, 8)}.png`;
    const framePath = join(getMediaDir(), frameFileName);
    writeFileSync(framePath, frame.buffer);

    // Step 2: Compose video + overlay → branded MP4
    const outputFileName = `video-${randomUUID().slice(0, 8)}.mp4`;
    const outputPath = join(getMediaDir(), outputFileName);

    const result = await composeVideo({
      videoPath: video_path,
      overlayPath: framePath,
      outputPath,
      format: 'portrait',
      splitRatio: 0.50,
      crf: 18,
      preset: 'fast',
      trimStart: trim_start,
      trimEnd: trim_end,
    });

    if (!result.success) {
      return JSON.stringify({ error: `Video composition failed: ${result.error}` });
    }

    // Save to gallery
    if (memoryManager) {
      memoryManager.generatedContent.create({
        content_type: 'video',
        platform: platform ?? null,
        prompt_used: headline,
        output: headline,
        media_url: outputPath,
        brand_config_id: null,
        metadata: JSON.stringify({
          template: 'bottom-bar',
          width: result.width,
          height: result.height,
          duration: result.duration,
          source_video: video_path,
          generated_by: 'compositor-video',
        }),
      });
    }

    return JSON.stringify({
      success: true,
      file_path: outputPath,
      overlay_path: framePath,
      dimensions: `${result.width}x${result.height}`,
      duration: result.duration,
      message: `Branded video rendered and saved. File: ${outputPath}`,
    });
  } catch (error) {
    return JSON.stringify({ error: error instanceof Error ? error.message : String(error) });
  }
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export function getCompositorTools() {
  return [
    { ...getRenderPostImageDefinition(), handler: handleRenderPostImage },
    { ...getRenderCarouselDefinition(), handler: handleRenderCarousel },
    { ...getRenderVideoDefinition(), handler: handleRenderVideo },
    { ...getListTemplatesDefinition(), handler: handleListTemplates },
    { ...getFetchBackgroundDefinition(), handler: handleFetchBackground },
    { ...getPreviewTemplateDefinition(), handler: handlePreviewTemplate },
  ];
}
