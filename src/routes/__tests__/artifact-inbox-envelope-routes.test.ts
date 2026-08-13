/**
 * Per-envelope HTTP routes: full-envelope GET, adopt, dismiss.
 *
 * The UI shipped buttons POSTing to /api/artifact-inbox/<id>/adopt|dismiss with NO
 * handler behind them (adopt/dismiss existed only as MCP verbs), and the viewer needs
 * the FULL envelope the metadata-only list withholds. These tests pin the routes.
 */
import { describe, it, expect, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'artifact-inbox-envroutes-'));
process.env.MERMAID_ARTIFACT_INBOX_DIR = dir;

import { handleArtifactInboxAPI } from '../artifact-inbox-api.js';
import { writeEnvelope, readEnvelope } from '../../services/artifact-inbox-store.js';

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.MERMAID_ARTIFACT_INBOX_DIR;
});

function seed(): string {
  const env = writeEnvelope({
    from: { serverOwner: 'route-test' },
    artifact: { type: 'document', name: 'Route test doc', content: '# full body' },
  });
  return env.envelopeId;
}

async function call(path: string, method: string, body?: unknown): Promise<Response> {
  const url = new URL(`http://localhost:9002${path}`);
  const res = await handleArtifactInboxAPI(
    new Request(url.toString(), {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    url,
  );
  expect(res).not.toBeNull();
  return res!;
}

describe('per-envelope inbox routes', () => {
  it('GET /api/artifact-inbox/<id> returns the FULL envelope including content', async () => {
    const id = seed();
    const res = await call(`/api/artifact-inbox/${id}`, 'GET');
    expect(res.status).toBe(200);
    const e = (await res.json()) as { envelopeId: string; artifact: { content: string } };
    expect(e.envelopeId).toBe(id);
    expect(e.artifact.content).toBe('# full body'); // the field the list withholds
  });

  it('GET of an unknown envelope 404s', async () => {
    const res = await call('/api/artifact-inbox/does-not-exist', 'GET');
    expect(res.status).toBe(404);
  });

  it('POST adopt without project/session is a 400, envelope untouched', async () => {
    const id = seed();
    const res = await call(`/api/artifact-inbox/${id}/adopt`, 'POST', {});
    expect(res.status).toBe(400);
    expect(readEnvelope(id)!.state).toBe('pending');
  });

  it('POST dismiss transitions the envelope to dismissed', async () => {
    const id = seed();
    const res = await call(`/api/artifact-inbox/${id}/dismiss`, 'POST');
    expect(res.status).toBe(200);
    expect(readEnvelope(id)!.state).toBe('dismissed');
  });

  it('unknown method on a per-envelope path is 405, never a silent null fall-through', async () => {
    const id = seed();
    const res = await call(`/api/artifact-inbox/${id}`, 'DELETE');
    expect(res.status).toBe(405);
  });
});
