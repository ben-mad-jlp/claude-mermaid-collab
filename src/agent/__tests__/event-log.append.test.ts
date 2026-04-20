import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventLog } from '../event-log.js';
import type { AgentEvent, UserMessageEvent } from '../contracts.js';

function mkUserMessage(sessionId: string, i: number): UserMessageEvent {
  return {
    kind: 'user_message',
    sessionId,
    ts: 1000 + i,
    messageId: `m${i}`,
    text: `hello ${i}`,
  };
}

describe('EventLog.append', () => {
  let dir: string;
  let log: EventLog;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'eventlog-append-'));
    log = new EventLog(join(dir, 'events.db'));
  });

  afterEach(() => {
    log.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('monotonic seq per session', () => {
    const s1 = 'sess-1';
    const a = log.append(s1, [mkUserMessage(s1, 0)]);
    const b = log.append(s1, [mkUserMessage(s1, 1)]);
    const c = log.append(s1, [mkUserMessage(s1, 2)]);
    expect((a[0] as any).seq).toBe(1);
    expect((b[0] as any).seq).toBe(2);
    expect((c[0] as any).seq).toBe(3);
    expect(log.getLastSeq(s1)).toBe(3);
  });

  it('first append inserts the agent_sessions row (lastSeq starts at 0)', () => {
    const s = 'new-session';
    expect(log.getLastSeq(s)).toBe(0);
    const out = log.append(s, [mkUserMessage(s, 0)]);
    expect((out[0] as any).seq).toBe(1);
    expect(log.getLastSeq(s)).toBe(1);
  });

  it('multi-event append gives contiguous seqs', () => {
    const s = 'sess-multi';
    const events: AgentEvent[] = [
      mkUserMessage(s, 0),
      mkUserMessage(s, 1),
      mkUserMessage(s, 2),
      mkUserMessage(s, 3),
    ];
    const out = log.append(s, events);
    expect(out.map((e) => (e as any).seq)).toEqual([1, 2, 3, 4]);
    expect(log.getLastSeq(s)).toBe(4);
  });

  it('different sessions have independent seq counters', () => {
    const s1 = 'A';
    const s2 = 'B';
    log.append(s1, [mkUserMessage(s1, 0), mkUserMessage(s1, 1)]);
    const b = log.append(s2, [mkUserMessage(s2, 0)]);
    expect((b[0] as any).seq).toBe(1);
    expect(log.getLastSeq(s1)).toBe(2);
    expect(log.getLastSeq(s2)).toBe(1);
  });

  it('stamps ts when missing (uses Date.now)', () => {
    const s = 'ts-stamp';
    const before = Date.now();
    const ev = { kind: 'user_message', sessionId: s, messageId: 'm', text: 't' } as unknown as AgentEvent;
    const out = log.append(s, [ev]);
    const after = Date.now();
    const stampedTs = (out[0] as any).ts;
    expect(stampedTs).toBeGreaterThanOrEqual(before);
    expect(stampedTs).toBeLessThanOrEqual(after);
  });
});
