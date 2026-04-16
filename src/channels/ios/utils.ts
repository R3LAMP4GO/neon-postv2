import fs from 'fs';

/** Convert desktop file paths to data URIs so iOS can display them */
export function convertMediaToDataUris(
  media?: Array<{ type: string; filePath: string; mimeType: string }>
): Array<{ type: string; filePath: string; mimeType: string }> | undefined {
  if (!media || media.length === 0) return media;
  return media.map((m) => {
    try {
      if (!fs.existsSync(m.filePath)) return m;
      const data = fs.readFileSync(m.filePath);
      const b64 = data.toString('base64');
      return { ...m, filePath: `data:${m.mimeType};base64,${b64}` };
    } catch {
      return m;
    }
  });
}
