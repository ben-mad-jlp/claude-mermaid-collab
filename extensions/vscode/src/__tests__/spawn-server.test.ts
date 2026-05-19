/**
 * Unit tests for spawn-server.ts — covers fresh start, duplicate detection
 * (live / dead / unparseable instance files), missing pid, line buffering
 * via pipeLines, and AbortSignal teardown.
 */
import { EventEmitter } from 'events';
import { createHash } from 'crypto';
import * as path from 'path';

import { spawnCollabServer, AlreadyRunning } from '../spawn-server';

// ── mocks ──────────────────────────────────────────────────────────────────
vi.mock('child_process', () => ({ spawn: vi.fn() }));
vi.mock('fs', () => ({ existsSync: vi.fn() }));
vi.mock('fs/promises', () => ({ readFile: vi.fn(), unlink: vi.fn() }));
vi.mock('os', () => ({ homedir: vi.fn() }));

import * as child_process from 'child_process';
import { existsSync } from 'fs';
import * as fsp from 'fs/promises';
import * as os from 'os';

const HOME = '/tmp/fake-home';

/** Fake Readable: EventEmitter + setEncoding. */
function makeStream() {
  const s = new EventEmitter() as any;
  s.setEncoding = vi.fn();
  return s;
}

/** Fake ChildProcess: EventEmitter + pid + stdio + kill. */
function makeChild(pid: number | undefined) {
  const c = new EventEmitter() as any;
  c.pid = pid;
  c.stdout = makeStream();
  c.stderr = makeStream();
  c.kill = vi.fn();
  return c;
}

function makeOutput() {
  return { appendLine: vi.fn(), append: vi.fn(), show: vi.fn() } as any;
}

const SOURCE = { rootDir: '/repo', bunPath: '/usr/local/bin/bun', version: '1.2.3' };

function expectedSessionId(project: string, session: string): string {
  return createHash('sha1').update(project + '\0' + session).digest('hex').slice(0, 12);
}

beforeEach(() => {
  vi.clearAllMocks();
  (os.homedir as any).mockReturnValue(HOME);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('spawnCollabServer', () => {
  it('fresh start: no instance file → spawns bun with discovery env and returns identity', async () => {
    (existsSync as any).mockReturnValue(false);
    const child = makeChild(4242);
    (child_process.spawn as any).mockReturnValue(child);
    const output = makeOutput();

    const result = await spawnCollabServer({
      project: 'projA',
      session: 'sessB',
      source: SOURCE,
      output,
    });

    expect(child_process.spawn).toHaveBeenCalledWith(
      '/usr/local/bin/bun',
      ['src/server.ts'],
      expect.objectContaining({
        cwd: '/repo',
        env: expect.objectContaining({
          PORT: '0',
          MERMAID_PROJECT: 'projA',
          MERMAID_SESSION: 'sessB',
        }),
      }),
    );
    expect(result.pid).toBe(4242);
    expect(result.child).toBe(child);
    expect(result.sessionId).toBe(expectedSessionId('projA', 'sessB'));
  });

  it('existing instance file with a LIVE pid → throws AlreadyRunning', async () => {
    (existsSync as any).mockReturnValue(true);
    (fsp.readFile as any).mockResolvedValue(JSON.stringify({ pid: 999, port: 7777 }));
    vi.spyOn(process, 'kill').mockImplementation((() => true) as any);

    const sessionId = expectedSessionId('p', 's');
    let err: unknown;
    try {
      await spawnCollabServer({ project: 'p', session: 's', source: SOURCE, output: makeOutput() });
    } catch (e) {
      err = e;
    }

    expect(err).toBeInstanceOf(AlreadyRunning);
    const ar = err as AlreadyRunning;
    expect(ar.name).toBe('AlreadyRunning');
    expect(ar.pid).toBe(999);
    expect(ar.port).toBe(7777);
    expect(ar.sessionId).toBe(sessionId);
    expect(child_process.spawn).not.toHaveBeenCalled();
  });

  it('existing instance file with a DEAD pid → cleans stale files and spawns', async () => {
    (existsSync as any).mockReturnValue(true);
    (fsp.readFile as any).mockResolvedValue(JSON.stringify({ pid: 123, port: 5000 }));
    (fsp.unlink as any).mockResolvedValue(undefined);
    vi.spyOn(process, 'kill').mockImplementation((() => { throw new Error('ESRCH'); }) as any);
    const child = makeChild(55);
    (child_process.spawn as any).mockReturnValue(child);

    const sessionId = expectedSessionId('p', 's');
    const result = await spawnCollabServer({
      project: 'p',
      session: 's',
      source: SOURCE,
      output: makeOutput(),
    });

    const dir = path.join(HOME, '.mermaid-collab', 'instances');
    expect(fsp.unlink).toHaveBeenCalledWith(path.join(dir, sessionId + '.json'));
    expect(fsp.unlink).toHaveBeenCalledWith(path.join(dir, sessionId + '.lock'));
    expect(result.pid).toBe(55);
  });

  it('unparseable instance file → treated as stale, cleaned, proceeds', async () => {
    (existsSync as any).mockReturnValue(true);
    (fsp.readFile as any).mockResolvedValue('{ not json');
    (fsp.unlink as any).mockResolvedValue(undefined);
    const killSpy = vi.spyOn(process, 'kill');
    const child = makeChild(7);
    (child_process.spawn as any).mockReturnValue(child);

    const result = await spawnCollabServer({
      project: 'p',
      session: 's',
      source: SOURCE,
      output: makeOutput(),
    });

    expect(killSpy).not.toHaveBeenCalled();
    expect(fsp.unlink).toHaveBeenCalledTimes(2);
    expect(result.pid).toBe(7);
  });

  it('spawn returns child with undefined pid → throws /no pid/', async () => {
    (existsSync as any).mockReturnValue(false);
    (child_process.spawn as any).mockReturnValue(makeChild(undefined));

    await expect(
      spawnCollabServer({ project: 'p', session: 's', source: SOURCE, output: makeOutput() }),
    ).rejects.toThrow(/no pid/);
  });

  it('pipeLines: buffers stdout by line and flushes tail on end', async () => {
    (existsSync as any).mockReturnValue(false);
    const child = makeChild(101);
    (child_process.spawn as any).mockReturnValue(child);
    const output = makeOutput();

    await spawnCollabServer({ project: 'p', session: 's', source: SOURCE, output });

    expect(child.stdout.setEncoding).toHaveBeenCalledWith('utf8');

    child.stdout.emit('data', 'a\nb\n');
    child.stdout.emit('data', 'tail');
    child.stdout.emit('end');

    expect(output.appendLine).toHaveBeenCalledWith('[server] a');
    expect(output.appendLine).toHaveBeenCalledWith('[server] b');
    expect(output.appendLine).toHaveBeenCalledWith('[server] tail');
  });

  it('AbortSignal: aborting the controller kills the child with SIGTERM', async () => {
    (existsSync as any).mockReturnValue(false);
    const child = makeChild(202);
    (child_process.spawn as any).mockReturnValue(child);
    const controller = new AbortController();

    await spawnCollabServer({
      project: 'p',
      session: 's',
      source: SOURCE,
      output: makeOutput(),
      signal: controller.signal,
    });

    expect(child.kill).not.toHaveBeenCalled();
    controller.abort();
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });
});
