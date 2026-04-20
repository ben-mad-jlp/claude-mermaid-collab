import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { ChildManager } from '../child-manager.ts';

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
  pushStderr: (s: string) => void;
  closeStdout: () => void;
  closeStderr: () => void;
  resolveExit: (code: number | null) => void;
};

function makeFakeProc(): FakeHandles {
  let stdoutCtrl!: ReadableStreamDefaultController<Uint8Array>;
  let stderrCtrl!: ReadableStreamDefaultController<Uint8Array>;
  const enc = new TextEncoder();
  const stdout = new ReadableStream<Uint8Array>({
    start(c) {
      stdoutCtrl = c;
    },
  });
  const stderr = new ReadableStream<Uint8Array>({
    start(c) {
      stderrCtrl = c;
    },
  });
  let resolveExit!: (code: number | null) => void;
  const exited = new Promise<number | null>((r) => {
    resolveExit = r;
  });
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
    pushStderr: (s) => stderrCtrl.enqueue(enc.encode(s)),
    closeStdout: () => stdoutCtrl.close(),
    closeStderr: () => stderrCtrl.close(),
    resolveExit: (code) => {
      proc.exitCode = code;
      resolveExit(code);
    },
  };
}

let lastSpawnArgs: { cmd: string[]; opts: any } | null = null;
let currentFake: FakeHandles | null = null;

beforeEach(() => {
  currentFake = makeFakeProc();
  lastSpawnArgs = null;
});

const testSpawn = (cmd: string[], opts: any) => {
  lastSpawnArgs = { cmd, opts };
  return currentFake!.proc;
};

describe('ChildManager', () => {
  it('builds argv with correct flags (fresh session)', async () => {
    const cm = new ChildManager({
      sessionId: 's1',
      cwd: '/tmp',
      claudeSessionId: 'uuid-1',
      resume: false,
      spawn: testSpawn,
    });
    await cm.start();
    const argv = lastSpawnArgs!.cmd;
    expect(argv[0]).toBe('claude');
    expect(argv).toContain('--print');
    expect(argv).toContain('--input-format');
    expect(argv).toContain('stream-json');
    expect(argv).toContain('--output-format');
    expect(argv).toContain('--include-partial-messages');
    expect(argv).toContain('--verbose');
    expect(argv).toContain('--permission-mode');
    expect(argv).toContain('bypassPermissions');
    expect(argv).toContain('--tools');
    expect(argv).toContain('--session-id');
    expect(argv).toContain('uuid-1');
    expect(argv).not.toContain('--resume');
  });

  it('uses --resume when resume:true', async () => {
    const cm = new ChildManager({
      sessionId: 's1',
      cwd: '/tmp',
      claudeSessionId: 'uuid-2',
      resume: true,
      spawn: testSpawn,
    });
    await cm.start();
    const argv = lastSpawnArgs!.cmd;
    expect(argv).toContain('--resume');
    expect(argv).toContain('uuid-2');
    expect(argv).not.toContain('--session-id');
  });

  it('respects custom claudeBin', async () => {
    const cm = new ChildManager({
      sessionId: 's1',
      cwd: '/tmp',
      claudeSessionId: 'u',
      resume: false,
      claudeBin: '/opt/claude',
      spawn: testSpawn,
    });
    await cm.start();
    expect(lastSpawnArgs!.cmd[0]).toBe('/opt/claude');
  });

  it('writeUserMessage writes one newline-terminated JSON frame', async () => {
    const cm = new ChildManager({ sessionId: 's', cwd: '/', claudeSessionId: 'u', resume: false, spawn: testSpawn });
    await cm.start();
    cm.writeUserMessage('hi');
    const writeMock = currentFake!.proc.stdin.write;
    expect(writeMock).toHaveBeenCalledTimes(1);
    const written = (writeMock.mock.calls[0] as any[])[0] as string;
    expect(written.endsWith('\n')).toBe(true);
    const parsed = JSON.parse(written.trim());
    expect(parsed).toEqual({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: 'hi' }] },
    });
  });

  it('emits stdout-frame for valid JSON lines', async () => {
    const cm = new ChildManager({ sessionId: 's', cwd: '/', claudeSessionId: 'u', resume: false, spawn: testSpawn });
    const frames: unknown[] = [];
    cm.on('stdout-frame', (f) => frames.push(f));
    await cm.start();
    currentFake!.pushStdout('{"type":"assistant"}\n');
    await new Promise((r) => setTimeout(r, 10));
    expect(frames).toEqual([{ type: 'assistant' }]);
  });

  it('emits stderr strings per line', async () => {
    const cm = new ChildManager({ sessionId: 's', cwd: '/', claudeSessionId: 'u', resume: false, spawn: testSpawn });
    const lines: string[] = [];
    cm.on('stderr', (l) => lines.push(l));
    await cm.start();
    currentFake!.pushStderr('boom\n');
    await new Promise((r) => setTimeout(r, 10));
    expect(lines).toEqual(['boom']);
  });

  it('3 consecutive parse errors force-kill and emit unrecoverable error', async () => {
    const cm = new ChildManager({ sessionId: 's', cwd: '/', claudeSessionId: 'u', resume: false, spawn: testSpawn });
    const errs: any[] = [];
    cm.on('error', (e) => errs.push(e));
    await cm.start();
    currentFake!.pushStdout('not json 1\nnot json 2\nnot json 3\n');
    await new Promise((r) => setTimeout(r, 20));
    expect(errs.length).toBeGreaterThanOrEqual(3);
    expect(errs[errs.length - 1].recoverable).toBe(false);
    expect(currentFake!.proc.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('cancelTurn sends SIGINT and emits exit when child terminates', async () => {
    const cm = new ChildManager({ sessionId: 's', cwd: '/', claudeSessionId: 'u', resume: false, spawn: testSpawn });
    const exits: any[] = [];
    cm.on('exit', (e) => exits.push(e));
    await cm.start();
    cm.cancelTurn();
    expect(currentFake!.proc.kill).toHaveBeenCalledWith('SIGINT');
    currentFake!.proc.signalCode = 'SIGINT';
    currentFake!.resolveExit(null);
    await new Promise((r) => setTimeout(r, 10));
    expect(exits[0]).toEqual({ code: null, signal: 'SIGINT' });
  });

  it('exit event propagates code', async () => {
    const cm = new ChildManager({ sessionId: 's', cwd: '/', claudeSessionId: 'u', resume: false, spawn: testSpawn });
    const exits: any[] = [];
    cm.on('exit', (e) => exits.push(e));
    await cm.start();
    currentFake!.resolveExit(0);
    await new Promise((r) => setTimeout(r, 10));
    expect(exits[0].code).toBe(0);
  });

  it('isAlive reflects proc state', async () => {
    const cm = new ChildManager({ sessionId: 's', cwd: '/', claudeSessionId: 'u', resume: false, spawn: testSpawn });
    expect(cm.isAlive).toBe(false);
    await cm.start();
    expect(cm.isAlive).toBe(true);
    currentFake!.resolveExit(0);
    await new Promise((r) => setTimeout(r, 10));
    expect(cm.isAlive).toBe(false);
  });
});
