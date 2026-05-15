import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readInstances,
  getDiscoveryPaths,
  deriveSessionId,
} from '../services/instance-discovery';

const REPO_ROOT = join(__dirname, '..', '..');

describe('stale instance cleanup (integration)', () => {
  it(
    'sweeps a SIGKILLed server\'s discovery files on next readInstances',
    async () => {
      const tmpHome = await mkdtemp(join(tmpdir(), 'mc-stale-'));
      const project = '/tmp/projC-' + Date.now();
      const session = 'sessC';
      const sessionId = deriveSessionId(project, session);
      const paths = getDiscoveryPaths(tmpHome);

      const proc = spawn('bun', ['src/server.ts'], {
        cwd: REPO_ROOT,
        env: {
          ...process.env,
          HOME: tmpHome,
          PORT: '0',
          MERMAID_PROJECT: project,
          MERMAID_SESSION: session,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      try {
        // wait for "listening on" log
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error('server did not start within 15s')),
            15_000,
          );
          let buf = '';
          proc.stdout!.on('data', (c: Buffer) => {
            buf += c.toString();
            if (/listening on :\d+, advertised as [a-f0-9]+/.test(buf)) {
              clearTimeout(timeout);
              resolve();
            }
          });
          proc.on('error', err => { clearTimeout(timeout); reject(err); });
        });

        // discovery files should exist
        expect(existsSync(paths.instanceFile(sessionId))).toBe(true);
        expect(existsSync(paths.lockFile(sessionId))).toBe(true);

        // SIGKILL — no signal handlers fire
        await new Promise<void>(resolve => {
          proc.once('exit', () => resolve());
          try { process.kill(proc.pid!, 'SIGKILL'); } catch { resolve(); }
        });

        // give the OS a moment to release the flock fd
        await new Promise(r => setTimeout(r, 300));

        // sweep
        const instances = await readInstances(paths);
        expect(instances).toEqual([]);

        // files unlinked
        expect(existsSync(paths.instanceFile(sessionId))).toBe(false);
        expect(existsSync(paths.lockFile(sessionId))).toBe(false);
      } finally {
        if (proc.exitCode === null) {
          try { proc.kill('SIGKILL'); } catch {}
        }
        await rm(tmpHome, { recursive: true, force: true });
      }
    },
    30_000,
  );
});
