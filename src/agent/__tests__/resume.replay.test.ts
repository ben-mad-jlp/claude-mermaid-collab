import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventLog } from '../event-log.ts';
import { AgentDispatcher } from '../dispatcher.ts';
import { CommandReceiptsStore } from '../command-receipts.ts';
import type { AgentEvent, UserMessageEvent } from '../contracts.ts';

function mkEv(sessionId: string, i: number): UserMessageEvent {
  return {
    kind: 'user_message',
    sessionId,
    ts: 1000 + i,
    messageId: `m${i}`,
    text: `msg-${i}`,
  };
}

type CapturedFrame = { type: string; [k: string]: unknown };

function makeFakeWs() {
  const sent: CapturedFrame[] = [];
  return {
    sent,
    ws: {
      data: { subscriptions: new Set<string>() },
      send: (json: string) => {
        sent.push(JSON.parse(json) as CapturedFrame);
      },
    } as any,
  };
}

function makeRegistryStub(eventLog: EventLog) {
  return {
    getEventLog: () => eventLog,
    transcriptOf: () => [],
  } as any;
}

describe('agent_resume replay', () => {
  let dir: string;
  let eventLog: EventLog;
  let receipts: CommandReceiptsStore;
  let dispatcher: AgentDispatcher;
  const sessionId = 'sess-resume';

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'resume-replay-'));
    eventLog = new EventLog(join(dir, 'events.db'));
    receipts = new CommandReceiptsStore(':memory:');
    // Pre-populate with 5 events.
    const evs: AgentEvent[] = [];
    for (let i = 0; i < 5; i++) evs.push(mkEv(sessionId, i));
    eventLog.append(sessionId, evs);

    dispatcher = new AgentDispatcher({
      registry: makeRegistryStub(eventLog),
      wsHandler: {} as any,
      resolvedCwd: dir,
      receipts,
    });
  });

  afterEach(() => {
    eventLog.close();
    receipts.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('replays events since lastSeq=2 as historical_event frames then resume_complete', async () => {
    const { ws, sent } = makeFakeWs();
    await dispatcher.handle(ws, { kind: 'agent_resume', sessionId, lastSeq: 2, commandId: 'c1' });

    const historical = sent.filter((f) => f.type === 'historical_event');
    expect(historical.length).toBe(3);
    const seqs = historical.map((f) => f.seq);
    expect(seqs).toEqual([3, 4, 5]);

    const complete = sent.filter((f) => f.type === 'resume_complete');
    expect(complete.length).toBe(1);
    expect(complete[0].lastSeq).toBe(5);

    // resume_complete comes after all historical_events
    const lastHistIdx = sent.map((f) => f.type).lastIndexOf('historical_event');
    const completeIdx = sent.map((f) => f.type).indexOf('resume_complete');
    expect(completeIdx).toBeGreaterThan(lastHistIdx);

    // Receipt marked accepted with finalSeq.
    const receipt = receipts.get('c1');
    expect(receipt?.outcome).toBe('accepted');
    expect(receipt?.resultSeq).toBe(5);

    // Channel subscription added.
    expect(ws.data.subscriptions.has(`channel:agent:${sessionId}`)).toBe(true);
  });

  it('lastSeq=0 replays all 5 events', async () => {
    const { ws, sent } = makeFakeWs();
    await dispatcher.handle(ws, { kind: 'agent_resume', sessionId, lastSeq: 0, commandId: 'c2' });

    const historical = sent.filter((f) => f.type === 'historical_event');
    expect(historical.length).toBe(5);
    expect(historical.map((f) => f.seq)).toEqual([1, 2, 3, 4, 5]);

    const complete = sent.filter((f) => f.type === 'resume_complete');
    expect(complete.length).toBe(1);
    expect(complete[0].lastSeq).toBe(5);
  });

  it('lastSeq beyond tail emits no historical_events, just resume_complete', async () => {
    const { ws, sent } = makeFakeWs();
    await dispatcher.handle(ws, { kind: 'agent_resume', sessionId, lastSeq: 100, commandId: 'c3' });

    const historical = sent.filter((f) => f.type === 'historical_event');
    expect(historical.length).toBe(0);

    const complete = sent.filter((f) => f.type === 'resume_complete');
    expect(complete.length).toBe(1);
  });

  it('defaults lastSeq to 0 when omitted', async () => {
    const { ws, sent } = makeFakeWs();
    await dispatcher.handle(ws, { kind: 'agent_resume', sessionId, commandId: 'c4' });

    const historical = sent.filter((f) => f.type === 'historical_event');
    expect(historical.length).toBe(5);
  });
});
