// Runs via `bun test`. Exercises desktop/src/main/remote-boundary.ts through injected
// doubles only — no electron import — so scripts/test-backend.ts (which scans src/ only)
// picks up regression coverage for a module that lives under desktop/.
import { describe, it, expect } from 'bun:test';
import { crossServerCall, type RemoteInvoker } from '../../../desktop/src/main/remote-boundary';

function makeHarness(entryIds: Set<string>, pairedIds: Set<string>) {
  const invokeCalls: string[] = [];
  const invoke: RemoteInvoker = async (serverId) => {
    invokeCalls.push(serverId);
    return { ok: true, status: 200, body: {} };
  };
  const isPaired = (id: string) => pairedIds.has(id);
  const hasEntry = (id: string) => entryIds.has(id);
  return { invoke, isPaired, hasEntry, invokeCalls };
}

describe('crossServerCall entry-existence gate', () => {
  it('returns server-entry-missing (not peer_not_paired) for an id absent from the entries set', async () => {
    const { invoke, isPaired, hasEntry, invokeCalls } = makeHarness(new Set(), new Set());
    const result = await crossServerCall(invoke, 'unknown-id', { path: '/api/x' }, isPaired, hasEntry);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
    const body = result.body as { error: string };
    expect(body.error).toBe('server-entry-missing');
    expect(body.error).not.toBe('peer_not_paired');
    expect(invokeCalls.length).toBe(0);
  });

  it('keeps returning 403 peer_not_paired for a present-but-unpaired entry', async () => {
    const { invoke, isPaired, hasEntry, invokeCalls } = makeHarness(new Set(['known-id']), new Set());
    const result = await crossServerCall(invoke, 'known-id', { path: '/api/x' }, isPaired, hasEntry);
    expect(result).toEqual({ ok: false, status: 403, body: { error: 'peer_not_paired' } });
    expect(invokeCalls.length).toBe(0);
  });

  it('still allows the local sentinel through when hasEntry has no entry for it', async () => {
    const { invoke, isPaired, hasEntry, invokeCalls } = makeHarness(new Set(), new Set());
    const localResult = await crossServerCall(invoke, 'local', { path: '/api/x' }, isPaired, hasEntry);
    expect(localResult.ok).toBe(true);
    const emptyResult = await crossServerCall(invoke, '', { path: '/api/x' }, isPaired, hasEntry);
    expect(emptyResult.ok).toBe(true);
    expect(invokeCalls).toEqual(['local', '']);
  });
});
