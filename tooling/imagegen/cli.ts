#!/usr/bin/env bun
import { generateImage } from './imageService.ts';
import type { GenOptions, ImageTask } from './providers/types.ts';

/**
 * Usage:
 *   bun run tooling/imagegen/cli.ts "<prompt>" --out <dir> --basename <name> \
 *     [--provider xai] [--task icon] [--model grok-imagine-image-quality] \
 *     [--n 1] [--aspect 16:9] [--resolution 2k] \
 *     [--postprocess removeBg,downscale] [--pack] [--key-color 00b140] \
 *     [--tolerance 100] [--pixel-height 64] [--palette 32]
 */
function parseArgs(argv: string[]): { prompt: string; flags: Record<string, string> } {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = 'true';
      }
    } else {
      positional.push(a);
    }
  }
  return { prompt: positional.join(' '), flags };
}

async function main() {
  const { prompt, flags } = parseArgs(process.argv.slice(2));

  if (!prompt || !flags.out || !flags.basename) {
    console.error(
      'Usage: bun run tooling/imagegen/cli.ts "<prompt>" --out <dir> --basename <name> ' +
        '[--provider xai] [--task icon] [--model <id>] [--n 1] [--aspect 16:9] [--resolution 2k]',
    );
    process.exit(1);
  }

  const opts: GenOptions = {
    outDir: flags.out,
    basename: flags.basename,
    provider: (flags.provider as GenOptions['provider']) ?? 'xai',
    task: flags.task as ImageTask | undefined,
    model: flags.model,
    n: flags.n ? Number(flags.n) : undefined,
    aspectRatio: flags.aspect,
    resolution: flags.resolution as GenOptions['resolution'],
  };

  // IMG P3 post-processing flags.
  if (flags.postprocess) {
    opts.postprocess = flags.postprocess
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean) as GenOptions['postprocess'];
  }
  if (flags.pack === 'true') {
    opts.postprocess = [...(opts.postprocess ?? []), 'pack'];
  }
  if (flags['key-color']) opts.keyColor = flags['key-color'];
  if (flags.tolerance) opts.tolerance = Number(flags.tolerance);
  if (flags['pixel-height']) opts.pixelHeight = Number(flags['pixel-height']);
  // --palette accepts either an N-color count (e.g. 32) or a fixed hex list
  // (e.g. '#1a1c2c,#5d275d,#b13e53') for a cohesive cross-asset look.
  if (flags.palette) {
    opts.palette = flags.palette.includes(',') || /[a-fA-F#]/.test(flags.palette)
      ? flags.palette.split(',').map((s) => s.trim()).filter(Boolean)
      : Number(flags.palette);
  }

  const res = await generateImage(prompt, opts);
  const { files, metaFiles, costUsd, spriteFiles, sheetPath, manifestPath } = res;

  console.log('Saved images:');
  for (const f of files) console.log(`  ${f}`);
  if (spriteFiles?.length) {
    console.log('Processed sprites:');
    for (const f of spriteFiles) console.log(`  ${f}`);
  }
  if (sheetPath) {
    console.log(`Sprite sheet: ${sheetPath}`);
    console.log(`Sheet manifest: ${manifestPath}`);
  }
  console.log('Sidecar metadata:');
  for (const m of metaFiles) console.log(`  ${m}`);
  console.log(`Total cost: $${costUsd.toFixed(4)}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
