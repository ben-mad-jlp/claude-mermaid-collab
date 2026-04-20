import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  AgentSessionRegistry,
  uuidv5,
  NAMESPACE_COLLAB_AGENT,
} from '../session-registry.ts';

type FakeProc = {
  stdin: { write: ReturnType<typeof mock>; end: ReturnType<typeof mock> };
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  kill: ReturnType<typeof mock>;
  exited: Promise<number | null>;
  exitCode: number | null;
  signalCode: string | null;
  killed: boolean;
};

type FakeHandles = {
  proc: FakeProc;
  pushStdout: (s: string) => void;
  resolveExit: (code: number | null) => void;
};

function makeFakeProc(): FakeHandles {
  let stdoutCtrl!: ReadableStreamDefaultController<Uint8Array>;
  let stderrCtrl!: ReadableStreamDefaultController<Uint8Array>;
  const enc = new TextEncoder();
  const stdout = new ReadableStream<Uint8Array>({ start(c) { stdoutCtrl = c; } });
  const stderr = new ReadableStream<Uint8Array>({ start(c) { stderrCtrl = c; } });
  let resolveExit!: (code: number | null) => void;
  const exited = new Promise<number | null>((r) => { resolveExit = r; });
  const proc: FakeProc = {
    stdin: { write: mock(() => {}), end: mock(() => {}) },
    stdout,
    stderr,
    kill: mock(() => {}),
    exited,
    exitCode: null,
    signalCode: null,
    killed: false,
  };
  return {
    proc,
    pushStdout: (s) => stdoutCtrl.enqueue(enc.encode(s)),
    resolveExit: (code) => {
      proc.exitCode = code;
      resolveExit(code);
      try { stderrCtrl.close(); } catch {}
      try { stdoutCtrl.close(); } catch {}
    },
  };
}

let tmpDir: string;
let spawnCalls: Array<{ cmd: string[]; opts: any }>;
let currentFakes: FakeHandles[];
let broadcasts: any[];

function makeSpawn() {
  return (cmd: string[], opts: any) => {
    spawnCalls.push({ cmd, opts });
    const f = makeFakeProc();
    currentFakes.push(f);
    return f.proc;
  };
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-reg-tools-test-'));
  spawnCalls = [];
  currentFakes = [];
  broadcasts = [];
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function makeRegistry() {
  return new AgentSessionRegistry({
    broadcast: (msg) => broadcasts.push(msg),
    persistDir: tmpDir,
    spawn: makeSpawn(),
  });
}

function events(): any[] {
  return broadcasts.map((b) => b.event);
}

async function wait(ms = 20) {
  await new Promise((r) => setTimeout(r, ms));
}

describe('AgentSessionRegistry.cancelTurn', () => {
  it('(a) synthesizes tool_call_completed{canceled,historical:false} per running tool_use then turn_end{canceled:true}', async () => {
    const r = makeRegistry();
    await r.getOrCreate('s-cancel-a', '/cwd');
    const fake = currentFakes[0];

    // message_start starts a turn
    fake.pushStdout(JSON.stringify({
      type: 'stream_event',
      event: { type: 'message_start', message: { id: 'msg_A' } },
    }) + '\n');
    // two tool_use starts
    fake.pushStdout(JSON.stringify({
      type: 'stream_event',
      event: {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 'tu_1', name: 'Bash', input: {} },
      },
    }) + '\n');
    fake.pushStdout(JSON.stringify({
      type: 'stream_event',
      event: {
        type: 'content_block_start',
        index: 1,
        content_block: { type: 'tool_use', id: 'tu_2', name: 'Read', input: {} },
      },
    }) + '\n');
    await wait();

    r.cancelTurn('s-cancel-a');
    await wait();

    const evs = events();
    const canceled = evs.filter(
      (e) => e.kind === 'tool_call_completed' && e.status === 'canceled',
    );
    expect(canceled.length).toBe(2);
    const ids = canceled.map((e) => e.toolUseId).sort();
    expect(ids).toEqual(['tu_1', 'tu_2']);
    for (const c of canceled) {
      expect(c.historical).toBe(false);
    }

    // turn_end{canceled:true} must come AFTER both canceled completions.
    const turnEndIdx = evs.findIndex(
      (e) => e.kind === 'turn_end' && e.canceled === true,
    );
    expect(turnEndIdx).toBeGreaterThan(-1);
    const lastCanceledIdx = evs.reduce(
      (acc, e, i) =>
        e.kind === 'tool_call_completed' && e.status === 'canceled' ? i : acc,
      -1,
    );
    expect(turnEndIdx).toBeGreaterThan(lastCanceledIdx);
  });

  it('(b) late tool_result for a canceled toolUseId does not produce a duplicate tool_call_completed', async () => {
    const r = makeRegistry();
    await r.getOrCreate('s-cancel-b', '/cwd');
    const fake = currentFakes[0];

    fake.pushStdout(JSON.stringify({
      type: 'stream_event',
      event: { type: 'message_start', message: { id: 'msg_B' } },
    }) + '\n');
    fake.pushStdout(JSON.stringify({
      type: 'stream_event',
      event: {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 'tu_late', name: 'Bash', input: {} },
      },
    }) + '\n');
    await wait();

    r.cancelTurn('s-cancel-b');
    await wait();

    // Now a late tool_result for the same toolUseId arrives.
    fake.pushStdout(JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'tu_late', content: 'late output' },
        ],
      },
    }) + '\n');
    await wait();

    const completions = events().filter(
      (e) => e.kind === 'tool_call_completed' && e.toolUseId === 'tu_late',
    );
    // Only the synthetic canceled one, no duplicate from the late tool_result.
    expect(completions.length).toBe(1);
    expect(completions[0].status).toBe('canceled');
  });

  it('(c) child exit with a running tool_use synthesizes canceled completion THEN session_ended', async () => {
    const r = makeRegistry();
    await r.getOrCreate('s-cancel-c', '/cwd');
    const fake = currentFakes[0];

    fake.pushStdout(JSON.stringify({
      type: 'stream_event',
      event: { type: 'message_start', message: { id: 'msg_C' } },
    }) + '\n');
    fake.pushStdout(JSON.stringify({
      type: 'stream_event',
      event: {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 'tu_exit', name: 'Bash', input: {} },
      },
    }) + '\n');
    await wait();

    fake.resolveExit(0);
    await wait(30);

    const evs = events();
    const canceledIdx = evs.findIndex(
      (e) =>
        e.kind === 'tool_call_completed' &&
        e.status === 'canceled' &&
        e.toolUseId === 'tu_exit',
    );
    const endedIdx = evs.findIndex((e) => e.kind === 'session_ended');
    expect(canceledIdx).toBeGreaterThan(-1);
    expect(endedIdx).toBeGreaterThan(-1);
    expect(canceledIdx).toBeLessThan(endedIdx);
  });
});

describe('AgentSessionRegistry.backfillHistory', () => {
  async function withFakeHome(
    jsonlLines: any[],
    sessionId: string,
    cwd: string,
    fn: (r: AgentSessionRegistry) => Promise<void>,
  ) {
    const fakeHome = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-home-tools-'));
    const prevHome = process.env.HOME;
    process.env.HOME = fakeHome;
    try {
      const slug = cwd.replace(/\//g, '-');
      const claudeSessionId = uuidv5(sessionId, NAMESPACE_COLLAB_AGENT);
      const jsonlDir = path.join(fakeHome, '.claude', 'projects', slug);
      await fs.mkdir(jsonlDir, { recursive: true });
      await fs.writeFile(
        path.join(jsonlDir, `${claudeSessionId}.jsonl`),
        jsonlLines.map((l) => JSON.stringify(l)).join('\n') + '\n',
      );
      const r = makeRegistry();
      await fn(r);
    } finally {
      if (prevHome === undefined) delete process.env.HOME;
      else process.env.HOME = prevHome;
      await fs.rm(fakeHome, { recursive: true, force: true });
    }
  }

  it('(d) synthesizes tool_call_completed{status:error, error:no_result, historical:true} for unmatched tool_use id', async () => {
    const lines = [
      {
        type: 'assistant',
        uuid: 'a1',
        timestamp: '2026-04-17T10:00:00.000Z',
        message: {
          id: 'msg_hist1',
          role: 'assistant',
          content: [
            { type: 'text', text: 'calling tool' },
            { type: 'tool_use', id: 'tu_unmatched', name: 'Bash', input: { cmd: 'ls' } },
          ],
        },
      },
      // no user tool_result for tu_unmatched
    ];
    await withFakeHome(lines, 's-backfill-d', '/cwd/d', async (r) => {
      await r.getOrCreate('s-backfill-d', '/cwd/d');
      await wait(30);
      const ring = r.transcriptOf('s-backfill-d');
      const noResult = ring.find(
        (e: any) =>
          e.kind === 'tool_call_completed' &&
          e.toolUseId === 'tu_unmatched' &&
          e.status === 'error',
      ) as any;
      expect(noResult).toBeDefined();
      expect(noResult.error).toBe('no_result');
      expect(noResult.historical).toBe(true);
    });
  });

  it('(e) does NOT synthesize error completion when a matching user tool_result exists', async () => {
    const lines = [
      {
        type: 'assistant',
        uuid: 'a1',
        timestamp: '2026-04-17T10:00:00.000Z',
        message: {
          id: 'msg_hist2',
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'tu_matched', name: 'Bash', input: { cmd: 'ls' } },
          ],
        },
      },
      {
        type: 'user',
        uuid: 'u1',
        timestamp: '2026-04-17T10:00:01.000Z',
        message: {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'tu_matched', content: 'ok' },
          ],
        },
      },
    ];
    await withFakeHome(lines, 's-backfill-e', '/cwd/e', async (r) => {
      await r.getOrCreate('s-backfill-e', '/cwd/e');
      await wait(30);
      const ring = r.transcriptOf('s-backfill-e');
      const errors = ring.filter(
        (e: any) =>
          e.kind === 'tool_call_completed' &&
          e.toolUseId === 'tu_matched' &&
          e.status === 'error' &&
          e.error === 'no_result',
      );
      expect(errors.length).toBe(0);
    });
  });
});
