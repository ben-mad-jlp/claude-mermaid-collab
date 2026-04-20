import { describe, it, expect, afterEach, mock } from 'bun:test';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  start,
  type PermissionHandler,
  type PermissionRequest,
  type PermissionResponse,
} from '../permission-socket';

function tmpSockPath(): string {
  return path.join(
    os.tmpdir(),
    `permsock-${Date.now()}-${Math.random().toString(36).slice(2)}.sock`,
  );
}

function dial(p: string, payload: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = net.createConnection(p);
    let buf = '';
    client.on('connect', () => {
      client.write(payload);
    });
    client.on('data', (chunk) => {
      buf += chunk.toString('utf8');
    });
    client.on('end', () => resolve(buf));
    client.on('error', reject);
  });
}

function dialChunked(p: string, parts: string[], delayMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = net.createConnection(p);
    let buf = '';
    client.on('connect', () => {
      client.write(parts[0]);
      setTimeout(() => {
        client.write(parts[1]);
      }, delayMs);
    });
    client.on('data', (chunk) => {
      buf += chunk.toString('utf8');
    });
    client.on('end', () => resolve(buf));
    client.on('error', reject);
  });
}

type StartedServer = {
  server: Awaited<ReturnType<typeof start>>;
  path: string;
};

const started: StartedServer[] = [];

async function startServer(opts: {
  handler: PermissionHandler;
  maxLineBytes?: number;
  socketPath?: string;
}): Promise<StartedServer> {
  const p = opts.socketPath ?? tmpSockPath();
  const server = await start(p, opts.handler, { maxLineBytes: opts.maxLineBytes });
  const s = { server, path: p };
  started.push(s);
  return s;
}

function allowResponse(extra?: Partial<PermissionResponse['hookSpecificOutput']>): PermissionResponse {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      ...extra,
    },
  };
}

afterEach(async () => {
  while (started.length > 0) {
    const s = started.pop()!;
    try {
      await s.server.close();
    } catch {}
    try {
      fs.unlinkSync(s.path);
    } catch {}
  }
});

describe('permission-socket', () => {
  it('round-trip allow: handler return value is returned to client', async () => {
    const verdict: PermissionResponse = {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        permissionDecisionReason: 'ok',
      },
    };
    const handler: PermissionHandler = mock(async () => verdict);
    const { path: p } = await startServer({ handler });
    const req: PermissionRequest = {
      hookEventName: 'PreToolUse',
      toolName: 'Bash',
      toolInput: { command: 'ls' },
    };
    const raw = await dial(p, JSON.stringify(req) + '\n');
    expect(JSON.parse(raw.trim())).toEqual(verdict);
  });

  it('handler receives request fields including sessionId, cwd, foo', async () => {
    let seen: PermissionRequest | null = null;
    const handler: PermissionHandler = mock(async (r) => {
      seen = r;
      return allowResponse();
    });
    const { path: p } = await startServer({ handler });
    const req = {
      hookEventName: 'PreToolUse' as const,
      toolName: 'Bash',
      toolInput: { command: 'ls' },
      sessionId: 'sess-1',
      cwd: '/tmp/xyz',
      foo: 'bar',
    };
    await dial(p, JSON.stringify(req) + '\n');
    expect(seen).toBeTruthy();
    expect(seen!.sessionId).toBe('sess-1');
    expect(seen!.cwd).toBe('/tmp/xyz');
    expect((seen as any).foo).toBe('bar');
    expect(seen!.toolName).toBe('Bash');
  });

  it('invalid JSON returns deny envelope with reason containing "invalid"', async () => {
    const handler = mock(async () => allowResponse());
    const { path: p } = await startServer({ handler });
    const raw = await dial(p, 'this is not json\n');
    const parsed = JSON.parse(raw.trim()) as PermissionResponse;
    expect(parsed.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(
      String(parsed.hookSpecificOutput.permissionDecisionReason ?? '').toLowerCase(),
    ).toContain('invalid');
    expect(handler).not.toHaveBeenCalled();
  });

  it('handler rejection yields deny with "handler error"; server still up for next dial', async () => {
    let call = 0;
    const handler: PermissionHandler = mock(async () => {
      call++;
      if (call === 1) throw new Error('boom');
      return allowResponse();
    });
    const { path: p } = await startServer({ handler });
    const raw1 = await dial(
      p,
      JSON.stringify({ hookEventName: 'PreToolUse', toolName: 'Bash', toolInput: {} }) + '\n',
    );
    const parsed1 = JSON.parse(raw1.trim()) as PermissionResponse;
    expect(parsed1.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(
      String(parsed1.hookSpecificOutput.permissionDecisionReason ?? '').toLowerCase(),
    ).toContain('handler error');

    const raw2 = await dial(
      p,
      JSON.stringify({ hookEventName: 'PreToolUse', toolName: 'Bash', toolInput: {} }) + '\n',
    );
    const parsed2 = JSON.parse(raw2.trim()) as PermissionResponse;
    expect(parsed2.hookSpecificOutput.permissionDecision).toBe('allow');
  });

  it('line exceeding maxLineBytes returns deny and handler is not called', async () => {
    const handler = mock(async () => allowResponse());
    const { path: p } = await startServer({ handler, maxLineBytes: 64 });
    const big = 'x'.repeat(200);
    const req = {
      hookEventName: 'PreToolUse' as const,
      toolName: 'Bash',
      toolInput: { command: big },
    };
    const raw = await dial(p, JSON.stringify(req) + '\n');
    const parsed = JSON.parse(raw.trim()) as PermissionResponse;
    expect(parsed.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(handler).not.toHaveBeenCalled();
  });

  it('close removes the socket file', async () => {
    const handler = mock(async () => allowResponse());
    const s = await startServer({ handler });
    expect(fs.existsSync(s.path)).toBe(true);
    await s.server.close();
    let err: NodeJS.ErrnoException | null = null;
    try {
      fs.statSync(s.path);
    } catch (e) {
      err = e as NodeJS.ErrnoException;
    }
    expect(err).toBeTruthy();
    expect(err!.code).toBe('ENOENT');
    // prevent afterEach from double-closing
    const idx = started.indexOf(s);
    if (idx >= 0) started.splice(idx, 1);
  });

  it('start unlinks a stale socket file', async () => {
    const handler = mock(async () => allowResponse());
    const p = tmpSockPath();
    fs.writeFileSync(p, 'stale');
    expect(fs.existsSync(p)).toBe(true);
    const s = await startServer({ handler, socketPath: p });
    const raw = await dial(
      s.path,
      JSON.stringify({ hookEventName: 'PreToolUse', toolName: 'Bash', toolInput: {} }) + '\n',
    );
    const parsed = JSON.parse(raw.trim()) as PermissionResponse;
    expect(parsed.hookSpecificOutput.permissionDecision).toBe('allow');
  });

  it('close is idempotent', async () => {
    const handler = mock(async () => allowResponse());
    const s = await startServer({ handler });
    await s.server.close();
    await s.server.close();
    const idx = started.indexOf(s);
    if (idx >= 0) started.splice(idx, 1);
  });

  it('10 concurrent clients each get their own verdict keyed off toolInput.i', async () => {
    const handler: PermissionHandler = mock(async (req) => {
      const i = (req.toolInput as { i: number }).i;
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
          permissionDecisionReason: `i=${i}`,
        },
      };
    });
    const { path: p } = await startServer({ handler });
    const dials = Array.from({ length: 10 }, (_, i) =>
      dial(
        p,
        JSON.stringify({ hookEventName: 'PreToolUse', toolName: 'Bash', toolInput: { i } }) + '\n',
      ),
    );
    const results = await Promise.all(dials);
    for (let i = 0; i < 10; i++) {
      const parsed = JSON.parse(results[i].trim()) as PermissionResponse;
      expect(parsed.hookSpecificOutput.permissionDecision).toBe('allow');
      expect(parsed.hookSpecificOutput.permissionDecisionReason).toBe(`i=${i}`);
    }
  });

  it('slow handler for id=0 does not block id=1', async () => {
    const handler: PermissionHandler = mock(async (req) => {
      const i = (req.toolInput as { i: number }).i;
      if (i === 0) {
        await new Promise((r) => setTimeout(r, 200));
        return {
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'allow',
            permissionDecisionReason: 'i=0',
          },
        };
      }
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
          permissionDecisionReason: `i=${i}`,
        },
      };
    });
    const { path: p } = await startServer({ handler });

    const p0 = dial(
      p,
      JSON.stringify({ hookEventName: 'PreToolUse', toolName: 'Bash', toolInput: { i: 0 } }) + '\n',
    );
    // slight stagger to ensure id=0 enters handler first
    await new Promise((r) => setTimeout(r, 20));
    const start1 = Date.now();
    const raw1 = await dial(
      p,
      JSON.stringify({ hookEventName: 'PreToolUse', toolName: 'Bash', toolInput: { i: 1 } }) + '\n',
    );
    const elapsed1 = Date.now() - start1;
    const parsed1 = JSON.parse(raw1.trim()) as PermissionResponse;
    expect(parsed1.hookSpecificOutput.permissionDecisionReason).toBe('i=1');
    expect(elapsed1).toBeLessThan(150);

    const raw0 = await p0;
    const parsed0 = JSON.parse(raw0.trim()) as PermissionResponse;
    expect(parsed0.hookSpecificOutput.permissionDecisionReason).toBe('i=0');
  });

  it('response ends with exactly one trailing newline', async () => {
    const handler = mock(async () => allowResponse());
    const { path: p } = await startServer({ handler });
    const raw = await dial(
      p,
      JSON.stringify({ hookEventName: 'PreToolUse', toolName: 'Bash', toolInput: {} }) + '\n',
    );
    expect(raw.endsWith('\n')).toBe(true);
    expect(raw.endsWith('\n\n')).toBe(false);
    // exactly one newline in the response
    const newlines = (raw.match(/\n/g) ?? []).length;
    expect(newlines).toBe(1);
  });

  it('chunked request (two writes) is reassembled', async () => {
    const handler: PermissionHandler = mock(async (req) => {
      const command = (req.toolInput as { command: string }).command;
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
          permissionDecisionReason: `echoed:${command}`,
        },
      };
    });
    const { path: p } = await startServer({ handler });
    const payload =
      JSON.stringify({
        hookEventName: 'PreToolUse',
        toolName: 'Bash',
        toolInput: { command: 'hello-world' },
      }) + '\n';
    const mid = Math.floor(payload.length / 2);
    const raw = await dialChunked(p, [payload.slice(0, mid), payload.slice(mid)], 5);
    const parsed = JSON.parse(raw.trim()) as PermissionResponse;
    expect(parsed.hookSpecificOutput.permissionDecision).toBe('allow');
    expect(parsed.hookSpecificOutput.permissionDecisionReason).toBe('echoed:hello-world');
  });
});
