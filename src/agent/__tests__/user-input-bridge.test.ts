import { describe, it, expect } from 'bun:test';
import { UserInputBridge } from '../user-input-bridge';

describe('UserInputBridge', () => {
  it('request + respond → promise resolves with value, hasPending becomes false', async () => {
    const bridge = new UserInputBridge();
    const { promptId, promise } = bridge.request('s1', 'pick one?', 'choice', [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
    ]);

    expect(bridge.hasPending('s1', promptId)).toBe(true);

    const matched = bridge.respond('s1', promptId, { kind: 'choice', choiceId: 'a' });
    expect(matched).toBe(true);

    const value = await promise;
    expect(value).toEqual({ kind: 'choice', choiceId: 'a' });
    expect(bridge.hasPending('s1', promptId)).toBe(false);
  });

  it('respond with unknown promptId → returns false', () => {
    const bridge = new UserInputBridge();
    const matched = bridge.respond('s1', 'does-not-exist', { kind: 'text', text: 'nope' });
    expect(matched).toBe(false);
  });

  it('duplicate respond → second returns false', async () => {
    const bridge = new UserInputBridge();
    const { promptId, promise } = bridge.request('s1', 'q', 'text');

    const first = bridge.respond('s1', promptId, { kind: 'text', text: 'answer' });
    expect(first).toBe(true);

    const value = await promise;
    expect(value).toEqual({ kind: 'text', text: 'answer' });

    const second = bridge.respond('s1', promptId, { kind: 'text', text: 'again' });
    expect(second).toBe(false);
  });

  it('timeout → promise rejects with user_input_timeout; respond after timeout returns false', async () => {
    const bridge = new UserInputBridge();
    const { promptId, promise } = bridge.request('s1', 'q', 'text', undefined, 20);

    let err: Error | null = null;
    try {
      await promise;
    } catch (e) {
      err = e as Error;
    }
    expect(err).toBeInstanceOf(Error);
    expect(err?.message).toBe('user_input_timeout');

    const matched = bridge.respond('s1', promptId, { kind: 'text', text: 'late' });
    expect(matched).toBe(false);
    expect(bridge.hasPending('s1', promptId)).toBe(false);
  });

  it('cancelAll → all pending rejected with session_ended', async () => {
    const bridge = new UserInputBridge();
    const a = bridge.request('s1', 'q1', 'text');
    const b = bridge.request('s1', 'q2', 'text');
    const other = bridge.request('s2', 'q3', 'text');

    bridge.cancelAll('s1');

    for (const p of [a.promise, b.promise]) {
      let err: Error | null = null;
      try {
        await p;
      } catch (e) {
        err = e as Error;
      }
      expect(err?.message).toBe('session_ended');
    }

    expect(bridge.hasPending('s1', a.promptId)).toBe(false);
    expect(bridge.hasPending('s1', b.promptId)).toBe(false);
    // Other session unaffected
    expect(bridge.hasPending('s2', other.promptId)).toBe(true);

    // Clean up so bun test doesn't hang on the unresolved 'other' promise.
    bridge.cancelAll('s2');
    try { await other.promise; } catch { /* expected */ }
  });
});
