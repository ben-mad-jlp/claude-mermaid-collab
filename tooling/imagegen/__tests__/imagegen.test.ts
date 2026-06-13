import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { xaiProvider } from '../providers/xai.ts';
import { generateImage } from '../imageService.ts';

const realFetch = globalThis.fetch;

// 1x1 px fake image bytes used both as b64_json payload and as download body.
const FAKE_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const FAKE_B64 = Buffer.from(FAKE_BYTES).toString('base64');

describe('xaiProvider.generate', () => {
  let captured: { url: string; init: RequestInit } | null = null;

  beforeEach(() => {
    // Point config-service at a nonexistent file so getSecret falls back to env.
    process.env.MERMAID_CONFIG_PATH = join(tmpdir(), 'imagegen-no-such-config.json');
    process.env.XAI_API_KEY = 'test-key-123';
    captured = null;
    globalThis.fetch = (async (url: any, init: any) => {
      captured = { url: String(url), init };
      return new Response(
        JSON.stringify({
          data: [{ b64_json: FAKE_B64, mime_type: 'image/jpeg' }],
          usage: { cost_in_usd_ticks: 500000000 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('builds the correct request and parses the response', async () => {
    const res = await xaiProvider.generate('a red dot', {
      outDir: '/tmp/unused',
      basename: 'x',
      model: 'grok-imagine-image-quality',
      n: 1,
    });

    // Request shape.
    expect(captured!.url).toBe('https://api.x.ai/v1/images/generations');
    expect((captured!.init.headers as any).Authorization).toBe('Bearer test-key-123');
    expect((captured!.init.headers as any)['Content-Type']).toBe('application/json');
    const body = JSON.parse(captured!.init.body as string);
    expect(body.model).toBe('grok-imagine-image-quality');
    expect(body.prompt).toBe('a red dot');
    expect(body.n).toBe(1);
    expect(body.response_format).toBe('b64_json');

    // Response parsing.
    expect(res.model).toBe('grok-imagine-image-quality');
    expect(res.costUsd).toBeCloseTo(0.05, 6);
    expect(res.images).toHaveLength(1);
    expect(res.images[0].mimeType).toBe('image/jpeg');
    expect(res.images[0].bytes).toEqual(FAKE_BYTES);
  });

  it('forwards aspect_ratio and resolution when provided', async () => {
    await xaiProvider.generate('a red dot', {
      outDir: '/tmp/unused',
      basename: 'x',
      aspectRatio: '16:9',
      resolution: '2k',
    });
    const body = JSON.parse(captured!.init.body as string);
    expect(body.aspect_ratio).toBe('16:9');
    expect(body.resolution).toBe('2k');
  });
});

describe('generateImage (service)', () => {
  let dir: string;

  beforeEach(() => {
    // Point config-service at a nonexistent file so getSecret falls back to env.
    process.env.MERMAID_CONFIG_PATH = join(tmpdir(), 'imagegen-no-such-config.json');
    process.env.XAI_API_KEY = 'test-key-123';
    dir = mkdtempSync(join(tmpdir(), 'imagegen-test-'));
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes the image file and a well-formed .meta.json (url download path)', async () => {
    // Provider returns a url; service must download it.
    globalThis.fetch = (async (url: any) => {
      const u = String(url);
      if (u.includes('api.x.ai')) {
        return new Response(
          JSON.stringify({
            data: [{ url: 'https://imgen.x.ai/temp.jpg', mime_type: 'image/jpeg' }],
            usage: { cost_in_usd_ticks: 500000000 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      // download
      return new Response(FAKE_BYTES, { status: 200 });
    }) as typeof fetch;

    const res = await generateImage('a friendly octopus', {
      outDir: dir,
      basename: 'octo',
      task: 'icon',
    });

    expect(res.files).toHaveLength(1);
    expect(res.metaFiles).toHaveLength(1);
    expect(res.costUsd).toBeCloseTo(0.05, 6);

    const imgPath = join(dir, 'octo.jpg');
    const metaPath = join(dir, 'octo.meta.json');
    expect(existsSync(imgPath)).toBe(true);
    expect(res.files[0]).toBe(imgPath);

    const bytes = readFileSync(imgPath);
    expect(new Uint8Array(bytes)).toEqual(FAKE_BYTES);

    const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
    expect(meta.provider).toBe('xai');
    expect(meta.prompt).toBe('a friendly octopus');
    expect(meta.finalPrompt).toContain('simple flat icon');
    expect(meta.finalPrompt).toContain('a friendly octopus');
    expect(meta.mimeType).toBe('image/jpeg');
    expect(meta.costUsd).toBeCloseTo(0.05, 6);
    expect(meta.sourceUrl).toBe('https://imgen.x.ai/temp.jpg');
    expect(typeof meta.createdAt).toBe('string');
    expect(meta.opts.basename).toBe('octo');
  });
});
