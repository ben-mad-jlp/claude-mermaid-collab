# imagegen (IMG P1)

Provider-agnostic image-generation service for icons / one-off assets. Standalone
`tooling/` module (not wired into the server/MCP yet). No npm deps — uses global
`fetch` + `node:fs`/`node:path` only. Run with `bun`.

## Usage

```bash
bun run tooling/imagegen/cli.ts "<prompt>" --out <dir> --basename <name> \
  [--provider xai] [--task icon] [--model grok-imagine-image-quality] \
  [--n 1] [--aspect 16:9] [--resolution 2k]
```

Example (flat app icon):

```bash
bun run tooling/imagegen/cli.ts "a friendly cartoon octopus" \
  --task icon --out /tmp/imagegen-p1 --basename octopus-icon
```

Each generated image lands at `outDir/basename[-i].<ext>` with a sidecar
`outDir/basename[-i].meta.json` capturing provider, model, prompt, finalPrompt,
opts, costUsd, mimeType, createdAt and sourceUrl. There is no usable seed, so the
sidecar metadata IS the provenance / reproducibility record.

Programmatic:

```ts
import { generateImage } from './imageService.ts';
const { files, metaFiles, costUsd } = await generateImage('a red fox', {
  outDir: '/tmp/out', basename: 'fox', task: 'icon',
});
```

## Tasks

`applyTaskPreset(prompt, task)`:
- `icon` → wraps as "simple flat icon, &lt;subject&gt;, clean vector-like edges,
  solid colors, minimal shading, centered, white background, square, app icon
  style, no text".
- `sprite` / `concept` / `prop` → pass-through (reserved for later presets).

## xAI (Grok Imagine) — verified API notes

Probed live against the endpoint on 2026-06-12.

- `POST https://api.x.ai/v1/images/generations`
- Headers: `Authorization: Bearer $XAI_API_KEY`, `Content-Type: application/json`
- Body: `{ model, prompt, n, ... }`
- Response: `{ data: [ { url | b64_json, mime_type } ], usage: { cost_in_usd_ticks } }`
- `cost_in_usd_ticks * 1e-10 = USD` (5e8 ticks = $0.05).
- Default output: **1024×1024 image/jpeg**. The `url` is a TEMPORARY asset on
  `imgen.x.ai` — download it immediately (the service does).
- Models: `grok-imagine-image-quality` (default, higher quality),
  `grok-imagine-image`.

The key is read via `getSecret('XAI_API_KEY')` (config.json authoritative, env
fallback) from `src/services/config-service.ts`.

### Unverified design-doc params — probe findings

All four were accepted (HTTP 200, no error). Real effects observed:

| param | result |
| --- | --- |
| `response_format: 'b64_json'` | **WORKS.** `data[0]` returns `{ b64_json, mime_type }` instead of `url`. The provider sends this by default so no download is needed. |
| `aspect_ratio: '16:9'` | **Took effect.** Output became **1280×720** (vs default 1024×1024 at 1:1). Cost unchanged ($0.05). |
| `resolution: '2k'` | **Took effect.** Output became **2048×2048 image/PNG**, cost rose to 7e8 ticks (**$0.07**) vs `1k`'s 5e8 ($0.05). `1k` is the implicit default. |
| `seed: <int>` | **Accepted** (HTTP 200, no error). Determinism effect not separately confirmed; no `seed` field is exposed in P1 `GenOptions`. |
