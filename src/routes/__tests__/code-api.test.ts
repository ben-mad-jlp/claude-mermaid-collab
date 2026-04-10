import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { rm, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { SnippetManager } from '../../services/snippet-manager';
import { sessionRegistry } from '../../services/session-registry';
import { projectRegistry } from '../../services/project-registry';
import { handleCodeAPI } from '../code-api';

/**
 * Tests for the /api/code/proposed-edit endpoints added in Phase 2.
 *
 * Covers create/replace, accept, reject — plus not-linked and missing-snippet guards.
 */

const TEST_PROJECT = join(homedir(), '.test-collab-code-api');
const TEST_SESSION = 'test-session';

function buildUrl(path: string): string {
  const base = `http://localhost:3737/api/code${path}`;
  const sep = path.includes('?') ? '&' : '?';
  return `${base}${sep}project=${encodeURIComponent(TEST_PROJECT)}&session=${encodeURIComponent(TEST_SESSION)}`;
}

function makeLinkedEnvelope(code: string, overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    code,
    language: 'typescript',
    filePath: join(TEST_PROJECT, 'src', 'sample.ts'),
    originalCode: code,
    diskCode: code,
    linked: true,
    linkCreatedAt: Date.now(),
    lastPushedAt: null,
    lastSyncedAt: Date.now(),
    dirty: false,
    ...overrides,
  }, null, 2);
}

async function createLinkedSnippet(manager: SnippetManager, name: string, code: string): Promise<string> {
  return await manager.createSnippet(name, makeLinkedEnvelope(code));
}

async function getEnvelope(manager: SnippetManager, id: string): Promise<any> {
  const snippet = await manager.getSnippet(id);
  if (!snippet) throw new Error(`Snippet ${id} not found`);
  return JSON.parse(snippet.content);
}

describe('Code API — /proposed-edit endpoints', () => {
  let manager: SnippetManager;
  let snippetsPath: string;

  beforeAll(async () => {
    await sessionRegistry.register(TEST_PROJECT, TEST_SESSION);
    snippetsPath = sessionRegistry.resolvePath(TEST_PROJECT, TEST_SESSION, 'snippets');
    // Create a dummy source file location so the filePath is semantically valid.
    await mkdir(join(TEST_PROJECT, 'src'), { recursive: true });
    await writeFile(join(TEST_PROJECT, 'src', 'sample.ts'), 'const x = 1;\n');
  });

  afterAll(async () => {
    try {
      await rm(TEST_PROJECT, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  beforeEach(async () => {
    manager = new SnippetManager(snippetsPath);
    await manager.initialize();
    // Clean slate — delete all existing snippets from prior tests.
    const all = await manager.listSnippets();
    for (const s of all) {
      await manager.deleteSnippet(s.id);
    }
  });

  describe('POST /proposed-edit/:id (create/replace)', () => {
    it('creates proposedEdit on a linked snippet (happy path)', async () => {
      const id = await createLinkedSnippet(manager, 'sample.ts', 'const x = 1;\n');

      const req = new Request(buildUrl(`/proposed-edit/${encodeURIComponent(id)}`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newCode: 'const x = 2;\n', message: 'bump value' }),
      });
      const res = await handleCodeAPI(req);
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.success).toBe(true);
      expect(body.hasProposedEdit).toBe(true);

      const env = await getEnvelope(manager, id);
      expect(env.proposedEdit).toBeDefined();
      expect(env.proposedEdit.newCode).toBe('const x = 2;\n');
      expect(env.proposedEdit.message).toBe('bump value');
      expect(env.proposedEdit.proposedBy).toBe('claude');
      expect(typeof env.proposedEdit.proposedAt).toBe('number');
    });

    it('returns 400 when snippet is not linked', async () => {
      const id = await manager.createSnippet('plain', JSON.stringify({ code: 'plain text', linked: false }));

      const req = new Request(buildUrl(`/proposed-edit/${encodeURIComponent(id)}`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newCode: 'anything' }),
      });
      const res = await handleCodeAPI(req);
      expect(res.status).toBe(400);
      const body = await res.json() as any;
      expect(body.error).toMatch(/not linked/i);
    });

    it('returns 404 when snippet is missing', async () => {
      const req = new Request(buildUrl(`/proposed-edit/nonexistent`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newCode: 'anything' }),
      });
      const res = await handleCodeAPI(req);
      expect(res.status).toBe(404);
    });

    it('returns 400 when newCode is missing', async () => {
      const id = await createLinkedSnippet(manager, 'sample.ts', 'const x = 1;\n');

      const req = new Request(buildUrl(`/proposed-edit/${encodeURIComponent(id)}`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'no code' }),
      });
      const res = await handleCodeAPI(req);
      expect(res.status).toBe(400);
    });

    it('replaces an existing proposedEdit silently', async () => {
      const id = await createLinkedSnippet(manager, 'sample.ts', 'const x = 1;\n');

      // First proposal
      const req1 = new Request(buildUrl(`/proposed-edit/${encodeURIComponent(id)}`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newCode: 'const x = 2;\n', message: 'first' }),
      });
      await handleCodeAPI(req1);

      // Second proposal overwrites
      const req2 = new Request(buildUrl(`/proposed-edit/${encodeURIComponent(id)}`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newCode: 'const x = 3;\n', message: 'second' }),
      });
      const res = await handleCodeAPI(req2);
      expect(res.status).toBe(200);

      const env = await getEnvelope(manager, id);
      expect(env.proposedEdit.newCode).toBe('const x = 3;\n');
      expect(env.proposedEdit.message).toBe('second');
    });

    it('returns noop when newCode matches current code', async () => {
      const id = await createLinkedSnippet(manager, 'sample.ts', 'const x = 1;\n');

      const req = new Request(buildUrl(`/proposed-edit/${encodeURIComponent(id)}`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newCode: 'const x = 1;\n' }),
      });
      const res = await handleCodeAPI(req);
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.noop).toBe(true);

      const env = await getEnvelope(manager, id);
      expect(env.proposedEdit).toBeUndefined();
    });
  });

  describe('POST /proposed-edit/:id/accept', () => {
    it('moves newCode into envelope.code, sets dirty, clears proposedEdit', async () => {
      const id = await createLinkedSnippet(manager, 'sample.ts', 'const x = 1;\n');

      // Stage a proposal.
      await handleCodeAPI(new Request(buildUrl(`/proposed-edit/${encodeURIComponent(id)}`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newCode: 'const x = 42;\n' }),
      }));

      const res = await handleCodeAPI(new Request(buildUrl(`/proposed-edit/${encodeURIComponent(id)}/accept`), {
        method: 'POST',
      }));
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.success).toBe(true);
      expect(body.dirty).toBe(true);

      const env = await getEnvelope(manager, id);
      expect(env.code).toBe('const x = 42;\n');
      expect(env.dirty).toBe(true);
      expect(env.proposedEdit).toBeUndefined();
    });

    it('returns 400 when no proposal is pending', async () => {
      const id = await createLinkedSnippet(manager, 'sample.ts', 'const x = 1;\n');

      const res = await handleCodeAPI(new Request(buildUrl(`/proposed-edit/${encodeURIComponent(id)}/accept`), {
        method: 'POST',
      }));
      expect(res.status).toBe(400);
      const body = await res.json() as any;
      expect(body.error).toMatch(/no proposed edit/i);
    });

    it('returns 400 when snippet is not linked', async () => {
      const id = await manager.createSnippet('plain', JSON.stringify({ code: 'plain text', linked: false }));

      const res = await handleCodeAPI(new Request(buildUrl(`/proposed-edit/${encodeURIComponent(id)}/accept`), {
        method: 'POST',
      }));
      expect(res.status).toBe(400);
    });

    it('returns 404 when snippet is missing', async () => {
      const res = await handleCodeAPI(new Request(buildUrl(`/proposed-edit/nonexistent/accept`), {
        method: 'POST',
      }));
      expect(res.status).toBe(404);
    });
  });

  describe('POST /proposed-edit/:id/reject', () => {
    it('clears proposedEdit without touching other envelope fields', async () => {
      const id = await createLinkedSnippet(manager, 'sample.ts', 'const x = 1;\n');

      await handleCodeAPI(new Request(buildUrl(`/proposed-edit/${encodeURIComponent(id)}`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newCode: 'const x = 99;\n' }),
      }));

      const before = await getEnvelope(manager, id);
      expect(before.proposedEdit).toBeDefined();

      const res = await handleCodeAPI(new Request(buildUrl(`/proposed-edit/${encodeURIComponent(id)}/reject`), {
        method: 'POST',
      }));
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.success).toBe(true);

      const after = await getEnvelope(manager, id);
      expect(after.proposedEdit).toBeUndefined();
      expect(after.code).toBe('const x = 1;\n');
      expect(after.dirty).toBe(false);
    });

    it('is idempotent when no proposal pending (200 noop)', async () => {
      const id = await createLinkedSnippet(manager, 'sample.ts', 'const x = 1;\n');

      const res = await handleCodeAPI(new Request(buildUrl(`/proposed-edit/${encodeURIComponent(id)}/reject`), {
        method: 'POST',
      }));
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.success).toBe(true);
      expect(body.noop).toBe(true);
    });

    it('returns 400 when snippet is not linked', async () => {
      const id = await manager.createSnippet('plain', JSON.stringify({ code: 'plain text', linked: false }));

      const res = await handleCodeAPI(new Request(buildUrl(`/proposed-edit/${encodeURIComponent(id)}/reject`), {
        method: 'POST',
      }));
      expect(res.status).toBe(400);
    });

    it('returns 404 when snippet is missing', async () => {
      const res = await handleCodeAPI(new Request(buildUrl(`/proposed-edit/nonexistent/reject`), {
        method: 'POST',
      }));
      expect(res.status).toBe(404);
    });
  });
});

describe('Code API — POST /search', () => {
  let manager: SnippetManager;
  let snippetsPath: string;

  beforeAll(async () => {
    await sessionRegistry.register(TEST_PROJECT, TEST_SESSION);
    snippetsPath = sessionRegistry.resolvePath(TEST_PROJECT, TEST_SESSION, 'snippets');
    await mkdir(join(TEST_PROJECT, 'src'), { recursive: true });
    await writeFile(join(TEST_PROJECT, 'src', 'sample.ts'), 'const x = 1;\n');
  });

  afterAll(async () => {
    try {
      await rm(TEST_PROJECT, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  beforeEach(async () => {
    manager = new SnippetManager(snippetsPath);
    await manager.initialize();
    const all = await manager.listSnippets();
    for (const s of all) {
      await manager.deleteSnippet(s.id);
    }
  });

  it('returns 400 when query is missing', async () => {
    const req = new Request(buildUrl('/search'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const res = await handleCodeAPI(req);
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toMatch(/query/i);
  });

  it('returns 400 when query is empty string', async () => {
    const req = new Request(buildUrl('/search'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '' }),
    });
    const res = await handleCodeAPI(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 when query is whitespace only', async () => {
    const req = new Request(buildUrl('/search'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '   ' }),
    });
    const res = await handleCodeAPI(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 when session query param is missing', async () => {
    // Build URL without session
    const url = `http://localhost:3737/api/code/search?project=${encodeURIComponent(TEST_PROJECT)}`;
    const req = new Request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'foo' }),
    });
    const res = await handleCodeAPI(req);
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toMatch(/session/i);
  });

  it('returns code results when query hits linked snippet content', async () => {
    const id = await createLinkedSnippet(manager, 'auth.ts', 'function handleLogin() { return true; }\n');

    const req = new Request(buildUrl('/search'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'handleLogin' }),
    });
    const res = await handleCodeAPI(req);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.results.length).toBeGreaterThanOrEqual(1);
    expect(body.results[0].kind).toBe('code');
    expect(body.results[0].snippetId).toBe(id);
    expect(body.results[0].line).toBe(1);
    expect(body.results[0].snippet).toContain('<mark>handleLogin</mark>');
    expect(body.truncated).toBe(false);
  });

  it('returns empty results when nothing matches', async () => {
    await createLinkedSnippet(manager, 'sample.ts', 'const x = 1;\n');

    const req = new Request(buildUrl('/search'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'zzznomatchzzz' }),
    });
    const res = await handleCodeAPI(req);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.results).toEqual([]);
    expect(body.truncated).toBe(false);
  });

  it('truncates when results exceed limit', async () => {
    // Create a snippet with many matches
    const code = 'foo '.repeat(60); // 60 occurrences
    await createLinkedSnippet(manager, 'many.ts', code);

    const req = new Request(buildUrl('/search'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'foo', limit: 10 }),
    });
    const res = await handleCodeAPI(req);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.results.length).toBe(10);
    expect(body.truncated).toBe(true);
  });

  it('HTML-escapes match context to prevent injection', async () => {
    await createLinkedSnippet(manager, 'xss.ts', '<script>alert(1)</script> findme here\n');

    const req = new Request(buildUrl('/search'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'findme' }),
    });
    const res = await handleCodeAPI(req);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.results.length).toBe(1);
    const excerpt: string = body.results[0].snippet;
    expect(excerpt).not.toContain('<script>');
    expect(excerpt).toContain('&lt;script&gt;');
    expect(excerpt).toContain('<mark>findme</mark>');
  });

  it('skips snippets with non-JSON content', async () => {
    await manager.createSnippet('broken', 'not valid json');
    const id = await createLinkedSnippet(manager, 'good.ts', 'const findme = 1;\n');

    const req = new Request(buildUrl('/search'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'findme' }),
    });
    const res = await handleCodeAPI(req);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    // Should NOT throw, and should include the valid snippet's match
    expect(body.results.some((r: any) => r.snippetId === id)).toBe(true);
  });

  it('skips non-linked snippets', async () => {
    // Create a non-linked snippet with matching content
    await manager.createSnippet('plain', JSON.stringify({ code: 'findme here', linked: false }));

    const req = new Request(buildUrl('/search'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'findme' }),
    });
    const res = await handleCodeAPI(req);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.results).toEqual([]);
  });
});

describe('Code API — GET /files (listProjectFiles)', () => {
  const FILES_PROJECT = join(homedir(), '.test-collab-files');
  const FILES_SESSION = 'test-session';

  function buildFilesUrl(params: Record<string, string | undefined>): string {
    const usp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) usp.set(k, v);
    }
    return `http://localhost:3737/api/code/files?${usp.toString()}`;
  }

  beforeAll(async () => {
    // Create a real project tree and register it so isKnownProject() passes.
    await mkdir(join(FILES_PROJECT, 'src'), { recursive: true });
    await mkdir(join(FILES_PROJECT, 'src', 'routes'), { recursive: true });
    await writeFile(join(FILES_PROJECT, 'src', 'index.ts'), 'export {};\n');
    await writeFile(join(FILES_PROJECT, 'README.md'), '# test\n');

    await projectRegistry.register(FILES_PROJECT);
    await sessionRegistry.register(FILES_PROJECT, FILES_SESSION);
  });

  afterAll(async () => {
    try {
      await projectRegistry.unregister(FILES_PROJECT);
    } catch { /* ignore */ }
    try {
      await sessionRegistry.unregister(FILES_PROJECT, FILES_SESSION);
    } catch { /* ignore */ }
    try {
      await rm(FILES_PROJECT, { recursive: true, force: true });
    } catch { /* ignore */ }
  });

  it('rejects unknown project with 400', async () => {
    const req = new Request(buildFilesUrl({ project: '/Users' }));
    const res = await handleCodeAPI(req);
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toMatch(/unknown project/i);
  });

  it('rejects filesystem root as project with 400', async () => {
    const req = new Request(buildFilesUrl({ project: '/' }));
    const res = await handleCodeAPI(req);
    expect(res.status).toBe(400);
  });

  it('accepts absolute dirPath that is under the project root', async () => {
    const req = new Request(buildFilesUrl({
      project: FILES_PROJECT,
      path: join(FILES_PROJECT, 'src'),
    }));
    const res = await handleCodeAPI(req);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body.entries)).toBe(true);
    // Should contain index.ts + the routes subdir.
    const names = body.entries.map((e: any) => e.name).sort();
    expect(names).toContain('index.ts');
    expect(names).toContain('routes');
  });

  it('accepts relative dirPath', async () => {
    const req = new Request(buildFilesUrl({ project: FILES_PROJECT, path: 'src' }));
    const res = await handleCodeAPI(req);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    const names = body.entries.map((e: any) => e.name);
    expect(names).toContain('index.ts');
  });

  it('rejects absolute dirPath outside the project with 400', async () => {
    const req = new Request(buildFilesUrl({ project: FILES_PROJECT, path: '/etc' }));
    const res = await handleCodeAPI(req);
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toMatch(/escapes project root/i);
  });

  it('rejects dirPath with .. segments that escape project with 400', async () => {
    const req = new Request(buildFilesUrl({ project: FILES_PROJECT, path: '../../etc' }));
    const res = await handleCodeAPI(req);
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toMatch(/escapes project root/i);
  });

  it('returns relativePath on every entry, computed from project root', async () => {
    const req = new Request(buildFilesUrl({ project: FILES_PROJECT }));
    const res = await handleCodeAPI(req);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.entries.length).toBeGreaterThan(0);

    for (const entry of body.entries) {
      expect(typeof entry.relativePath).toBe('string');
      // Should NOT be absolute
      expect(entry.relativePath.startsWith('/')).toBe(false);
      // Should be consistent with the absolute path
      expect(join(FILES_PROJECT, entry.relativePath)).toBe(entry.path);
    }

    // Specifically verify the src entry
    const srcEntry = body.entries.find((e: any) => e.name === 'src');
    expect(srcEntry).toBeDefined();
    expect(srcEntry.relativePath).toBe('src');
  });

  it('does not double-resolve when an absolute path under the project is passed as dirPath (regression)', async () => {
    // Before the fix, passing an absolute subdir caused join(project, absolutePath)
    // to produce a doubled path and the handler would return 500.
    const req = new Request(buildFilesUrl({
      project: FILES_PROJECT,
      path: join(FILES_PROJECT, 'src', 'routes'),
    }));
    const res = await handleCodeAPI(req);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body.entries)).toBe(true);
  });
});
