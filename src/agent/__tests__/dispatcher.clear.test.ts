import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { AgentSessionRegistry } from '../session-registry.ts';
import { AgentDispatcher } from '../dispatcher.ts';
import { CommandReceiptsStore } from '../command-receipts.ts';
import type { AgentEvent } from '../contracts.ts';

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
    resolveExit: (code) => { proc.exitCode = code; resolveExit(code); stderrCtrl.close(); stdoutCtrl.close(); },
  };
}

let tmpDir: string;
let currentFakes: FakeHandles[];
let broadcasts: Array<{ type: 'agent_event'; channel: string; event: AgentEvent }>;

// A short-lived fake proc that has already exited — used for the `git` probes
// the WorktreeManager now runs through the injected spawn. Exiting non-zero
// makes projectRoot read as non-git so no real worktree work happens.
function makeExitedProc(code: number) {
  return {
    stdin: { write: () => {}, end: () => {} },
    stdout: new ReadableStream<Uint8Array>({ start(c) { c.close(); } }),
    stderr: new ReadableStream<Uint8Array>({ start(c) { c.close(); } }),
    kill: () => {},
    exited: Promise.resolve(code),
    exitCode: code,
    signalCode: null,
    killed: false,
  } as any;
}

function makeSpawn() {
  return (cmd: string[], _opts: any) => {
    // Only the `claude` child should be tracked as a fake; everything else
    // (notably `git`, invoked by the WorktreeManager) gets a no-op exited proc.
    if (cmd[0] !== 'claude') {
      return makeExitedProc(1);
    }
    const f = makeFakeProc();
    currentFakes.push(f);
    return f.proc;
  };
}

beforeEach(async () => {
  // Root under short /tmp, NOT os.tmpdir(): on macOS os.tmpdir() is a long /var/folders path and
  // the derived `<persistDir>/sockets/<hash>.sock` blows past the 104-char AF_UNIX sun_path limit.
  tmpDir = await fs.mkdtemp(path.join('/tmp', 'disp-clear-'));
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

type CapturedWsMsg = { type: 'agent_event'; channel: string; event: AgentEvent };

function makeFakeWs() {
  const sent: CapturedWsMsg[] = [];
  return {
    sent,
    ws: {
      data: { subscriptions: new Set<string>() },
      send: (json: string) => {
        const parsed = JSON.parse(json);
        sent.push(parsed);
      },
    } as any,
  };
}

function makeFakeWsHandler() {
  return {} as any;
}

// The dispatcher's command-receipts middleware requires a commandId on every
// command; inject a unique one per call so dispatch actually runs.
let cmdSeq = 0;
function dispatch(dispatcher: AgentDispatcher, ws: any, cmd: any) {
  return dispatcher.handle(ws, { commandId: `cmd-${++cmdSeq}`, ...cmd });
}

describe('AgentDispatcher agent_clear', () => {
  it('kills the in-flight child and broadcasts session_cleared (with turn_end canceled=true)', async () => {
    const registry = makeRegistry();
    const dispatcher = new AgentDispatcher({
      registry,
      wsHandler: makeFakeWsHandler(),
      resolvedCwd: '/tmp',
      receipts: new CommandReceiptsStore(":memory:"),
    });
    const { ws } = makeFakeWs();

    await dispatch(dispatcher, ws, { kind: 'agent_start', sessionId: 's-clear', cwd: '/tmp' });
    const firstFake = currentFakes[0];
    firstFake.pushStdout(
      JSON.stringify({
        type: 'stream_event',
        event: { type: 'message_start', message: { id: 'm1' } },
      }) + '\n',
    );
    await new Promise((r) => setTimeout(r, 20));

    // allow stop() inside clear to resolve
    setTimeout(() => firstFake.resolveExit(0), 5);
    await dispatch(dispatcher, ws, { kind: 'agent_clear', sessionId: 's-clear' });
    await new Promise((r) => setTimeout(r, 20));

    expect(firstFake.proc.kill).toHaveBeenCalled();

    const turnEnds = broadcasts.filter((b) => b.event.kind === 'turn_end');
    expect(turnEnds.length).toBeGreaterThanOrEqual(1);
    const canceledTurnEnd = turnEnds.find((b) => (b.event as any).canceled === true);
    expect(canceledTurnEnd).toBeDefined();

    const clearedEvents = broadcasts.filter((b) => b.event.kind === 'session_cleared');
    expect(clearedEvents.length).toBe(1);
    expect((clearedEvents[0].event as any).sessionId).toBe('s-clear');
  });

  it('spawns a new child on the next agent_send after clear', async () => {
    const registry = makeRegistry();
    const dispatcher = new AgentDispatcher({
      registry,
      wsHandler: makeFakeWsHandler(),
      resolvedCwd: '/tmp',
      receipts: new CommandReceiptsStore(":memory:"),
    });
    const { ws } = makeFakeWs();

    await dispatch(dispatcher, ws, { kind: 'agent_start', sessionId: 's-clear2', cwd: '/tmp' });
    const firstFake = currentFakes[0];
    firstFake.pushStdout(
      JSON.stringify({
        type: 'stream_event',
        event: { type: 'message_start', message: { id: 'm1' } },
      }) + '\n',
    );
    await new Promise((r) => setTimeout(r, 20));

    const sessionStartsBefore = broadcasts.filter((b) => b.event.kind === 'session_started').length;

    setTimeout(() => firstFake.resolveExit(0), 5);
    await dispatch(dispatcher, ws, { kind: 'agent_clear', sessionId: 's-clear2' });
    await new Promise((r) => setTimeout(r, 20));

    expect(currentFakes.length).toBe(1);

    await dispatch(dispatcher, ws, { kind: 'agent_send', sessionId: 's-clear2', text: 'hi' });
    await new Promise((r) => setTimeout(r, 20));

    expect(currentFakes.length).toBe(2);

    const sessionStartsAfter = broadcasts.filter((b) => b.event.kind === 'session_started').length;
    expect(sessionStartsAfter).toBeGreaterThan(sessionStartsBefore);
  });

  it('is a no-op on agent_clear for an unknown sessionId', async () => {
    const registry = makeRegistry();
    const dispatcher = new AgentDispatcher({
      registry,
      wsHandler: makeFakeWsHandler(),
      resolvedCwd: '/tmp',
      receipts: new CommandReceiptsStore(":memory:"),
    });
    const { ws } = makeFakeWs();

    let threw = false;
    try {
      await dispatch(dispatcher, ws, { kind: 'agent_clear', sessionId: 'never-started' });
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);

    const clearedEvents = broadcasts.filter((b) => b.event.kind === 'session_cleared');
    expect(clearedEvents.length).toBe(0);
    expect(currentFakes.length).toBe(0);
  });
});
