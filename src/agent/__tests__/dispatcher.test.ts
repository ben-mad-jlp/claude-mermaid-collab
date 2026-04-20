import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { AgentSessionRegistry } from '../session-registry.ts';
import { AgentDispatcher } from '../dispatcher.ts';
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

function makeSpawn() {
  return (_cmd: string[], _opts: any) => {
    const f = makeFakeProc();
    currentFakes.push(f);
    return f.proc;
  };
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-disp-test-'));
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
  // only used for type in dispatcher; nothing in the codepath we test calls it.
  return {} as any;
}

describe('AgentDispatcher', () => {
  describe('agent_cancel (bug #8)', () => {
    it('synthesizes turn_end with canceled=true when a turn is in-flight', async () => {
      const registry = makeRegistry();
      const dispatcher = new AgentDispatcher({
        registry,
        wsHandler: makeFakeWsHandler(),
        resolvedCwd: '/tmp',
      });
      const { ws } = makeFakeWs();

      await dispatcher.handle(ws, { kind: 'agent_start', sessionId: 's-cancel', cwd: '/tmp' });
      // Fire a turn_start via stream frame
      const fake = currentFakes[0];
      fake.pushStdout(
        JSON.stringify({
          type: 'stream_event',
          event: { type: 'message_start', message: { id: 'm1' } },
        }) + '\n',
      );
      await new Promise((r) => setTimeout(r, 20));

      const beforeCancel = broadcasts.filter((b) => b.event.kind === 'turn_end').length;
      expect(beforeCancel).toBe(0);

      await dispatcher.handle(ws, { kind: 'agent_cancel', sessionId: 's-cancel' });

      const turnEnds = broadcasts.filter((b) => b.event.kind === 'turn_end');
      expect(turnEnds.length).toBe(1);
      const evt = turnEnds[0].event as any;
      expect(evt.canceled).toBe(true);
      expect(evt.stopReason).toBe('canceled');
      expect(typeof evt.turnId).toBe('string');
      expect(evt.turnId.length).toBeGreaterThan(0);
    });

    it('is a no-op when no turn is in-flight', async () => {
      const registry = makeRegistry();
      const dispatcher = new AgentDispatcher({
        registry,
        wsHandler: makeFakeWsHandler(),
        resolvedCwd: '/tmp',
      });
      const { ws } = makeFakeWs();

      await dispatcher.handle(ws, { kind: 'agent_start', sessionId: 's-idle', cwd: '/tmp' });
      await dispatcher.handle(ws, { kind: 'agent_cancel', sessionId: 's-idle' });

      const turnEnds = broadcasts.filter((b) => b.event.kind === 'turn_end');
      expect(turnEnds.length).toBe(0);
    });

    it('late result frame after cancel does not re-end the same turn', async () => {
      const registry = makeRegistry();
      const dispatcher = new AgentDispatcher({
        registry,
        wsHandler: makeFakeWsHandler(),
        resolvedCwd: '/tmp',
      });
      const { ws } = makeFakeWs();

      await dispatcher.handle(ws, { kind: 'agent_start', sessionId: 's-race', cwd: '/tmp' });
      const fake = currentFakes[0];
      fake.pushStdout(
        JSON.stringify({
          type: 'stream_event',
          event: { type: 'message_start', message: { id: 'm-race' } },
        }) + '\n',
      );
      await new Promise((r) => setTimeout(r, 20));

      await dispatcher.handle(ws, { kind: 'agent_cancel', sessionId: 's-race' });
      const cancelTurnIds = broadcasts
        .filter((b) => b.event.kind === 'turn_end')
        .map((b) => (b.event as any).turnId);

      // simulate a late result frame
      fake.pushStdout(
        JSON.stringify({ type: 'result', stop_reason: 'end_turn' }) + '\n',
      );
      await new Promise((r) => setTimeout(r, 20));

      const allTurnEnds = broadcasts.filter((b) => b.event.kind === 'turn_end');
      // The second turn_end (from projector) uses a *different* turnId (random) because
      // ctx was cleared. The client's `turn_end` handler only clears currentTurnId if
      // ids match; so stale late end is harmless for in-flight state.
      const canceledOnes = allTurnEnds.filter((b) => (b.event as any).canceled);
      expect(canceledOnes.length).toBe(1);
      expect(canceledOnes[0].event).toMatchObject({ canceled: true });
      // The late projector-emitted turn_end, if present, must not reuse the canceled turnId.
      for (const te of allTurnEnds) {
        const e = te.event as any;
        if (!e.canceled) expect(e.turnId).not.toBe(cancelTurnIds[0]);
      }
    });
  });

  describe('subscribeAndReplay (bug #9)', () => {
    it('replays the cached transcript on agent_start for a new ws', async () => {
      const registry = makeRegistry();
      const dispatcher = new AgentDispatcher({
        registry,
        wsHandler: makeFakeWsHandler(),
        resolvedCwd: '/tmp',
      });

      // Tab A starts the session.
      const tabA = makeFakeWs();
      await dispatcher.handle(tabA.ws, { kind: 'agent_start', sessionId: 's-replay', cwd: '/tmp' });
      // Simulate some activity
      const fake = currentFakes[0];
      fake.pushStdout(
        JSON.stringify({ type: 'system', subtype: 'init', session_id: 'cs', cwd: '/tmp' }) + '\n',
      );
      fake.pushStdout(
        JSON.stringify({
          type: 'stream_event',
          event: { type: 'message_start', message: { id: 'm-1' } },
        }) + '\n',
      );
      fake.pushStdout(
        JSON.stringify({
          type: 'stream_event',
          event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hi' } },
        }) + '\n',
      );
      await new Promise((r) => setTimeout(r, 30));

      // Tab B connects fresh and sends agent_resume.
      const tabB = makeFakeWs();
      await dispatcher.handle(tabB.ws, { kind: 'agent_resume', sessionId: 's-replay' });

      // Tab B should receive the full cached transcript.
      const kinds = tabB.sent.map((m) => m.event.kind);
      expect(kinds).toContain('session_started');
      expect(kinds).toContain('turn_start');
      expect(kinds).toContain('assistant_delta');
      // Subscription was added for the channel.
      expect(tabB.ws.data.subscriptions.has('channel:agent:s-replay')).toBe(true);
    });

    it('replays transcript on agent_start re-attach (same ws command twice)', async () => {
      const registry = makeRegistry();
      const dispatcher = new AgentDispatcher({
        registry,
        wsHandler: makeFakeWsHandler(),
        resolvedCwd: '/tmp',
      });

      const tabA = makeFakeWs();
      await dispatcher.handle(tabA.ws, { kind: 'agent_start', sessionId: 's-start2', cwd: '/tmp' });
      const fake = currentFakes[0];
      fake.pushStdout(
        JSON.stringify({ type: 'system', subtype: 'init', session_id: 'cs', cwd: '/tmp' }) + '\n',
      );
      await new Promise((r) => setTimeout(r, 15));

      const tabB = makeFakeWs();
      // A late-joining tab that sends agent_start (not agent_resume) against an
      // already-running child must also get the cached history.
      await dispatcher.handle(tabB.ws, { kind: 'agent_start', sessionId: 's-start2', cwd: '/tmp' });

      const kinds = tabB.sent.map((m) => m.event.kind);
      expect(kinds).toContain('session_started');
    });
  });
});
