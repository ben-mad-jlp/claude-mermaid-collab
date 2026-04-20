import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CommandReceiptsStore, hashCommand } from '../command-receipts';

function makeStore(): CommandReceiptsStore {
  return new CommandReceiptsStore(':memory:');
}

describe('command-receipts: hashCommand', () => {
  it('is stable across key ordering variance', () => {
    const a = { commandId: 'c1', kind: 'submit', payload: { b: 2, a: 1, nested: { y: 2, x: 1 } } };
    const b = { payload: { nested: { x: 1, y: 2 }, a: 1, b: 2 }, kind: 'submit', commandId: 'c1' };
    expect(hashCommand(a)).toBe(hashCommand(b));
  });

  it('differs for different payloads', () => {
    const a = { commandId: 'c1', kind: 'submit', payload: { a: 1 } };
    const b = { commandId: 'c1', kind: 'submit', payload: { a: 2 } };
    expect(hashCommand(a)).not.toBe(hashCommand(b));
  });

  it('differs for arrays in different order', () => {
    const a = { commandId: 'c1', items: [1, 2, 3] };
    const b = { commandId: 'c1', items: [3, 2, 1] };
    expect(hashCommand(a)).not.toBe(hashCommand(b));
  });
});

describe('command-receipts: store', () => {
  let store: CommandReceiptsStore;

  beforeEach(() => {
    store = makeStore();
  });

  afterEach(() => {
    store.close();
  });

  it('insert + get round-trip', () => {
    const cmd = { commandId: 'cmd-1', kind: 'submit', payload: { x: 1 } };
    const hash = hashCommand(cmd);
    const expiresAt = Date.now() + 60_000;
    store.insertPending(cmd, hash, expiresAt);
    const got = store.get('cmd-1');
    expect(got).toBeDefined();
    expect(got!.commandId).toBe('cmd-1');
    expect(got!.payloadHash).toBe(hash);
    expect(got!.outcome).toBe('pending');
    expect(got!.resultSeq).toBeUndefined();
    expect(got!.errorMessage).toBeUndefined();
    expect(got!.expiresAt).toBe(expiresAt);
  });

  it('get returns undefined for unknown commandId', () => {
    expect(store.get('missing')).toBeUndefined();
  });

  it('markAccepted transitions outcome + sets resultSeq', () => {
    const cmd = { commandId: 'cmd-2' };
    store.insertPending(cmd, hashCommand(cmd), Date.now() + 60_000);
    store.markAccepted('cmd-2', 42);
    const got = store.get('cmd-2');
    expect(got).toBeDefined();
    expect(got!.outcome).toBe('accepted');
    expect(got!.resultSeq).toBe(42);
    expect(got!.errorMessage).toBeUndefined();
  });

  it('markRejected transitions outcome + sets errorMessage', () => {
    const cmd = { commandId: 'cmd-3' };
    store.insertPending(cmd, hashCommand(cmd), Date.now() + 60_000);
    store.markRejected('cmd-3', 'bad payload');
    const got = store.get('cmd-3');
    expect(got).toBeDefined();
    expect(got!.outcome).toBe('rejected');
    expect(got!.errorMessage).toBe('bad payload');
    expect(got!.resultSeq).toBeUndefined();
  });

  it('expired entries return undefined', () => {
    const cmd = { commandId: 'cmd-4' };
    const expiresAt = Date.now() - 1_000; // already expired
    store.insertPending(cmd, hashCommand(cmd), expiresAt);
    expect(store.get('cmd-4')).toBeUndefined();
  });

  it('respects explicit now for TTL check', () => {
    const cmd = { commandId: 'cmd-5' };
    const expiresAt = 1_000_000;
    store.insertPending(cmd, hashCommand(cmd), expiresAt);
    expect(store.get('cmd-5', 999_999)).toBeDefined();
    expect(store.get('cmd-5', 1_000_001)).toBeUndefined();
  });
});
