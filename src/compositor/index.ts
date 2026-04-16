// Image render pipelines
export { renderPost, renderSplitCard, renderBottomBar } from './image';
export { drawBackground, drawBgTopAligned, coverFitCrop } from './image';

// Video render pipeline
export { renderVideoFrame, composeVideo } from './video';
export type { ComposeOptions, ComposeResult } from './video';

// Drawing primitives
export { wrapText, measureTextBlock, computeStartY } from './primitives/text-layout';
export { drawOverlay, drawGradientOverlay } from './primitives/overlay';
export { drawLogoWatermark, drawTextWatermark, drawPillWatermark } from './primitives/watermark';
export { drawCtaBadge } from './primitives/cta-badge';
export { parseRichHeadline, drawRichHeadline } from './primitives/rich-text';
export type { TextRun } from './primitives/rich-text';
export { drawIconOverlay } from './primitives/icon-overlay';
export type { IconPosition } from './primitives/icon-overlay';
export { drawBrandedDivider, drawAssetDivider } from './primitives/divider';
export type { AssetDividerOptions } from './primitives/divider';

// Social card renderers
export { renderTweetCard, renderQuoteCard, renderCommentThread } from './social';
export { screenshotTweet, drawPostScreenshot } from './social';
export type { TweetCardData, QuoteCardData, CommentCardData } from './social';

// Types
export type {
  CanvasFormat,
  TextPosition,
  CtaPosition,
  WatermarkPosition,
  TemplateTextConfig,
  TemplateOverlayConfig,
  TemplateCtaConfig,
  TemplateWatermarkConfig,
  TemplateDefinition,
  RenderInput,
  RenderResult,
  BatchRenderInput,
} from './types';
export { CANVAS_DIMENSIONS } from './types';
