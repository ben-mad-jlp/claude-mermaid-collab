import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { AgentSessionRegistry, uuidv5, NAMESPACE_COLLAB_AGENT } from '../session-registry.ts';

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
let spawnCalls: Array<{ cmd: string[]; opts: any }>;
let currentFakes: FakeHandles[];

function makeSpawn() {
  return (cmd: string[], opts: any) => {
    spawnCalls.push({ cmd, opts });
    const f = makeFakeProc();
    currentFakes.push(f);
    return f.proc;
  };
}

const broadcasts: any[] = [];

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-reg-test-'));
  spawnCalls = [];
  currentFakes = [];
  broadcasts.length = 0;
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

describe('uuidv5', () => {
  it('is deterministic for same name+namespace', () => {
    const a = uuidv5('session-x', NAMESPACE_COLLAB_AGENT);
    const b = uuidv5('session-x', NAMESPACE_COLLAB_AGENT);
    expect(a).toBe(b);
  });

  it('produces a v5 UUID with RFC 4122 variant', () => {
    const u = uuidv5('anything', NAMESPACE_COLLAB_AGENT);
    expect(u).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('differs for different names', () => {
    expect(uuidv5('a', NAMESPACE_COLLAB_AGENT)).not.toBe(uuidv5('b', NAMESPACE_COLLAB_AGENT));
  });
});

describe('AgentSessionRegistry', () => {
  it('getClaudeSessionId is deterministic across instances', () => {
    const r1 = makeRegistry();
    const r2 = makeRegistry();
    expect(r1.getClaudeSessionId('sess1')).toBe(r2.getClaudeSessionId('sess1'));
  });

  it('getOrCreate is idempotent while child is alive', async () => {
    const r = makeRegistry();
    const c1 = await r.getOrCreate('s', '/tmp');
    const c2 = await r.getOrCreate('s', '/tmp');
    expect(c1).toBe(c2);
    expect(spawnCalls.length).toBe(1);
  });

  it('concurrent getOrCreate returns same child and spawns once', async () => {
    const r = makeRegistry();
    const [c1, c2] = await Promise.all([r.getOrCreate('s', '/tmp'), r.getOrCreate('s', '/tmp')]);
    expect(c1).toBe(c2);
    expect(spawnCalls.length).toBe(1);
  });

  it('writes a persistence record at <persistDir>/<sha1(sessionId)>.json', async () => {
    const r = makeRegistry();
    await r.getOrCreate('s-persist', '/cwd/a');
    const files = await fs.readdir(tmpDir);
    expect(files.length).toBe(1);
    const rec = JSON.parse(await fs.readFile(path.join(tmpDir, files[0]), 'utf8'));
    expect(rec.sessionId).toBe('s-persist');
    expect(rec.cwd).toBe('/cwd/a');
    expect(typeof rec.lastSeen).toBe('number');
  });

  it('subsequent registry sees persistence → spawns with --resume', async () => {
    const r1 = makeRegistry();
    await r1.getOrCreate('s-resume', '/cwd/r');
    spawnCalls = [];
    const r2 = makeRegistry();
    await r2.getOrCreate('s-resume', '/cwd/r');
    const argv = spawnCalls[0].cmd;
    expect(argv).toContain('--resume');
    expect(argv).not.toContain('--session-id');
  });

  it('broadcasts session_started on init frame', async () => {
    const r = makeRegistry();
    await r.getOrCreate('s-init', '/cwd');
    const fake = currentFakes[0];
    fake.pushStdout(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'cs-1', cwd: '/cwd' }) + '\n');
    await new Promise((res) => setTimeout(res, 15));
    const sessionStarted = broadcasts.find((b) => b.event.kind === 'session_started');
    expect(sessionStarted).toBeDefined();
    expect(sessionStarted.channel).toBe('agent:s-init');
  });

  it('transcriptOf captures broadcast events', async () => {
    const r = makeRegistry();
    await r.getOrCreate('s-t', '/cwd');
    const fake = currentFakes[0];
    fake.pushStdout(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'cs', cwd: '/cwd' }) + '\n');
    await new Promise((res) => setTimeout(res, 15));
    const ring = r.transcriptOf('s-t');
    expect(ring.length).toBeGreaterThan(0);
    expect(ring[0].kind).toBe('session_started');
  });

  it('transcript ring caps at 500', async () => {
    const r = makeRegistry();
    await r.getOrCreate('s-ring', '/cwd');
    const fake = currentFakes[0];
    for (let i = 0; i < 600; i++) {
      fake.pushStdout(JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'x' } } }) + '\n');
    }
    await new Promise((res) => setTimeout(res, 40));
    const ring = r.transcriptOf('s-ring');
    expect(ring.length).toBe(500);
  });

  it('exit event broadcasts session_ended and removes entry', async () => {
    const r = makeRegistry();
    await r.getOrCreate('s-exit', '/cwd');
    const fake = currentFakes[0];
    fake.resolveExit(0);
    await new Promise((res) => setTimeout(res, 20));
    const ended = broadcasts.find((b) => b.event.kind === 'session_ended');
    expect(ended).toBeDefined();
    expect(r.transcriptOf('s-exit').length).toBe(0);
  });

  it('stop clears transcript and entry', async () => {
    const r = makeRegistry();
    await r.getOrCreate('s-stop', '/cwd');
    const fake = currentFakes[0];
    // allow stop to resolve
    setTimeout(() => fake.resolveExit(0), 5);
    await r.stop('s-stop');
    expect(r.transcriptOf('s-stop').length).toBe(0);
  });

  it('backfills historical transcript from Claude jsonl on --resume', async () => {
    const fakeHome = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-home-'));
    const prevHome = process.env.HOME;
    process.env.HOME = fakeHome;
    try {
      const cwd = '/cwd/backfill';
      const slug = cwd.replace(/\//g, '-');
      const sessionId = 's-backfill';
      const claudeSessionId = uuidv5(sessionId, NAMESPACE_COLLAB_AGENT);
      const jsonlDir = path.join(fakeHome, '.claude', 'projects', slug);
      await fs.mkdir(jsonlDir, { recursive: true });
      const lines = [
        { type: 'queue-operation', operation: 'enqueue' },
        {
          type: 'user',
          uuid: 'u1',
          timestamp: '2026-04-17T10:00:00.000Z',
          message: { role: 'user', content: [{ type: 'text', text: 'hello' }] },
        },
        {
          type: 'assistant',
          uuid: 'a1',
          timestamp: '2026-04-17T10:00:01.000Z',
          message: { id: 'msg_1', role: 'assistant', content: [{ type: 'text', text: 'hi back' }] },
        },
      ];
      await fs.writeFile(
        path.join(jsonlDir, `${claudeSessionId}.jsonl`),
        lines.map((l) => JSON.stringify(l)).join('\n') + '\n',
      );

      const r = makeRegistry();
      await r.getOrCreate(sessionId, cwd);
      await new Promise((res) => setTimeout(res, 20));

      const ring = r.transcriptOf(sessionId);
      const userMsg = ring.find((e) => e.kind === 'user_message') as any;
      const asstComplete = ring.find((e) => e.kind === 'assistant_message_complete') as any;
      expect(userMsg?.text).toBe('hello');
      expect(userMsg?.messageId).toBe('u1');
      expect(asstComplete?.text).toBe('hi back');
      expect(asstComplete?.historical).toBe(true);
      expect(asstComplete?.messageId).toBe('msg_1');
      expect(ring.filter((e) => e.kind === 'turn_start').length).toBe(1);
      expect(ring.filter((e) => e.kind === 'turn_end').length).toBe(1);
    } finally {
      if (prevHome === undefined) delete process.env.HOME;
      else process.env.HOME = prevHome;
      await fs.rm(fakeHome, { recursive: true, force: true });
    }
  });

  it('no backfill when jsonl is absent (fresh session)', async () => {
    const fakeHome = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-home-'));
    const prevHome = process.env.HOME;
    process.env.HOME = fakeHome;
    try {
      const r = makeRegistry();
      await r.getOrCreate('s-fresh', '/cwd/fresh');
      await new Promise((res) => setTimeout(res, 10));
      const ring = r.transcriptOf('s-fresh');
      expect(ring.every((e) => e.kind !== 'assistant_message_complete')).toBe(true);
    } finally {
      if (prevHome === undefined) delete process.env.HOME;
      else process.env.HOME = prevHome;
      await fs.rm(fakeHome, { recursive: true, force: true });
    }
  });
});
