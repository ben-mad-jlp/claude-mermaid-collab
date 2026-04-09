import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { rm, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { SnippetManager } from '../../services/snippet-manager';
import { sessionRegistry } from '../../services/session-registry';
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
