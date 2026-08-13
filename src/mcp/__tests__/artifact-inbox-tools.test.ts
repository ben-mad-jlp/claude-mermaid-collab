import { describe, it, expect, beforeAll, afterAll, mock } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Hermetic setup: set temp dirs BEFORE importing modules that read env vars at module load
const inboxDir = mkdtempSync(join(tmpdir(), 'artifact-inbox-test-'));
const dataDir = mkdtempSync(join(tmpdir(), 'artifact-inbox-data-'));
const projectRoot = mkdtempSync(join(tmpdir(), 'artifact-inbox-proj-'));

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
const { adoptArtifact, dismissArtifact, ProjectNotRegisteredError, SessionDirNotFoundError, ARTIFACT_INBOX_TOOL_DEFS } = await import('../tools/artifact-inbox.js');
const { writeEnvelope, readEnvelope } = await import('../../services/artifact-inbox-store.js');

afterAll(() => {
  rmSync(inboxDir, { recursive: true, force: true });
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(projectRoot, { recursive: true, force: true });
  delete process.env.MERMAID_ARTIFACT_INBOX_DIR;
  delete process.env.MERMAID_DATA_DIR;
});

describe('artifact-inbox tools', () => {
  it('adopt_artifact rejects an unregistered project with PROJECT_NOT_REGISTERED and leaves the envelope pending', async () => {
    const envelope = writeEnvelope({
      artifact: {
        type: 'document',
        name: 'test-doc',
        content: '# Test',
      },
      from: {},
    });

    let thrown: Error | null = null;
    try {
      await adoptArtifact(envelope.envelopeId, '/nonexistent/project', 'test-session');
    } catch (err) {
      thrown = err as Error;
    }

    expect(thrown).not.toBeNull();
    expect(thrown!.name).toBe('PROJECT_NOT_REGISTERED');

    // Envelope should still be pending
    const afterReject = readEnvelope(envelope.envelopeId);
    expect(afterReject).not.toBeNull();
    expect(afterReject!.state).toBe('pending');
  });

  it('adopt_artifact rejects a missing session dir with SESSION_DIR_NOT_FOUND and leaves the envelope pending', async () => {
    const envelope = writeEnvelope({
      artifact: {
        type: 'document',
        name: 'test-doc',
        content: '# Test',
      },
      from: {},
    });

    let thrown: Error | null = null;
    try {
      await adoptArtifact(envelope.envelopeId, projectRoot, 'nonexistent-session-xyz');
    } catch (err) {
      thrown = err as Error;
    }

    expect(thrown).not.toBeNull();
    expect(thrown!.name).toBe('SESSION_DIR_NOT_FOUND');

    // Envelope should still be pending
    const afterReject = readEnvelope(envelope.envelopeId);
    expect(afterReject).not.toBeNull();
    expect(afterReject!.state).toBe('pending');
  });

  it('ARTIFACT_INBOX_TOOL_DEFS exposes only name, description and inputSchema', () => {
    expect(ARTIFACT_INBOX_TOOL_DEFS).toHaveLength(2);

    for (const def of ARTIFACT_INBOX_TOOL_DEFS) {
      const keys = Object.keys(def).sort();
      expect(keys).toEqual(['description', 'inputSchema', 'name']);
      expect(def.name).toBeDefined();
      expect(typeof def.name).toBe('string');
      expect(def.description).toBeDefined();
      expect(typeof def.description).toBe('string');
      expect(def.inputSchema).toBeDefined();
      expect(typeof def.inputSchema).toBe('object');
    }
  });
});
