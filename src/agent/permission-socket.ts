import { createServer, type Socket, type Server } from 'node:net';
import { unlink } from 'node:fs/promises';
import { EventEmitter } from 'node:events';

export interface PermissionRequest {
  hookEventName: 'PreToolUse';
  toolName: string;
  toolInput: unknown;
  sessionId?: string;
  transcriptPath?: string;
  cwd?: string;
  [k: string]: unknown;
}

export type PermissionVerdict = 'allow' | 'deny' | 'ask';

export interface PermissionResponse {
  hookSpecificOutput: {
    hookEventName: 'PreToolUse';
    permissionDecision: PermissionVerdict;
    permissionDecisionReason?: string;
  };
  systemMessage?: string;
}

export type PermissionHandler = (req: PermissionRequest) => Promise<PermissionResponse>;

export interface StartOpts {
  maxLineBytes?: number;
  timeoutMs?: number;
}

export interface PermissionSocketServer {
  path: string;
  close(): Promise<void>;
  on(
    event: 'error',
    listener: (err: { where: string; message: string; recoverable: boolean }) => void,
  ): this;
}

const DEFAULT_MAX_LINE_BYTES = 1_048_576;
const DEFAULT_TIMEOUT_MS = 60_000;

function denyEnvelope(reason: string): PermissionResponse {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  };
}

function handleConnection(
  socket: Socket,
  handler: PermissionHandler,
  opts: StartOpts | undefined,
  emitter: EventEmitter,
): void {
  const maxLineBytes = opts?.maxLineBytes ?? DEFAULT_MAX_LINE_BYTES;
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  socket.setEncoding('utf8');
  socket.setTimeout(timeoutMs);

  let buf = '';
  let handled = false;
  let byteLen = 0;

  const writeAndEnd = (res: PermissionResponse): void => {
    if (handled) return;
    handled = true;
    try {
      socket.end(JSON.stringify(res) + '\n');
    } catch {
      socket.destroy();
    }
  };

  const denyAndDestroy = (reason: string): void => {
    if (handled) return;
    handled = true;
    try {
      socket.write(JSON.stringify(denyEnvelope(reason)) + '\n');
    } catch {
      // ignore
    }
    socket.destroy();
  };

  socket.on('timeout', () => {
    emitter.emit('error', {
      where: 'timeout',
      message: `permission socket connection timed out after ${timeoutMs}ms`,
      recoverable: true,
    });
    if (!handled) {
      handled = true;
      socket.destroy();
    } else {
      socket.destroy();
    }
  });

  socket.on('error', (err: Error) => {
    emitter.emit('error', {
      where: 'connection',
      message: err.message,
      recoverable: true,
    });
  });

  socket.on('data', (chunk: string) => {
    if (handled) return;
    byteLen += Buffer.byteLength(chunk, 'utf8');
    buf += chunk;

    const nl = buf.indexOf('\n');
    if (nl === -1) {
      if (byteLen > maxLineBytes) {
        denyAndDestroy('request too large');
      }
      return;
    }

    const line = buf.slice(0, nl);
    if (Buffer.byteLength(line, 'utf8') > maxLineBytes) {
      denyAndDestroy('request too large');
      return;
    }

    let req: PermissionRequest;
    try {
      req = JSON.parse(line) as PermissionRequest;
    } catch {
      writeAndEnd(denyEnvelope('invalid request JSON'));
      return;
    }

    Promise.resolve()
      .then(() => handler(req))
      .then(
        (res) => {
          writeAndEnd(res);
        },
        (err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          writeAndEnd(denyEnvelope(`handler error: ${msg}`));
        },
      );
  });
}

export async function start(
  socketPath: string,
  handler: PermissionHandler,
  opts?: StartOpts,
): Promise<PermissionSocketServer> {
  await unlink(socketPath).catch(() => {});

  const emitter = new EventEmitter();

  const srv: Server = createServer((socket) => {
    handleConnection(socket, handler, opts, emitter);
  });

  srv.on('error', (err: Error) => {
    emitter.emit('error', {
      where: 'server',
      message: err.message,
      recoverable: false,
    });
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error): void => {
      srv.removeListener('listening', onListening);
      reject(err);
    };
    const onListening = (): void => {
      srv.removeListener('error', onError);
      resolve();
    };
    srv.once('error', onError);
    srv.once('listening', onListening);
    srv.listen(socketPath);
  });

  const wrapper: PermissionSocketServer = {
    path: socketPath,
    async close(): Promise<void> {
      await new Promise<void>((resolve) => {
        srv.close(() => resolve());
      });
      await unlink(socketPath).catch(() => {});
    },
    on(event, listener): PermissionSocketServer {
      emitter.on(event, listener);
      return wrapper;
    },
  };

  return wrapper;
}
