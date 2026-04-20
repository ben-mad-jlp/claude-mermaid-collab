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
    text: `text-${i}`,
  };
}

async function collect(it: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

describe('EventLog restart durability', () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'eventlog-restart-'));
    dbPath = join(dir, 'events.db');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('last_seq and replay content survive a close+reopen against the same file', async () => {
    const s = 'durable';
    const first = new EventLog(dbPath);
    first.append(s, [mkEv(s, 0), mkEv(s, 1), mkEv(s, 2)]);
    expect(first.getLastSeq(s)).toBe(3);
    first.close();

    const second = new EventLog(dbPath);
    try {
      expect(second.getLastSeq(s)).toBe(3);
      const replayed = await collect(second.replay(s, 0));
      expect(replayed.length).toBe(3);
      expect(replayed.map((e) => (e as any).seq)).toEqual([1, 2, 3]);
      expect((replayed[0] as any).text).toBe('text-0');
      expect((replayed[2] as any).text).toBe('text-2');

      // Appending on the reopened instance continues from last_seq.
      const more = second.append(s, [mkEv(s, 3)]);
      expect((more[0] as any).seq).toBe(4);
      expect(second.getLastSeq(s)).toBe(4);
    } finally {
      second.close();
    }
  });
});
