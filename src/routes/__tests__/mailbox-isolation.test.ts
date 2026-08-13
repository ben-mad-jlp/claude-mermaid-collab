import { describe, it, expect, beforeAll, afterAll, mock } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Hermetic setup: set temp dirs BEFORE importing modules that read env vars at module load
const inboxDir = mkdtempSync(join(tmpdir(), 'mailbox-iso-inbox-'));
const dataDir = mkdtempSync(join(tmpdir(), 'mailbox-iso-data-'));
const projectRoot = mkdtempSync(join(tmpdir(), 'mailbox-iso-proj-'));

process.env.MERMAID_ARTIFACT_INBOX_DIR = inboxDir;
process.env.MERMAID_DATA_DIR = dataDir;

// Mock config before any imports that depend on auth
mock.module('../../services/config-file.ts', () => ({
  getAuthToken: () => 'test-token-12345',
  getRequireAuthOnLoopback: () => false,
  getConfiguredPort: () => 9002,
  getConfig: () => undefined,
  getSecret: () => undefined,
  getConfigEntries: () => ({}),
  setConfig: () => ({}),
  _resetConfigCache: () => {},
  generateAuthToken: () => 'token',
  setAuthToken: () => {},
  migrateEnvAuthToken: () => 'noop',
  DEFAULT_MERMAID_PORT: 9002,
  setConfiguredPort: () => {},
  portFilePath: () => '',
  writePortFile: () => {},
  clearPortFile: () => {},
  readPortFile: () => null,
}));

// Now safe to import modules that capture env vars at module load
const { handleAPI } = await import('../api.js');
const { sessionRegistry } = await import('../../services/session-registry.js');
const { writeEnvelope, listEnvelopes } = await import('../../services/artifact-inbox-store.js');

const SESSION = 'iso';

afterAll(() => {
  rmSync(inboxDir, { recursive: true, force: true });
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(projectRoot, { recursive: true, force: true });
  delete process.env.MERMAID_ARTIFACT_INBOX_DIR;
  delete process.env.MERMAID_DATA_DIR;
});

// Dispatch stub: builds URL and calls handleAPI with 8-arg shape from src/server.ts:534
async function callAPI(
  method: string,
  path: string,
  options?: { query?: Record<string, string>; body?: unknown }
): Promise<Response> {
  const queryString = options?.query
    ? '?' + new URLSearchParams(options.query).toString()
    : '';
  const url = new URL('http://localhost:9002' + path + queryString);

  const body = options?.body ? JSON.stringify(options.body) : undefined;
  const req = new Request(url.toString(), {
    method,
    body,
  });

  const wsStub = { broadcast: () => {} };
  const validatorStub = { validate: async () => ({ valid: true }) };

  // handleAPI(req, diagramManager, documentManager, metadataManager, validator, renderer, wsHandler, url)
  // First three manager args are documented-unused; validator and renderer only touched by render routes
  return handleAPI(
    req,
    null as any,
    null as any,
    null as any,
    validatorStub as any,
    null as any,
    wsStub as any,
    url
  );
}

// Seed one artifact per kind through POST endpoints
async function seedArtifacts(): Promise<{
  diagram: string;
  design: string;
  document: string;
  spreadsheet: string;
  snippet: string;
  embed: string;
  image: string;
}> {
  const query = { project: projectRoot, session: SESSION };

  // POST /api/diagram (create new)
  let res = await callAPI('POST', '/api/diagram', {
    query,
    body: { name: 'diagram-1', content: 'graph TD; A-->B' },
  });
  if (res.status >= 300) {
    const error = await res.text();
    throw new Error(`Diagram POST failed (${res.status}): ${error}`);
  }
  const diagramData = await res.json() as { id?: string };
  const diagramId = diagramData.id!;

  // POST /api/design (create new)
  res = await callAPI('POST', '/api/design', {
    query,
    body: { name: 'design-1', content: 'design-content' },
  });
  if (res.status >= 300) {
    const error = await res.text();
    throw new Error(`Design POST failed (${res.status}): ${error}`);
  }
  const designData = await res.json() as { id?: string };
  const designId = designData.id!;

  // POST /api/document (create new)
  res = await callAPI('POST', '/api/document', {
    query,
    body: { name: 'doc-1', content: 'document content' },
  });
  if (res.status >= 300) {
    const error = await res.text();
    throw new Error(`Document POST failed (${res.status}): ${error}`);
  }
  const documentData = await res.json() as { id?: string };
  const documentId = documentData.id!;

  // POST /api/spreadsheet (create new)
  res = await callAPI('POST', '/api/spreadsheet', {
    query,
    body: { name: 'sheet-1', content: '[["a","b","c"],[1,2,3]]' },
  });
  if (res.status >= 300) {
    const error = await res.text();
    throw new Error(`Spreadsheet POST failed (${res.status}): ${error}`);
  }
  const spreadsheetData = await res.json() as { id?: string };
  const spreadsheetId = spreadsheetData.id!;

  // POST /api/snippet (create new)
  res = await callAPI('POST', '/api/snippet', {
    query,
    body: { name: 'snippet-1', content: 'console.log("hello")' },
  });
  if (res.status >= 300) {
    const error = await res.text();
    throw new Error(`Snippet POST failed (${res.status}): ${error}`);
  }
  const snippetData = await res.json() as { id?: string };
  const snippetId = snippetData.id!;

  // POST /api/embed (create new) — { name, url }
  res = await callAPI('POST', '/api/embed', {
    query,
    body: { name: 'embed-1', url: 'https://example.com' },
  });
  if (res.status >= 300) {
    const error = await res.text();
    throw new Error(`Embed POST failed (${res.status}): ${error}`);
  }
  const embedData = await res.json() as { id?: string };
  const embedId = embedData.id!;

  // POST /api/image — JSON { name, source } with base64 data URL
  const base64Image =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  res = await callAPI('POST', '/api/image', {
    query,
    body: { name: 'image-1', source: base64Image },
  });
  if (res.status >= 300) {
    const error = await res.text();
    throw new Error(`Image POST failed (${res.status}): ${error}`);
  }
  const imageData = await res.json() as { id?: string };
  const imageId = imageData.id!;

  return { diagram: diagramId, design: designId, document: documentId, spreadsheet: spreadsheetId, snippet: snippetId, embed: embedId, image: imageId };
}

// List probes — the seven GET list endpoints
const LIST_PROBES = [
  { name: 'diagrams', path: '/api/diagrams' },
  { name: 'designs', path: '/api/designs' },
  { name: 'documents', path: '/api/documents' },
  { name: 'spreadsheets', path: '/api/spreadsheets' },
  { name: 'snippets', path: '/api/snippets' },
  { name: 'embeds', path: '/api/embeds' },
  { name: 'images', path: '/api/images' },
];

describe('mailbox isolation', () => {
  it('keeps all seven artifact list verbs byte-identical while pending envelopes exist', async () => {
    // Register session first
    await sessionRegistry.register(projectRoot, SESSION);

    // Seed one artifact of each kind
    await seedArtifacts();

    const query = { project: projectRoot, session: SESSION };

    // Capture baseline for each list endpoint
    const baselines: Record<string, string> = {};
    for (const probe of LIST_PROBES) {
      const res = await callAPI('GET', probe.path, { query });
      expect(res.status).toBe(200);
      const text = await res.text();
      baselines[probe.name] = text;

      // Parse and assert non-empty for this probe
      const data = JSON.parse(text) as Record<string, unknown[]>;
      const key = probe.name;
      expect(data[key]).toBeDefined();
      expect(Array.isArray(data[key])).toBe(true);
      expect((data[key] as unknown[]).length).toBeGreaterThan(0);
    }

    // Write envelopes to the inbox (pending, not adopted)
    const env1 = writeEnvelope({
      artifact: { type: 'document', name: 'pending-doc.md', content: 'pending content' },
      from: {},
    });
    const env2 = writeEnvelope({
      artifact: { type: 'image', name: 'pending-image.png', content: 'pending image data' },
      from: {},
    });

    // Confirm envelopes are listed
    const envelopes = listEnvelopes();
    expect(envelopes.length).toBe(2);

    // Re-measure every probe and assert byte-identical to baseline
    for (const probe of LIST_PROBES) {
      const res = await callAPI('GET', probe.path, { query });
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toBe(baselines[probe.name]);
    }
  });

  it('keeps document update-log replay and history byte-identical while pending envelopes exist', async () => {
    // Register session first (fresh for this test)
    await sessionRegistry.register(projectRoot, SESSION);

    const query = { project: projectRoot, session: SESSION };

    // Create a document
    let res = await callAPI('POST', '/api/document', {
      query,
      body: { name: 'doc-for-log.md', content: 'initial content' },
    });
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(300);
    const docData = await res.json() as { id?: string };
    const docId = docData.id!;

    // Issue a real POST to mutate the document and trigger update-log write
    res = await callAPI('POST', `/api/document/${docId}`, {
      query,
      body: { content: 'updated content after first change' },
    });
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(300);

    // Capture fixed timestamp for version comparisons
    const timestamp = new Date().toISOString();

    // Baseline measurement: version endpoint
    res = await callAPI('GET', `/api/document/${docId}/version`, {
      query: { ...query, timestamp },
    });
    expect(res.status).toBe(200);
    const baselineVersionText = await res.text();
    const baselineVersion = JSON.parse(baselineVersionText);

    // Guard assertions: version must have non-empty content
    expect(baselineVersion.content).toEqual(expect.any(String));
    expect(baselineVersion.content.length).toBeGreaterThan(0);

    // Baseline measurement: history endpoint
    res = await callAPI('GET', `/api/document/${docId}/history`, { query });
    expect(res.status).toBe(200);
    const baselineHistoryText = await res.text();
    const baselineHistory = JSON.parse(baselineHistoryText);

    // Guard assertion: history must have changes
    expect(baselineHistory.changes).toBeDefined();
    expect(Array.isArray(baselineHistory.changes)).toBe(true);
    expect(baselineHistory.changes.length).toBeGreaterThan(0);

    // Write envelopes to the inbox (pending)
    writeEnvelope({
      artifact: { type: 'document', name: 'pending-doc-2.md', content: 'pending 2' },
      from: {},
    });
    writeEnvelope({
      artifact: { type: 'snippet', name: 'pending-snippet.js', content: 'pending code' },
      from: {},
    });

    // Re-measure version with same timestamp and assert byte-identical
    res = await callAPI('GET', `/api/document/${docId}/version`, {
      query: { ...query, timestamp },
    });
    expect(res.status).toBe(200);
    const remeasuredVersionText = await res.text();
    expect(remeasuredVersionText).toBe(baselineVersionText);

    // Re-measure history and assert byte-identical
    res = await callAPI('GET', `/api/document/${docId}/history`, { query });
    expect(res.status).toBe(200);
    const remeasuredHistoryText = await res.text();
    expect(remeasuredHistoryText).toBe(baselineHistoryText);
  });
});
