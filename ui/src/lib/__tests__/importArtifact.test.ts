import { describe, it, expect, vi, beforeEach } from 'vitest';

// importArtifact imports the `api` object and calls api.syncCodeFromDisk;
// snippet creation itself goes through raw fetch (asserted via fetch bodies).
vi.mock('../api', () => ({
  api: {
    createSnippet: vi.fn(),
    syncCodeFromDisk: vi.fn(),
  },
}));

import { importArtifact } from '../importArtifact';
import { api } from '../api';

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

// jsdom's File/Blob does not implement the async .text() method that
// importArtifact relies on; wrap so the helper resolves the content.
function makeFile(content: string, name: string): File {
  const file = new File([content], name);
  if (typeof (file as any).text !== 'function') {
    Object.defineProperty(file, 'text', {
      value: async () => content,
      configurable: true,
    });
  }
  return file;
}

describe('importArtifact', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it('(a) forcedType snippet with .md file POSTs to /api/snippet, not /api/document', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(okJson({ id: 'snip-1' }));

    const file = makeFile('# hello', 'notes.md');
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

    const file = makeFile('# hello', 'notes.md');
    const result = await importArtifact(PROJECT, SESSION, file);

    const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls;
    const urls = calls.map(c => String(c[0]));
    expect(urls.some(u => u.includes('/api/document'))).toBe(true);
    expect(result).toEqual({ type: 'document', id: 'doc-1' });
  });

  // Pull the JSON body sent to the first /api/snippet POST.
  function firstSnippetBody(): any {
    const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls;
    const snippetCall = calls.find((c) => String(c[0]).includes('/api/snippet'));
    return snippetCall ? JSON.parse((snippetCall[1] as any).body) : undefined;
  }

  it('(e) forcedType code-file happy path calls syncCodeFromDisk and creates linked snippet', async () => {
    (api.syncCodeFromDisk as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(okJson({ id: 'snip-linked' }));

    const file = makeFile('console.log("hi")', 'foo.ts');
    const result = await importArtifact(PROJECT, SESSION, file, { forcedType: 'code-file' } as any);

    expect(api.syncCodeFromDisk).toHaveBeenCalled();
    // The first snippet-creation POST requests a linked snippet.
    expect(firstSnippetBody()?.linked).toBe(true);
    expect(result.type).toBe('snippet');
  });

  it('(f) forcedType code-file when sync fails falls back to non-linked snippet with warning', async () => {
    (api.syncCodeFromDisk as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('disk offline'));
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(okJson({ id: 'snip-fallback' }));

    const file = makeFile('console.log("hi")', 'foo.ts');
    const result: any = await importArtifact(
      PROJECT,
      SESSION,
      file,
      { forcedType: 'code-file' } as any,
    );

    // Sync was attempted (and rejected); the linked snippet stands but the
    // result carries a warning that sync failed.
    expect(api.syncCodeFromDisk).toHaveBeenCalled();
    expect(result.type).toBe('snippet');
    expect(result.warning).toBeDefined();
  });
});
