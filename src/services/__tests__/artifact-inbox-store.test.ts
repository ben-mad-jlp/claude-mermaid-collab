import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import {
  writeEnvelope,
  readEnvelope,
  listEnvelopes,
  markAdopted,
  markDismissed,
  inboxDir,
  EnvelopeNotFoundError,
  EnvelopeNotPendingError,
  type AdoptedTo,
} from '../artifact-inbox-store';

describe('artifact-inbox-store', () => {
  let testDir: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'artifact-inbox-'));
    originalEnv = process.env.MERMAID_ARTIFACT_INBOX_DIR;
    process.env.MERMAID_ARTIFACT_INBOX_DIR = testDir;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.MERMAID_ARTIFACT_INBOX_DIR = originalEnv;
    } else {
      delete process.env.MERMAID_ARTIFACT_INBOX_DIR;
    }
    rmSync(testDir, { recursive: true, force: true });
  });

  it('markAdopted flips state to adopted and persists adoptedTo', () => {
    const envelope = writeEnvelope({
      from: { project: 'test-proj' },
      artifact: { type: 'document', name: 'test.txt', content: 'hello' },
    });
    expect(envelope.state).toBe('pending');
    expect(envelope.adoptedTo).toBeUndefined();

    const adoptedTo: AdoptedTo = {
      project: 'target-proj',
      session: 'session-123',
      artifactId: 'artifact-456',
    };
    const updated = markAdopted(envelope.envelopeId, adoptedTo);
    expect(updated.state).toBe('adopted');
    expect(updated.adoptedTo).toEqual(adoptedTo);

    const reread = readEnvelope(envelope.envelopeId);
    expect(reread?.state).toBe('adopted');
    expect(reread?.adoptedTo).toEqual(adoptedTo);
  });

  it('a second markAdopted on the same envelope throws EnvelopeNotPendingError', () => {
    const envelope = writeEnvelope({
      from: { project: 'test-proj' },
      artifact: { type: 'document', name: 'test.txt', content: 'hello' },
    });

    const adoptedTo: AdoptedTo = {
      project: 'target-proj',
      session: 'session-123',
      artifactId: 'artifact-456',
    };
    markAdopted(envelope.envelopeId, adoptedTo);

    const secondAdoptedTo: AdoptedTo = {
      project: 'another-proj',
      session: 'session-789',
      artifactId: 'artifact-999',
    };
    expect(() => markAdopted(envelope.envelopeId, secondAdoptedTo)).toThrow(EnvelopeNotPendingError);
    try {
      markAdopted(envelope.envelopeId, secondAdoptedTo);
    } catch (e) {
      if (e instanceof EnvelopeNotPendingError) {
        expect(e.state).toBe('adopted');
      } else {
        throw e;
      }
    }
  });

  it('markDismissed flips state to dismissed and keeps the envelope file on disk', () => {
    const envelope = writeEnvelope({
      from: { project: 'test-proj' },
      artifact: { type: 'document', name: 'test.txt', content: 'hello' },
    });
    expect(envelope.state).toBe('pending');

    const updated = markDismissed(envelope.envelopeId);
    expect(updated.state).toBe('dismissed');

    const filePath = join(inboxDir(), `${envelope.envelopeId}.json`);
    expect(existsSync(filePath)).toBe(true);

    const reread = readEnvelope(envelope.envelopeId);
    expect(reread?.state).toBe('dismissed');
  });

  it('markAdopted on an unknown envelopeId throws EnvelopeNotFoundError', () => {
    const unknownId = randomUUID();
    const adoptedTo: AdoptedTo = {
      project: 'target-proj',
      session: 'session-123',
      artifactId: 'artifact-456',
    };
    expect(() => markAdopted(unknownId, adoptedTo)).toThrow(EnvelopeNotFoundError);
  });

  it('listEnvelopes(pending) excludes adopted and dismissed while listEnvelopes() returns all', () => {
    const pending1 = writeEnvelope({
      from: { project: 'test-proj' },
      artifact: { type: 'document', name: 'pending1.txt', content: 'one' },
    });

    const pending2 = writeEnvelope({
      from: { project: 'test-proj' },
      artifact: { type: 'document', name: 'pending2.txt', content: 'two' },
    });

    const toAdopt = writeEnvelope({
      from: { project: 'test-proj' },
      artifact: { type: 'document', name: 'to-adopt.txt', content: 'three' },
    });

    const toDismiss = writeEnvelope({
      from: { project: 'test-proj' },
      artifact: { type: 'document', name: 'to-dismiss.txt', content: 'four' },
    });

    const adoptedTo: AdoptedTo = {
      project: 'target-proj',
      session: 'session-123',
      artifactId: 'artifact-456',
    };
    markAdopted(toAdopt.envelopeId, adoptedTo);
    markDismissed(toDismiss.envelopeId);

    const all = listEnvelopes();
    expect(all).toHaveLength(4);
    expect(all.some(e => e.envelopeId === pending1.envelopeId)).toBe(true);
    expect(all.some(e => e.envelopeId === pending2.envelopeId)).toBe(true);
    expect(all.some(e => e.envelopeId === toAdopt.envelopeId)).toBe(true);
    expect(all.some(e => e.envelopeId === toDismiss.envelopeId)).toBe(true);

    const pendingOnly = listEnvelopes('pending');
    expect(pendingOnly).toHaveLength(2);
    expect(pendingOnly.some(e => e.envelopeId === pending1.envelopeId)).toBe(true);
    expect(pendingOnly.some(e => e.envelopeId === pending2.envelopeId)).toBe(true);
    expect(pendingOnly.some(e => e.envelopeId === toAdopt.envelopeId)).toBe(false);
    expect(pendingOnly.some(e => e.envelopeId === toDismiss.envelopeId)).toBe(false);
  });
});
