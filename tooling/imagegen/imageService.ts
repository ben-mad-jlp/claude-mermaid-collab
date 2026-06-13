import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyTaskPreset } from './prompts.ts';
import { xaiProvider } from './providers/xai.ts';
import type { GenOptions, ImageProvider } from './providers/types.ts';

const PROVIDERS: Record<string, ImageProvider> = {
  xai: xaiProvider,
};

function extForMime(mimeType: string): string {
  if (mimeType.includes('png')) return 'png';
  if (mimeType.includes('jpeg') || mimeType.includes('jpg')) return 'jpg';
  if (mimeType.includes('webp')) return 'webp';
  if (mimeType.includes('gif')) return 'gif';
  // Fallback: take the subtype after the slash.
  const sub = mimeType.split('/')[1];
  return sub ? sub.replace(/[^a-z0-9]/gi, '') || 'bin' : 'bin';
}

export interface GenerateImageResult {
  files: string[];
  metaFiles: string[];
  costUsd: number;
}

/**
 * Generate one or more images and persist them (plus sidecar provenance) to disk.
 *
 * Reproducibility note: the providers expose no usable seed, so the sidecar
 * `.meta.json` IS the provenance record — it captures the exact prompt, final
 * prompt, options, model and cost for every image.
 */
export async function generateImage(
  prompt: string,
  opts: GenOptions,
): Promise<GenerateImageResult> {
  const providerId = opts.provider ?? 'xai';
  const provider = PROVIDERS[providerId];
  if (!provider) {
    throw new Error(`Unknown image provider: ${providerId} (known: ${Object.keys(PROVIDERS).join(', ')})`);
  }

  const finalPrompt = applyTaskPreset(prompt, opts.task);

  const result = await provider.generate(finalPrompt, opts);

  mkdirSync(opts.outDir, { recursive: true });

  const files: string[] = [];
  const metaFiles: string[] = [];
  const createdAt = new Date().toISOString();
  const multiple = result.images.length > 1;

  for (let i = 0; i < result.images.length; i++) {
    const img = result.images[i];

    // Get bytes: prefer returned bytes, else download the temporary url NOW.
    let bytes: Uint8Array;
    if (img.bytes) {
      bytes = img.bytes;
    } else if (img.url) {
      const dl = await fetch(img.url);
      if (!dl.ok) {
        throw new Error(`Failed to download image url: ${dl.status} ${dl.statusText}`);
      }
      bytes = new Uint8Array(await dl.arrayBuffer());
    } else {
      throw new Error('Provider returned an image with neither bytes nor url.');
    }

    const ext = extForMime(img.mimeType);
    const suffix = multiple ? `-${i}` : '';
    const stem = `${opts.basename}${suffix}`;
    const imgPath = join(opts.outDir, `${stem}.${ext}`);
    const metaPath = join(opts.outDir, `${stem}.meta.json`);

    writeFileSync(imgPath, bytes);

    const meta = {
      provider: providerId,
      model: result.model,
      prompt,
      finalPrompt,
      opts,
      costUsd: result.costUsd,
      mimeType: img.mimeType,
      createdAt,
      sourceUrl: img.url ?? null,
    };
    writeFileSync(metaPath, JSON.stringify(meta, null, 2));

    files.push(imgPath);
    metaFiles.push(metaPath);
  }

  return { files, metaFiles, costUsd: result.costUsd };
}
