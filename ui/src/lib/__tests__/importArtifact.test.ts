import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../api', () => ({
  createSnippet: vi.fn(),
  syncCodeFromDisk: vi.fn(),
}));

import { importArtifact } from '../importArtifact';
import * as api from '../api';

const PROJECT = 'proj';
const SESSION = 'sess';

function okJson(body: unknown, init: Partial<Response> = {}) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => body,
    text: async () => JSON.stringify(body),
    ...init,
  } as unknown as Response;
}

describe('importArtifact', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it('(a) forcedType snippet with .md file POSTs to /api/snippet, not /api/document', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(okJson({ id: 'snip-1' }));

    const file = new File(['# hello'], 'notes.md');
    const result = await importArtifact(PROJECT, SESSION, file, { forcedType: 'snippet' } as any);

    const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const urls = calls.map(c => String(c[0]));
    expect(urls.some(u => u.includes('/api/snippet'))).toBe(true);
    expect(urls.some(u => u.includes('/api/document'))).toBe(false);
    expect(result).toEqual({ type: 'snippet', id: 'snip-1' });
  });

  it('(b) forcedType image with .txt throws WrongDropTarget and makes no fetch call', async () => {
    const file = new File(['hello'], 'foo.txt');
    await expect(
      importArtifact(PROJECT, SESSION, file, { forcedType: 'image' } as any),
    ).rejects.toThrow(/WrongDropTarget/);
    expect((global.fetch as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it('(c) forcedType design with .png throws WrongDropTarget', async () => {
    const file = new File([new Uint8Array([0x89, 0x50])], 'pic.png');
    await expect(
      importArtifact(PROJECT, SESSION, file, { forcedType: 'design' } as any),
    ).rejects.toThrow(/WrongDropTarget/);
    expect((global.fetch as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it('(d) no forcedType with .md file POSTs to /api/document (default behavior)', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(okJson({ id: 'doc-1' }));

    const file = new File(['# hello'], 'notes.md');
    const result = await importArtifact(PROJECT, SESSION, file);

    const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls;
    const urls = calls.map(c => String(c[0]));
    expect(urls.some(u => u.includes('/api/document'))).toBe(true);
    expect(result).toEqual({ type: 'document', id: 'doc-1' });
  });

  it('(e) forcedType code-file happy path calls syncCodeFromDisk and creates linked snippet', async () => {
    (api.syncCodeFromDisk as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });
    (api.createSnippet as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'snip-linked' });
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(okJson({ id: 'snip-linked' }));

    const file = new File(['console.log("hi")'], 'foo.ts');
    const result = await importArtifact(PROJECT, SESSION, file, { forcedType: 'code-file' } as any);

    expect(api.syncCodeFromDisk).toHaveBeenCalled();
    const createArgs = (api.createSnippet as ReturnType<typeof vi.fn>).mock.calls[0];
    const snippetPayload = createArgs?.find((a: any) => a && typeof a === 'object' && 'linked' in a)
      ?? createArgs?.[createArgs.length - 1];
    expect(snippetPayload?.linked).toBe(true);
    expect(result.type).toBe('snippet');
  });

  it('(f) forcedType code-file when sync fails falls back to non-linked snippet with warning', async () => {
    (api.syncCodeFromDisk as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('disk offline'));
    (api.createSnippet as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'snip-fallback' });
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(okJson({ id: 'snip-fallback' }));

    const file = new File(['console.log("hi")'], 'foo.ts');
    const result: any = await importArtifact(
      PROJECT,
      SESSION,
      file,
      { forcedType: 'code-file' } as any,
    );

    expect(api.syncCodeFromDisk).toHaveBeenCalled();
    const createArgs = (api.createSnippet as ReturnType<typeof vi.fn>).mock.calls[0];
    const snippetPayload = createArgs?.find((a: any) => a && typeof a === 'object' && 'linked' in a)
      ?? createArgs?.[createArgs.length - 1];
    expect(snippetPayload?.linked).not.toBe(true);
    expect(result.warning).toBeDefined();
  });
});
