/**
 * Incident 2026-08-13: GET /api/artifact-inbox returns a FLATTENED metadata
 * projection ({type,name} top-level, no nested artifact) while the components
 * render InboxEnvelope. envelope.artifact.type on a flattened row crashed every
 * session-selected surface behind the app-wide error boundary.
 */
import { describe, it, expect } from 'vitest';
import { normalizeEnvelope } from '../useArtifactInbox';

const FLATTENED = {
  envelopeId: 'f2826d30-910b-4826-a661-79c62e3df88a',
  type: 'document',
  name: 'Hello from the artifact inbox',
  from: { serverOwner: 'watcher-demo', baseUrl: 'http://localhost:9002' },
  receivedAt: '2026-08-13T03:25:26.277Z',
  state: 'pending',
};

describe('normalizeEnvelope', () => {
  it('lifts the flattened API projection into the nested InboxEnvelope shape', () => {
    const e = normalizeEnvelope(FLATTENED);
    expect(e).not.toBeNull();
    expect(e!.artifact.type).toBe('document'); // the exact read that crashed
    expect(e!.artifact.name).toBe('Hello from the artifact inbox');
    expect(e!.from.serverOwner).toBe('watcher-demo');
    expect(e!.state).toBe('pending');
  });

  it('passes an already-nested envelope through unchanged', () => {
    const nested = { ...FLATTENED, type: undefined, name: undefined, artifact: { type: 'diagram', name: 'n', content: 'c' } };
    const e = normalizeEnvelope(nested);
    expect(e!.artifact.type).toBe('diagram');
    expect(e!.artifact.content).toBe('c');
  });

  it('drops malformed rows instead of letting them reach the renderer', () => {
    expect(normalizeEnvelope(null)).toBeNull();
    expect(normalizeEnvelope({})).toBeNull();
    expect(normalizeEnvelope({ envelopeId: 'x' })).toBeNull(); // no type/name anywhere
    expect(normalizeEnvelope({ envelopeId: 'x', type: 'document' })).toBeNull(); // name missing
  });
});
