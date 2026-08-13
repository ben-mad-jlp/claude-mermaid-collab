import { describe, it, expect, beforeAll, afterAll, mock } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'send-artifact-tool-'));
process.env.MERMAID_ARTIFACT_INBOX_DIR = dir;

mock.module('../../services/config-file.ts', () => ({
  getAuthToken: () => 'test-token-12345',
  getRequireAuthOnLoopback: () => false,
}));

import { sendArtifact, handleArtifactSendTool, type SendArtifactDeps } from '../artifact-send-tools.js';
import { handleArtifactInboxAPI } from '../../routes/artifact-inbox-api.js';
import { readEnvelope } from '../../services/artifact-inbox-store.js';

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.MERMAID_ARTIFACT_INBOX_DIR;
});

describe('send_artifact', () => {
  it('delivers a document to a loopback inbox and returns the receipt re-read from the target', async () => {
    const testProjectPath = '/Users/benmaderazo/Code/build123d-ocp-mcp';
    const testSession = 'test-session-123';

    const deps: SendArtifactDeps = {
      async readArtifact(type, project, session, id) {
        if (type === 'document' && id === 'doc-1') {
          return {
            name: 'test-doc.md',
            content: '# Test Document\nThis is a test.',
          };
        }
        throw new Error(`Unsupported artifact: ${type} ${id}`);
      },
      async fetchImpl(url, init) {
        const urlStr = typeof url === 'string' ? url : url.toString();
        const reqUrl = new URL(urlStr);

        if (reqUrl.pathname === '/api/artifact-inbox') {
          const req = new Request(urlStr, init);
          const res = await handleArtifactInboxAPI(req, reqUrl);
          if (!res) {
            return new Response('Not found', { status: 404 });
          }
          return res;
        }

        return new Response('Not found', { status: 404 });
      },
    };

    const result = await sendArtifact(
      {
        project: testProjectPath,
        session: testSession,
        type: 'document',
        id: 'doc-1',
        to: { server: 'http://localhost:9002' },
        note: 'Test delivery',
      },
      deps,
    );

    // Verify the returned receipt has the expected shape
    expect(result.envelopeId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.receivedAt).toBeTruthy();

    // Verify the envelope was actually written to the inbox
    const envelope = readEnvelope(result.envelopeId);
    expect(envelope).not.toBeNull();
    expect(envelope!.artifact.type).toBe('document');
    expect(envelope!.artifact.name).toBe('test-doc.md');
    expect(envelope!.artifact.content).toBe('# Test Document\nThis is a test.');
    expect(envelope!.state).toBe('pending');
  });

  it('throws when the target inbox GET does not list the delivered envelope', async () => {
    const testProjectPath = '/Users/benmaderazo/Code/build123d-ocp-mcp';
    const testSession = 'test-session-456';

    const deps: SendArtifactDeps = {
      async readArtifact(type, project, session, id) {
        if (type === 'document' && id === 'doc-2') {
          return {
            name: 'test-doc-2.md',
            content: 'Test content',
          };
        }
        throw new Error(`Unsupported artifact: ${type} ${id}`);
      },
      async fetchImpl(url, init) {
        const urlStr = typeof url === 'string' ? url : url.toString();
        const reqUrl = new URL(urlStr);

        if (reqUrl.pathname === '/api/artifact-inbox' && reqUrl.toString().includes('GET')) {
          // POST returns a fabricated ID; GET returns empty list
          const method = init?.method || 'GET';
          if (method === 'POST') {
            return new Response(
              JSON.stringify({
                envelopeId: 'fabricated-uuid-0000-0000-0000-000000000001',
                receivedAt: new Date().toISOString(),
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            );
          }
          // GET endpoint returns empty list
          return new Response(
            JSON.stringify({ envelopes: [] }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }

        if (reqUrl.pathname === '/api/artifact-inbox') {
          const method = init?.method || 'GET';
          if (method === 'POST') {
            return new Response(
              JSON.stringify({
                envelopeId: 'fabricated-uuid-0000-0000-0000-000000000002',
                receivedAt: new Date().toISOString(),
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            );
          }
          // GET returns empty list to simulate missing envelope
          return new Response(
            JSON.stringify({ envelopes: [] }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }

        return new Response('Not found', { status: 404 });
      },
    };

    let thrownError: Error | null = null;
    try {
      await sendArtifact(
        {
          project: testProjectPath,
          session: testSession,
          type: 'document',
          id: 'doc-2',
          to: { server: 'http://localhost:9002' },
        },
        deps,
      );
    } catch (e) {
      thrownError = e as Error;
    }

    expect(thrownError).not.toBeNull();
    expect(thrownError!.message).toContain('not found in target inbox');
    expect(thrownError!.message).toContain('fabricated-uuid-0000-0000-0000-000000000002');
  });

  it('validates required parameters', async () => {
    let thrownError: Error | null = null;
    try {
      await handleArtifactSendTool('send_artifact', {
        project: '/test/project',
        session: 'test-session',
        type: 'document',
        // missing 'id' and 'to'
      });
    } catch (e) {
      thrownError = e as Error;
    }

    expect(thrownError).not.toBeNull();
    expect(thrownError!.message).toContain('Missing required');
  });

  it('rejects invalid artifact types', async () => {
    let thrownError: Error | null = null;
    try {
      await handleArtifactSendTool('send_artifact', {
        project: '/test/project',
        session: 'test-session',
        type: 'invalid-type',
        id: 'test-id',
        to: { server: 'http://localhost:9002' },
      });
    } catch (e) {
      thrownError = e as Error;
    }

    expect(thrownError).not.toBeNull();
    expect(thrownError!.message).toContain('Invalid type');
  });

  it('normalizes target server URLs by stripping trailing slashes', async () => {
    const testProjectPath = '/Users/benmaderazo/Code/build123d-ocp-mcp';
    const testSession = 'test-session-789';

    const capturedUrls: string[] = [];

    const deps: SendArtifactDeps = {
      async readArtifact(type, project, session, id) {
        return {
          name: 'test.md',
          content: 'test',
        };
      },
      async fetchImpl(url, init) {
        const urlStr = typeof url === 'string' ? url : url.toString();
        capturedUrls.push(urlStr);

        const reqUrl = new URL(urlStr);
        if (reqUrl.pathname === '/api/artifact-inbox') {
          const method = init?.method || 'GET';
          if (method === 'POST') {
            return new Response(
              JSON.stringify({
                envelopeId: 'test-uuid-0000-0000-0000-000000000003',
                receivedAt: new Date().toISOString(),
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            );
          }
          return new Response(
            JSON.stringify({ envelopes: [{ envelopeId: 'test-uuid-0000-0000-0000-000000000003', receivedAt: new Date().toISOString() }] }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }

        return new Response('Not found', { status: 404 });
      },
    };

    // Test with trailing slash
    await sendArtifact(
      {
        project: testProjectPath,
        session: testSession,
        type: 'document',
        id: 'test-id',
        to: { server: 'http://localhost:9002/' },
      },
      deps,
    );

    // Both POST and GET should use the normalized URL without trailing slash
    expect(capturedUrls.some((u) => u === 'http://localhost:9002/api/artifact-inbox')).toBe(true);
    expect(capturedUrls.some((u) => u.startsWith('http://localhost:9002/api/artifact-inbox'))).toBe(true);
  });

  it('rejects non-URL server addresses', async () => {
    const testProjectPath = '/Users/benmaderazo/Code/build123d-ocp-mcp';
    const testSession = 'test-session-fail';

    const deps: SendArtifactDeps = {
      async readArtifact(type, project, session, id) {
        return {
          name: 'test.md',
          content: 'test',
        };
      },
      async fetchImpl() {
        return new Response('Should not be called', { status: 500 });
      },
    };

    let thrownError: Error | null = null;
    try {
      await sendArtifact(
        {
          project: testProjectPath,
          session: testSession,
          type: 'document',
          id: 'test-id',
          to: { server: 'not-a-url' },
        },
        deps,
      );
    } catch (e) {
      thrownError = e as Error;
    }

    expect(thrownError).not.toBeNull();
    expect(thrownError!.message).toContain('must be a full URL');
  });
});
