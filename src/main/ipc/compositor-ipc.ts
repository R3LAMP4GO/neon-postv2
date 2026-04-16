import { ipcMain } from 'electron';
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { app } from 'electron';

import { renderPost, renderSplitCard } from '../../compositor';
import { getTemplate, listTemplates, registerFonts, getLogoPath } from '../../templates';
import { getBackgrounds } from '../../assets';
import type { AssetSource } from '../../assets';
import type { IPCDependencies } from './types';

// ---------------------------------------------------------------------------
// IPC handlers for the compositor — called by the renderer (social panel UI)
// ---------------------------------------------------------------------------

export function registerCompositorIpc(deps: IPCDependencies): void {
  const { getMemory } = deps;

  // List available templates
  ipcMain.handle('compositor:listTemplates', async () => {
    try {
      return listTemplates().map((t) => ({
        id: t.id,
        name: t.name,
        format: t.format,
        textPosition: t.text.position,
        uppercase: t.text.uppercase,
        hasCta: t.cta.enabled,
        ctaText: t.cta.enabled ? t.cta.text : null,
      }));
    } catch (err) {
      console.error('[CompositorIPC] listTemplates error:', err);
      return [];
    }
  });

  // Render a single post image
  ipcMain.handle(
    'compositor:renderPost',
    async (
      _,
      opts: {
        headline: string;
        backgroundPath: string;
        templateId?: string;
        ctaText?: string;
        brandName?: string;
        platform?: string;
      }
    ) => {
      try {
        registerFonts();

        const tid = opts.templateId || 'headline-center';
        const tmpl = getTemplate(tid);
        if (!tmpl) return { error: `Unknown template: ${tid}` };
        if (!existsSync(opts.backgroundPath)) return { error: `Background not found: ${opts.backgroundPath}` };

        const logoPath = opts.brandName ? undefined : getLogoPath('wordmark');
        const brandHandle = opts.brandName || undefined;

        const renderFn = tid === 'split-card' ? renderSplitCard : renderPost;
        const result = await renderFn({
          headline: opts.headline,
          background: opts.backgroundPath,
          template: tmpl,
          logoPath: logoPath && existsSync(logoPath) ? logoPath : undefined,
          ctaText: opts.ctaText,
          brandHandle,
        });

        // Save to disk
        const mediaDir = join(app.getPath('documents'), 'Neon-post', 'media');
        if (!existsSync(mediaDir)) mkdirSync(mediaDir, { recursive: true });
        const fileName = `post-${randomUUID().slice(0, 8)}.jpg`;
        const filePath = join(mediaDir, fileName);
        writeFileSync(filePath, result.buffer);

        // Save to gallery DB
        const memory = getMemory();
        if (memory) {
          memory.generatedContent.create({
            content_type: 'image',
            platform: opts.platform ?? null,
            prompt_used: opts.headline,
            output: opts.headline,
            media_url: filePath,
            metadata: JSON.stringify({
              template: tid,
              width: result.width,
              height: result.height,
              generated_by: 'compositor',
            }),
          });
        }

        return { success: true, filePath, width: result.width, height: result.height };
      } catch (err) {
        console.error('[CompositorIPC] renderPost error:', err);
        return { error: err instanceof Error ? err.message : String(err) };
      }
    }
  );

  // Search for background images
  ipcMain.handle(
    'compositor:fetchBackgrounds',
    async (_, opts: { source: string; query: string; orientation?: string; count?: number }) => {
      try {
        const assets = await getBackgrounds(opts.source as AssetSource, {
          query: opts.query,
          orientation: opts.orientation as 'landscape' | 'portrait' | 'square' | undefined,
          count: Math.min(opts.count ?? 5, 20),
        });

        return assets.map((a) => ({
          id: a.id,
          source: a.source,
          localPath: a.localPath,
          width: a.width,
          height: a.height,
          attribution: a.attribution,
        }));
      } catch (err) {
        console.error('[CompositorIPC] fetchBackgrounds error:', err);
        return { error: err instanceof Error ? err.message : String(err) };
      }
    }
  );
}
