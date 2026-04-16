import { proxyFetch } from '../utils/proxy-fetch';

const API_BASE = 'https://api.kie.ai/api/v1';
const FILE_UPLOAD_BASE = 'https://kieai.redpandaai.co';

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export type ImageModelId =
  | 'nano-banana-2'
  | 'google/nano-banana-edit'
  | 'seedream/5-lite-text-to-image'
  | 'seedream/5-lite-image-to-image';

/**
 * Map of common shorthand aliases to their canonical Kie.ai model IDs.
 * The agent may pass abbreviated names — we resolve them here so the API
 * always receives a valid model identifier.
 */
const MODEL_ALIASES: Record<string, ImageModelId> = {
  // Nano Banana
  'nano-banana-2': 'nano-banana-2',
  'nano-banana': 'nano-banana-2',
  nanobanana: 'nano-banana-2',
  'nanobanana-2': 'nano-banana-2',
  nanobanana2: 'nano-banana-2',
  banana: 'nano-banana-2',
  // Nano Banana Edit (image-to-image)
  'nano-banana-edit': 'google/nano-banana-edit',
  'google/nano-banana-edit': 'google/nano-banana-edit',
  'nanobanana-edit': 'google/nano-banana-edit',
  'banana-edit': 'google/nano-banana-edit',
  // Seedream text-to-image
  'seedream/5-lite-text-to-image': 'seedream/5-lite-text-to-image',
  seedream: 'seedream/5-lite-text-to-image',
  'seedream-3': 'seedream/5-lite-text-to-image',
  'seedream-5': 'seedream/5-lite-text-to-image',
  'seedream-5-lite': 'seedream/5-lite-text-to-image',
  'seedream-text': 'seedream/5-lite-text-to-image',
  'seedream-text-to-image': 'seedream/5-lite-text-to-image',
  'seedream-t2i': 'seedream/5-lite-text-to-image',
  // Seedream image-to-image
  'seedream/5-lite-image-to-image': 'seedream/5-lite-image-to-image',
  'seedream-image-to-image': 'seedream/5-lite-image-to-image',
  'seedream-i2i': 'seedream/5-lite-image-to-image',
  'seedream-edit': 'seedream/5-lite-image-to-image',
  'seedream-image': 'seedream/5-lite-image-to-image',
};

/**
 * Resolve a possibly-abbreviated model name to a canonical Kie.ai model ID.
 * Throws if the name cannot be resolved.
 */
export function resolveModelId(raw: string): ImageModelId {
  const key = raw.trim().toLowerCase();
  const resolved = MODEL_ALIASES[key];
  if (resolved) return resolved;

  // Also try the raw value as-is (case-sensitive) in case it's already canonical
  if (Object.values(MODEL_ALIASES).includes(raw as ImageModelId)) {
    return raw as ImageModelId;
  }

  const available = [
    'nano-banana-2',
    'google/nano-banana-edit',
    'seedream/5-lite-text-to-image',
    'seedream/5-lite-image-to-image',
  ];
  throw new Error(
    `Unknown image model: "${raw}". Available models: ${available.join(', ')}. ` +
      `Common aliases: seedream, banana, seedream-edit, nano-banana-edit`
  );
}

export interface ImageGenerationRequest {
  prompt: string;
  model: ImageModelId;
  aspectRatio: string;
  quality: string; // '1K'|'2K'|'4K' for nano, 'basic'|'high' for seedream
  referenceImages?: string[]; // URLs for image-to-image
  outputFormat?: string; // 'png'|'jpg'|'jpeg' for nano
  imageSize?: string; // e.g. '1024x1024' for nano-banana-edit
}

export interface ImageGenerationResult {
  predictionId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  imageUrl?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Internal API response shapes
// ---------------------------------------------------------------------------

interface CreateTaskResponse {
  code: number;
  msg: string;
  data: { taskId: string };
}

interface RecordInfoResponse {
  code: number;
  msg: string;
  data: {
    taskId: string;
    state: 'waiting' | 'queuing' | 'generating' | 'success' | 'fail';
    resultJson?: string;
    failMsg?: string;
  };
}

interface FileUploadResponse {
  code: number;
  msg: string;
  data: { url: string };
}

// ---------------------------------------------------------------------------
// Input builder (model-specific)
// ---------------------------------------------------------------------------

function buildTaskInput(request: ImageGenerationRequest): Record<string, unknown> {
  const { model, prompt, aspectRatio, quality, referenceImages, outputFormat, imageSize } = request;

  if (model === 'nano-banana-2') {
    return {
      prompt,
      image_input: referenceImages ?? [],
      aspect_ratio: aspectRatio || 'auto',
      resolution: quality || '1K',
      output_format: outputFormat || 'jpg',
    };
  }

  if (model === 'google/nano-banana-edit') {
    return {
      prompt,
      image_urls: referenceImages ?? [],
      output_format: outputFormat || 'png',
      ...(imageSize ? { image_size: imageSize } : {}),
    };
  }

  if (model === 'seedream/5-lite-text-to-image') {
    return {
      prompt,
      aspect_ratio: aspectRatio || '1:1',
      quality: quality || 'basic',
      nsfw_checker: false,
    };
  }

  if (model === 'seedream/5-lite-image-to-image') {
    return {
      prompt,
      image_urls: referenceImages ?? [],
      aspect_ratio: aspectRatio || '1:1',
      quality: quality || 'basic',
      nsfw_checker: false,
    };
  }

  throw new Error(`Unknown image model: ${model}`);
}

// ---------------------------------------------------------------------------
// KieClient — image generation
// ---------------------------------------------------------------------------

export class KieClient {
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  /** Submit a new image generation task. Returns the remote task ID. */
  async generate(request: ImageGenerationRequest): Promise<{ predictionId: string }> {
    const input = buildTaskInput(request);

    const response = await proxyFetch(`${API_BASE}/jobs/createTask`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: request.model, input }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Kie.ai createTask error: HTTP ${response.status} — ${text.slice(0, 200)}`);
    }

    const data = (await response.json()) as CreateTaskResponse;

    if (data.code !== 200) {
      throw new Error(`Kie.ai createTask failed: ${data.msg}`);
    }

    return { predictionId: data.data.taskId };
  }

  /** Poll the status of a previously created task. */
  async getStatus(predictionId: string): Promise<ImageGenerationResult> {
    const response = await proxyFetch(
      `${API_BASE}/jobs/recordInfo?taskId=${encodeURIComponent(predictionId)}`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${this.apiKey}` },
      }
    );

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Kie.ai recordInfo error: HTTP ${response.status} — ${text.slice(0, 200)}`);
    }

    const raw = await response.json();
    console.log(`[KieClient] getStatus(${predictionId}) raw response:`, JSON.stringify(raw).slice(0, 500));
    // Write raw response to file for debugging (WSL can't capture Windows stdout)
    try {
      const fs = await import('fs');
      const path = await import('path');
      const logDir = path.join(process.env.APPDATA || '', 'neon-post');
      fs.appendFileSync(path.join(logDir, 'kie-debug.log'), `${new Date().toISOString()} getStatus(${predictionId}): ${JSON.stringify(raw)}\n`);
    } catch { /* non-critical */ }
    const data = raw as RecordInfoResponse;

    if (data.code !== 200) {
      return {
        predictionId,
        status: 'failed',
        error: data.msg || 'Unknown API error',
      };
    }

    const taskStatus = data.data?.state;
    console.log(`[KieClient] getStatus(${predictionId}): apiState=${taskStatus}`);

    if (taskStatus === 'success') {
      let imageUrl: string | undefined;
      if (data.data.resultJson && data.data.resultJson.length > 2) {
        try {
          const resultData = JSON.parse(data.data.resultJson) as { resultUrls?: string[] };
          imageUrl = resultData.resultUrls?.[0];
          console.log(`[KieClient] Job ${predictionId} success, imageUrl=${imageUrl?.slice(0, 80)}`);
        } catch (e) {
          console.error(`[KieClient] Failed to parse resultJson for ${predictionId}:`, data.data.resultJson, e);
        }
      } else {
        console.warn(`[KieClient] Job ${predictionId} succeeded but no resultJson!`);
      }
      return { predictionId, status: 'completed', imageUrl };
    }

    if (taskStatus === 'fail') {
      return {
        predictionId,
        status: 'failed',
        error: data.data.failMsg || 'Image generation failed',
      };
    }

    // waiting | queuing | generating → still in progress
    return { predictionId, status: 'processing' };
  }

  /**
   * Upload a local image file to Kie's CDN and return the hosted URL.
   * The URL can then be passed as a reference image in subsequent requests.
   */
  async uploadImage(filePath: string): Promise<string> {
    const fs = await import('fs');
    const path = await import('path');

    const fileBuffer = fs.readFileSync(filePath);
    const fileName = path.basename(filePath);
    const uploadPath = `uploads/${Date.now()}`;

    const formData = new FormData();
    formData.append('file', new Blob([fileBuffer]), fileName);
    formData.append('uploadPath', uploadPath);
    formData.append('fileName', fileName);

    const response = await proxyFetch(`${FILE_UPLOAD_BASE}/api/file-stream-upload`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Kie.ai file upload error: HTTP ${response.status} — ${text.slice(0, 200)}`);
    }

    const data = (await response.json()) as FileUploadResponse;

    if (data.code !== 200) {
      throw new Error(`Kie.ai file upload failed: ${data.msg}`);
    }

    return data.data.url;
  }
}
