import { describe, it, expect, beforeAll, afterAll, mock } from 'bun:test';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Hermetic setup: set all temp dirs BEFORE importing modules that read env vars at module load
const inboxDir = mkdtempSync(join(tmpdir(), 'artifact-inbox-verbs-test-'));
const dataDir = mkdtempSync(join(tmpdir(), 'artifact-inbox-verbs-data-'));
const supervisorDir = mkdtempSync(join(tmpdir(), 'artifact-inbox-verbs-supervisor-'));
const projectARoot = mkdtempSync(join(tmpdir(), 'artifact-inbox-verbs-projA-'));
const projectBRoot = mkdtempSync(join(tmpdir(), 'artifact-inbox-verbs-projB-'));

process.env.MERMAID_ARTIFACT_INBOX_DIR = inboxDir;
process.env.MERMAID_DATA_DIR = dataDir;
process.env.MERMAID_SUPERVISOR_DIR = supervisorDir;
process.env.MERMAID_ALLOW_TRANSIENT_PROJECT_CONFIG = '1';

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

// Import modules that DON'T read process.env.PORT at module load
const { readEnvelope, ARTIFACT_TYPES } = await import('../../services/artifact-inbox-store.js');
const { handleArtifactInboxAPI } = await import('../../routes/artifact-inbox-api.js');
const { resolveProjectArg } = await import('../../services/project-registry.js');

// These will be imported AFTER PORT is set in beforeAll
// handleAPI must be deferred because api.js transitively loads http-util.ts, which freezes
// API_BASE_URL from process.env.PORT at module load time
let handleAPI: any;
let adoptArtifact: any;
let dismissArtifact: any;
let sessionRegistry: any;

// ============ Helpers ============

/** Generate a minimal 1x1 PNG (valid header + IHDR + IDAT + IEND chunks) */
function generateMinimalPNG(): Buffer {
  // PNG magic number
  const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  // IHDR chunk: 1x1 pixel, 8-bit grayscale
  const ihdrData = Buffer.from([
    0x00, 0x00, 0x00, 0x01, // width = 1
    0x00, 0x00, 0x00, 0x01, // height = 1
    0x08, // bit depth = 8
    0x00, // color type = 0 (grayscale)
    0x00, // compression method
    0x00, // filter method
    0x00, // interlace method
  ]);
  const ihdrCrc = Buffer.from([0x90, 0x77, 0x3d, 0xdf]); // pre-computed CRC for above
  const ihdrChunk = Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x0d]), // length = 13
    Buffer.from('IHDR'),
    ihdrData,
    ihdrCrc,
  ]);

  // IDAT chunk: minimal compressed data (single gray pixel)
  const idatData = Buffer.from([
    0x78, 0x9c, 0x62, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01, // minimal zlib stream
  ]);
  const idatCrc = Buffer.from([0xf6, 0x4e, 0xc8, 0x89]); // pre-computed CRC
  const idatChunk = Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x09]), // length = 9
    Buffer.from('IDAT'),
    idatData,
    idatCrc,
  ]);

  // IEND chunk
  const iendChunk = Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x00]), // length = 0
    Buffer.from('IEND'),
    Buffer.from([0xae, 0x42, 0x60, 0x82]), // IEND CRC
  ]);

  return Buffer.concat([pngMagic, ihdrChunk, idatChunk, iendChunk]);
}

/** Send an envelope via POST /api/artifact-inbox and return the envelopeId */
async function sendEnvelope(
  type: typeof ARTIFACT_TYPES[number],
  name: string,
  content: string,
  serverUrl: string,
  metadata?: Record<string, unknown>,
): Promise<string> {
  // For image types, the data URI regex doesn't support trailing newlines,
  // so strip them for transmission (but the test will keep the version with newline for comparison)
  const envelopeContent = type === 'image' ? content.trim() : content;

  const projACanonical = (globalThis as any).projACanonical;
  const body: any = {
    schemaVersion: 1,
    from: { project: projACanonical, session: 'sender' },
    artifact: { type, name, content: envelopeContent },
  };
  if (metadata) {
    body.artifact.metadata = metadata;
  }

  const res = await fetch(new URL('/api/artifact-inbox', serverUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  expect(res.status).toBe(200);
  const data = (await res.json()) as { envelopeId: string };
  return data.envelopeId;
}

/** Fetch an artifact from the API and return the parsed response */
async function fetchArtifact(
  type: typeof ARTIFACT_TYPES[number],
  id: string,
  project: string,
  session: string,
  serverUrl: string,
  isImageContent: boolean = false,
): Promise<any> {
  const endpoint = type === 'image' && isImageContent ? 'image' : type;
  const path = isImageContent && type === 'image' ? `/api/image/${id}/content` : `/api/${endpoint}/${id}`;
  const url = new URL(path, serverUrl);
  url.searchParams.set('project', project);
  url.searchParams.set('session', session);

  const res = await fetch(url);
  expect(res.status).toBe(200);

  if (isImageContent && type === 'image') {
    return Buffer.from(await res.arrayBuffer());
  }

  return res.json();
}

/** List artifacts of a given type to count them */
async function countArtifacts(
  type: typeof ARTIFACT_TYPES[number],
  project: string,
  session: string,
  serverUrl: string,
): Promise<number> {
  const listEndpoint = {
    document: 'documents',
    diagram: 'diagrams',
    design: 'designs',
    spreadsheet: 'spreadsheets',
    snippet: 'snippets',
    image: 'images',
  }[type];

  const url = new URL(`/api/${listEndpoint}`, serverUrl);
  url.searchParams.set('project', project);
  url.searchParams.set('session', session);

  const res = await fetch(url);
  expect(res.status).toBe(200);
  const data = (await res.json()) as Record<string, any[]>;
  const key = listEndpoint;
  return (data[key] || []).length;
}

/** Fetch metadata for an artifact */
async function fetchMetadata(
  artifactId: string,
  project: string,
  session: string,
  serverUrl: string,
): Promise<Record<string, any>> {
  const url = new URL('/api/metadata', serverUrl);
  url.searchParams.set('project', project);
  url.searchParams.set('session', session);

  const res = await fetch(url);
  expect(res.status).toBe(200);
  const data = (await res.json()) as { items: Record<string, any> };
  return data.items[artifactId] || {};
}

// ============ Test Setup ============

let server: Awaited<ReturnType<typeof Bun.serve>>;
let serverUrl: string;

beforeAll(async () => {
  // Start the server FIRST, then set PORT env var
  server = Bun.serve({
    port: 0,
    fetch: async (req: Request) => {
      const url = new URL(req.url);

      // Try artifact-inbox API first
      const inboxRes = await handleArtifactInboxAPI(req, url);
      if (inboxRes !== null) return inboxRes;

      // Fall back to main API
      const validatorStub = { validate: async () => ({ valid: true }) };
      const wsStub = { broadcast() {} };
      return handleAPI(req, null as any, null as any, null as any, validatorStub, null as any, wsStub as any, url);
    },
  });

  // Now set PORT so http-util.ts reads the correct value
  process.env.PORT = String(server.port);
  serverUrl = `http://localhost:${server.port}`;

  // NOW import modules that freeze API_BASE_URL from process.env.PORT at module load
  // This must happen AFTER process.env.PORT is set
  const apiModule = await import('../../routes/api.js');
  handleAPI = apiModule.handleAPI;

  const artInboxModule = await import('../tools/artifact-inbox.js');
  adoptArtifact = artInboxModule.adoptArtifact;
  dismissArtifact = artInboxModule.dismissArtifact;

  const sessionRegModule = await import('../../services/session-registry.js');
  sessionRegistry = sessionRegModule.sessionRegistry;

  // Resolve canonical project paths
  const projACanonical = await resolveProjectArg(projectARoot);
  const projBCanonical = await resolveProjectArg(projectBRoot);

  // Register sessions for both projects
  await sessionRegistry.register(projACanonical, 'sender');
  await sessionRegistry.register(projBCanonical, 'receiver');

  // Store canonical paths for use in tests
  (globalThis as any).projACanonical = projACanonical;
  (globalThis as any).projBCanonical = projBCanonical;
});

afterAll(async () => {
  server.stop(true);
  rmSync(inboxDir, { recursive: true, force: true });
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(supervisorDir, { recursive: true, force: true });
  rmSync(projectARoot, { recursive: true, force: true });
  rmSync(projectBRoot, { recursive: true, force: true });
  delete process.env.MERMAID_ARTIFACT_INBOX_DIR;
  delete process.env.MERMAID_DATA_DIR;
  delete process.env.MERMAID_SUPERVISOR_DIR;
  delete process.env.MERMAID_ALLOW_TRANSIENT_PROJECT_CONFIG;
  delete process.env.PORT;
});

// ============ Round-Trip Tests ============

describe('artifact-inbox round-trip verbs', () => {
  // Helper to run a round-trip test case
  async function runRoundTripTest(
    type: typeof ARTIFACT_TYPES[number],
    name: string,
    content: string,
    readBack: (id: string, project: string, session: string, url: string) => Promise<any>,
    compare: (sent: string, received: any) => void,
  ): Promise<void> {
    const projBCanonical = (globalThis as any).projBCanonical;

    // Send envelope from project A
    const envelopeId = await sendEnvelope(type, name, content, serverUrl);

    // Adopt into project B
    const adoptResult = JSON.parse(await adoptArtifact(envelopeId, projBCanonical, 'receiver'));
    expect(adoptResult.id).toBeDefined();
    expect(typeof adoptResult.id).toBe('string');
    expect(adoptResult.id.length).toBeGreaterThan(0);
    const artifactId = adoptResult.id;

    // Read back from project B and compare
    const result = await readBack(artifactId, projBCanonical, 'receiver', serverUrl);
    compare(content, result);

    // Verify envelope state
    const envelope = readEnvelope(envelopeId);
    expect(envelope).not.toBeNull();
    expect(envelope!.state).toBe('adopted');
    expect(envelope!.adoptedTo).toBeDefined();
    expect(envelope!.adoptedTo!.session).toBe('receiver');
    expect(envelope!.adoptedTo!.artifactId).toBe(artifactId);
    expect(envelope!.adoptedTo!.project).toBe(projBCanonical);
  }

  it('round-trips a document across projects with identical content', async () => {
    await runRoundTripTest(
      'document',
      'test-document',
      '# Test Document\n\nThis is a test document with émojis 🎉 and arrows →\n',
      async (id, project, session, url) => {
        const doc = await fetchArtifact('document', id, project, session, url);
        return doc.content;
      },
      (sent, received) => expect(received).toBe(sent),
    );
  });

  it('round-trips a diagram across projects with identical content', async () => {
    await runRoundTripTest(
      'diagram',
      'test-diagram',
      'graph LR\n  A[Start] --> B{Decision}\n  B -->|Yes| C[End]\n  B -->|No| D[Continue]\n\n',
      async (id, project, session, url) => {
        const diag = await fetchArtifact('diagram', id, project, session, url);
        return diag.content;
      },
      (sent, received) => expect(received).toBe(sent),
    );
  });

  it('round-trips a design across projects with identical content', async () => {
    await runRoundTripTest(
      'design',
      'test-design',
      JSON.stringify({
        width: 800,
        height: 600,
        layers: [
          { id: '1', name: 'Background', objects: [] },
          { id: '2', name: 'Foreground', objects: [] },
        ],
      }) + '\n',
      async (id, project, session, url) => {
        const design = await fetchArtifact('design', id, project, session, url);
        return JSON.parse(design.content);
      },
      (sent, received) => {
        const sentObj = JSON.parse(sent);
        expect(received.width).toEqual(sentObj.width);
        expect(received.height).toEqual(sentObj.height);
        expect(received.layers).toEqual(sentObj.layers);
      },
    );
  });

  it('round-trips a spreadsheet across projects with identical content', async () => {
    await runRoundTripTest(
      'spreadsheet',
      'test-spreadsheet',
      JSON.stringify({
        columns: ['Name', 'Age', 'City'],
        rows: [
          ['Alice', 30, 'New York'],
          ['Bob', 25, 'São Paulo'],
        ],
      }) + '\n',
      async (id, project, session, url) => {
        const sheet = await fetchArtifact('spreadsheet', id, project, session, url);
        return JSON.parse(sheet.content);
      },
      (sent, received) => {
        const sentObj = JSON.parse(sent);
        expect(received.columns).toEqual(sentObj.columns);
        expect(received.rows).toEqual(sentObj.rows);
      },
    );
  });

  it('round-trips a snippet across projects with identical content', async () => {
    await runRoundTripTest(
      'snippet',
      'test-snippet',
      'function hello() {\n  console.log("Hello, World! 🌍");\n}\n',
      async (id, project, session, url) => {
        const snippet = await fetchArtifact('snippet', id, project, session, url);
        return snippet.content;
      },
      (sent, received) => expect(received).toBe(sent),
    );
  });

  it('round-trips a image across projects with identical content', async () => {
    const pngBuffer = generateMinimalPNG();
    const base64 = pngBuffer.toString('base64');
    const content = `data:image/png;base64,${base64}` + '\n';

    await runRoundTripTest(
      'image',
      'test-image',
      content,
      async (id, project, session, url) => {
        return fetchArtifact('image', id, project, session, url, true);
      },
      (sent, received: Buffer) => {
        const trimmed = sent.trim();
        const base64Match = trimmed.match(/data:image\/png;base64,([A-Za-z0-9+/=]+)/);
        expect(base64Match).not.toBeNull();
        const sentBuffer = Buffer.from(base64Match![1], 'base64');
        expect(Buffer.compare(sentBuffer, received)).toBe(0);
      },
    );
  });

  // State machine test: double adopt
  it('a second adopt of the same envelope throws EnvelopeNotPendingError and the receiving session artifact count is equal before and after', async () => {
    const projBCanonical = (globalThis as any).projBCanonical;

    const envelopeId = await sendEnvelope(
      'document',
      'double-adopt-test',
      'Double adopt test document\n',
      serverUrl,
    );

    // First adopt
    const adoptResult = JSON.parse(await adoptArtifact(envelopeId, projBCanonical, 'receiver'));
    const artifactId = adoptResult.id;

    // Count before second attempt
    const countBefore = await countArtifacts('document', projBCanonical, 'receiver', serverUrl);

    // Second adopt should fail
    let thrown: Error | null = null;
    try {
      await adoptArtifact(envelopeId, projBCanonical, 'receiver');
    } catch (err) {
      thrown = err as Error;
    }

    expect(thrown).not.toBeNull();
    expect(thrown!.name).toBe('ENVELOPE_NOT_PENDING');

    // Count after should be equal
    const countAfter = await countArtifacts('document', projBCanonical, 'receiver', serverUrl);
    expect(countAfter).toBe(countBefore);
  });

  // State machine test: adopt after dismiss
  it('adopting a dismissed envelope throws EnvelopeNotPendingError', async () => {
    const projBCanonical = (globalThis as any).projBCanonical;

    const envelopeId = await sendEnvelope(
      'diagram',
      'adopt-after-dismiss-test',
      'graph LR\n  A --> B\n',
      serverUrl,
    );

    // Dismiss the envelope
    await dismissArtifact(envelopeId);

    // Try to adopt after dismiss
    let thrown: Error | null = null;
    try {
      await adoptArtifact(envelopeId, projBCanonical, 'receiver');
    } catch (err) {
      thrown = err as Error;
    }

    expect(thrown).not.toBeNull();
    expect(thrown!.name).toBe('ENVELOPE_NOT_PENDING');
  });

  // State machine test: dismiss keeps file
  it('dismiss flips state to dismissed and the envelope JSON file still exists', async () => {
    const envelopeId = await sendEnvelope(
      'snippet',
      'dismiss-keeps-file-test',
      'const x = 1;\n',
      serverUrl,
    );

    // Dismiss
    await dismissArtifact(envelopeId);

    // Check state
    const envelope = readEnvelope(envelopeId);
    expect(envelope).not.toBeNull();
    expect(envelope!.state).toBe('dismissed');

    // Check file still exists
    const envelopeFilePath = join(inboxDir, envelopeId + '.json');
    expect(existsSync(envelopeFilePath)).toBe(true);
  });
});

describe('metadata replay', () => {
  // This suite validates that setArtifactMetadata() is called correctly in adoptArtifact.
  // If the setArtifactMetadata(...) call in adoptArtifact is deleted, these tests will fail.

  it('replays a pinned-only envelope without locking the adopted artifact', async () => {
    const projBCanonical = (globalThis as any).projBCanonical;

    // Send envelope with pinned flag only
    const envelopeId = await sendEnvelope(
      'document',
      'pinned-only-test',
      'Pinned only document\n',
      serverUrl,
      { pinned: true },
    );

    // Adopt
    const adoptResult = JSON.parse(await adoptArtifact(envelopeId, projBCanonical, 'receiver'));
    const artifactId = adoptResult.id;

    // Fetch metadata and verify
    const metadata = await fetchMetadata(artifactId, projBCanonical, 'receiver', serverUrl);
    expect(metadata.pinned).toBe(true);
    expect(metadata.locked).toBeFalsy(); // Regression: should not be seeded as true
    expect(metadata.blueprint).toBeFalsy();
  });

  it('replays a blueprint envelope and the adopted artifact is blueprint and locked', async () => {
    const projBCanonical = (globalThis as any).projBCanonical;

    // Send envelope with blueprint flag
    const envelopeId = await sendEnvelope(
      'diagram',
      'blueprint-test',
      'graph LR\n  A --> B\n',
      serverUrl,
      { blueprint: true },
    );

    // Adopt
    const adoptResult = JSON.parse(await adoptArtifact(envelopeId, projBCanonical, 'receiver'));
    const artifactId = adoptResult.id;

    // Fetch metadata and verify blueprint implies locked
    const metadata = await fetchMetadata(artifactId, projBCanonical, 'receiver', serverUrl);
    expect(metadata.blueprint).toBe(true);
    expect(metadata.locked).toBe(true); // blueprint ⇒ locked
  });

  it('an envelope with no metadata leaves the adopted artifact with no pinned, locked or blueprint flags', async () => {
    const projBCanonical = (globalThis as any).projBCanonical;

    // Send envelope with no metadata
    const envelopeId = await sendEnvelope(
      'snippet',
      'no-metadata-test',
      'const x = 1;\n',
      serverUrl,
    );

    // Adopt
    const adoptResult = JSON.parse(await adoptArtifact(envelopeId, projBCanonical, 'receiver'));
    const artifactId = adoptResult.id;

    // Fetch metadata and verify all flags are falsy
    const metadata = await fetchMetadata(artifactId, projBCanonical, 'receiver', serverUrl);
    expect(metadata.pinned).toBeFalsy();
    expect(metadata.locked).toBeFalsy();
    expect(metadata.blueprint).toBeFalsy();
    expect(metadata.deprecated).toBeFalsy();
  });
});
