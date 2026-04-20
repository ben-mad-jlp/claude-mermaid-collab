import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventLog } from '../event-log.js';
import type { AgentEvent, UserMessageEvent } from '../contracts.js';

function mkEv(sessionId: string, i: number): UserMessageEvent {
  return {
    kind: 'user_message',
    sessionId,
    ts: 1000 + i,
    messageId: `m${i}`,
    text: `msg-${i}`,
  };
}

async function collect(it: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

describe('EventLog.replay', () => {
  let dir: string;
  let log: EventLog;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'eventlog-replay-'));
    log = new EventLog(join(dir, 'events.db'));
  });

  afterEach(() => {
    log.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('replay from 0 yields all events in order', async () => {
    const s = 's';
    const evs: AgentEvent[] = [];
    for (let i = 0; i < 10; i++) evs.push(mkEv(s, i));
    log.append(s, evs);
    const got = await collect(log.replay(s, 0));
    expect(got.length).toBe(10);
    expect(got.map((e) => (e as any).seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('replay from N yields only events after N', async () => {
    const s = 's';
    const evs: AgentEvent[] = [];
    for (let i = 0; i < 5; i++) evs.push(mkEv(s, i));
    log.append(s, evs);
    const got = await collect(log.replay(s, 3));
    expect(got.map((e) => (e as any).seq)).toEqual([4, 5]);
  });

  it('replay from beyond tail is empty', async () => {
    const s = 's';
    log.append(s, [mkEv(s, 0), mkEv(s, 1)]);
    const got = await collect(log.replay(s, 100));
    expect(got).toEqual([]);
  });

  it('replay on unknown session is empty', async () => {
    const got = await collect(log.replay('nope', 0));
    expect(got).toEqual([]);
  });

  it('page boundary at 200 events: all events returned with monotonic seqs', async () => {
    const s = 'bulk';
    const evs: AgentEvent[] = [];
    // Use 450 events — crosses two page boundaries (200, 400).
    for (let i = 0; i < 450; i++) evs.push(mkEv(s, i));
    log.append(s, evs);

    const got = await collect(log.replay(s, 0));
    expect(got.length).toBe(450);
    for (let i = 0; i < got.length; i++) {
      expect((got[i] as any).seq).toBe(i + 1);
    }

    // Also test an exact 200-event case yields exactly 200.
    const s2 = 'exact';
    const evs2: AgentEvent[] = [];
    for (let i = 0; i < 200; i++) evs2.push(mkEv(s2, i));
    log.append(s2, evs2);
    const got2 = await collect(log.replay(s2, 0));
    expect(got2.length).toBe(200);
    expect((got2[199] as any).seq).toBe(200);
  });
});
