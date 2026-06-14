import { getSecret } from '../../../src/services/config-service.ts';

/**
 * xAI (Grok Imagine) image->video provider.
 *
 * VERIFIED live (2026-06-14):
 *   POST https://api.x.ai/v1/videos/generations
 *     body: { model, prompt, image: { url: <http url | data: url> } }   // image MUST be an object {url}; b64_json rejected
 *     -> 200 { request_id }   (ASYNC)
 *   Poll GET https://api.x.ai/v1/videos/{request_id}
 *     -> 202 { status: 'pending', progress }
 *     -> 200 { status: 'done', video: { url, duration }, usage: { cost_in_usd_ticks } }   // status is 'done', NOT 'completed'
 *   video.url is a TEMPORARY asset on vidgen.x.ai — download immediately.
 *   cost = cost_in_usd_ticks * 1e-10 USD.
 *
 * MODELS:
 *   grok-imagine-video            text+image, ~$0.40/8s, stronger prompt steering (use for actions + turntable orbit)
 *   grok-imagine-video-1.5-preview image-only, ~$0.65/8s, ultra-stable identity, weak steering
 */
const SUBMIT = 'https://api.x.ai/v1/videos/generations';
const POLL = (id: string) => `https://api.x.ai/v1/videos/${id}`;
const USD_PER_TICK = 1e-10;
export const DEFAULT_VIDEO_MODEL = 'grok-imagine-video';

export interface VideoGenOptions {
  /** xAI video model id. Default grok-imagine-video. */
  model?: string;
  /** Seed image as a data: URL or http URL. REQUIRED (1.5-preview has no text-to-video). */
  seedImageUrl: string;
  /** Poll interval ms (default 3000). */
  pollMs?: number;
  /** Max wait ms before giving up (default 240000 = 4 min). */
  maxWaitMs?: number;
}

export interface VideoGenResult {
  bytes: Uint8Array;
  mimeType: 'video/mp4';
  costUsd: number;
  model: string;
  durationSec: number;
}

export async function generateVideo(prompt: string, opts: VideoGenOptions): Promise<VideoGenResult> {
  const apiKey = getSecret('XAI_API_KEY') ?? process.env.XAI_API_KEY;
  if (!apiKey) throw new Error('XAI_API_KEY not set (checked config.json via getSecret and env).');
  const model = opts.model ?? DEFAULT_VIDEO_MODEL;
  const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };

  const sub = await fetch(SUBMIT, {
    method: 'POST', headers,
    body: JSON.stringify({ model, prompt, image: { url: opts.seedImageUrl } }),
  });
  if (!sub.ok) {
    const t = await sub.text().catch(() => '');
    throw new Error(`xAI video submit failed: ${sub.status} ${sub.statusText} ${t}`.trim());
  }
  const { request_id: id } = (await sub.json()) as { request_id?: string };
  if (!id) throw new Error('xAI video submit returned no request_id');

  const pollMs = opts.pollMs ?? 3000;
  const maxWaitMs = opts.maxWaitMs ?? 240000;
  const deadline = Date.now() + maxWaitMs;
  let videoUrl = '', durationSec = 8, ticks = 0;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollMs));
    const g = await fetch(POLL(id), { headers: { Authorization: `Bearer ${apiKey}` } });
    const j = (await g.json()) as any;
    if (j.status === 'done' || j.video?.url) {
      videoUrl = j.video?.url ?? j.url;
      durationSec = j.video?.duration ?? 8;
      ticks = j.usage?.cost_in_usd_ticks ?? 0;
      break;
    }
    if (j.status === 'failed' || j.error) throw new Error(`xAI video failed: ${JSON.stringify(j)}`);
  }
  if (!videoUrl) throw new Error(`xAI video timed out after ${maxWaitMs}ms (request ${id})`);

  const dl = await fetch(videoUrl);
  if (!dl.ok) throw new Error(`failed to download video: ${dl.status} ${dl.statusText}`);
  const bytes = new Uint8Array(await dl.arrayBuffer());
  return { bytes, mimeType: 'video/mp4', costUsd: ticks * USD_PER_TICK, model, durationSec };
}
