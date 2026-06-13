import { getSecret } from '../../../src/services/config-service.ts';
import type { GenOptions, GenResult, ImageProvider } from './types.ts';

const XAI_ENDPOINT = 'https://api.x.ai/v1/images/generations';
const DEFAULT_MODEL = 'grok-imagine-image-quality';

/** xAI returns cost as integer "ticks"; 1 tick = 1e-10 USD (5e8 ticks = $0.05). */
const USD_PER_TICK = 1e-10;

/**
 * xAI (Grok Imagine) image provider.
 *
 * VERIFIED against the live endpoint (2026-06-12):
 *   POST https://api.x.ai/v1/images/generations
 *   Authorization: Bearer $XAI_API_KEY ; Content-Type: application/json
 *   body: { model, prompt, n }
 *   resp: { data: [ { url | b64_json, mime_type } ], usage: { cost_in_usd_ticks } }
 *   Default image: 1024x1024 image/jpeg. url is TEMPORARY (imgen.x.ai) — download now.
 *   Models: grok-imagine-image-quality (default, higher quality), grok-imagine-image.
 *
 * UNVERIFIED design-doc params — probed live, all accepted (HTTP 200), real effects:
 *   response_format: 'b64_json'  -> WORKS. data[0] returns { b64_json, mime_type }
 *                                   instead of url. We send this so no download is
 *                                   needed (prefer-bytes path).
 *   aspect_ratio: '16:9'         -> TOOK EFFECT. Output became 1280x720 (vs default
 *                                   1024x1024 at '1:1'). Forwarded when opts.aspectRatio set.
 *   resolution: '2k'             -> TOOK EFFECT. Output became 2048x2048 image/PNG and
 *                                   cost rose to 7e8 ticks ($0.07) vs 1k's 5e8 ($0.05).
 *                                   '1k' is the implicit default (1024 jpeg, $0.05).
 *   seed: <int>                  -> ACCEPTED (HTTP 200, no error). Effect on determinism
 *                                   not separately confirmed; forwarded when provided is
 *                                   left out of GenOptions for now (no seed field in P1).
 */
export const xaiProvider: ImageProvider = {
  id: 'xai',

  async generate(prompt: string, opts: GenOptions): Promise<GenResult> {
    const apiKey = getSecret('XAI_API_KEY') ?? process.env.XAI_API_KEY;
    if (!apiKey) {
      throw new Error('XAI_API_KEY not set (checked config.json via getSecret and env).');
    }

    const model = opts.model ?? DEFAULT_MODEL;
    const body: Record<string, unknown> = {
      model,
      prompt,
      n: opts.n ?? 1,
      // Prefer base64 so we never have to chase the temporary url.
      response_format: 'b64_json',
    };
    if (opts.aspectRatio) body.aspect_ratio = opts.aspectRatio;
    if (opts.resolution) body.resolution = opts.resolution;

    const res = await fetch(XAI_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`xAI image request failed: ${res.status} ${res.statusText} ${text}`.trim());
    }

    const json = (await res.json()) as {
      data?: Array<{ url?: string; b64_json?: string; mime_type?: string }>;
      usage?: { cost_in_usd_ticks?: number };
    };

    const data = json.data ?? [];
    const images = data.map((d) => {
      const mimeType = d.mime_type ?? 'image/jpeg';
      if (d.b64_json) {
        return { bytes: Uint8Array.from(Buffer.from(d.b64_json, 'base64')), mimeType };
      }
      return { url: d.url, mimeType };
    });

    const ticks = json.usage?.cost_in_usd_ticks ?? 0;
    const costUsd = ticks * USD_PER_TICK;

    return { images, costUsd, model, raw: json };
  },
};
