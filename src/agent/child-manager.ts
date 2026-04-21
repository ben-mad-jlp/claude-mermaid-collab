import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PermissionMode, RuntimeMode, EffortLevel, ChatMessageAttachment } from './contracts';
import { splitPermissionMode } from './contracts';

export interface ChildManagerOpts {
  sessionId: string;
  cwd: string;
  claudeSessionId: string;
  resume: boolean;
  claudeBin?: string;
  spawn?: (cmd: string[], opts: any) => any;
  permissionMode?: PermissionMode;
  runtimeMode?: RuntimeMode;
  settingsPath?: string;
  socketPath?: string;
  extraArgs?: string[];
  model?: string;
  effort?: EffortLevel;
  displayName?: string;
}

const PERMISSION_MODE_MAP: Record<PermissionMode, string> = {
  supervised: 'default',
  'accept-edits': 'acceptEdits',
  plan: 'plan',
  bypass: 'bypassPermissions',
};

/**
 * Maps a RuntimeMode to extra Claude CLI spawn flags.
 *
 * NOTE: Claude CLI's actual flag for denying tools is `--disallowedTools`
 * (comma- or space-separated tool names), not `--deny-tools` as some blueprint
 * pseudocode suggests. Bypass uses `--dangerously-skip-permissions`.
 *
 * - 'read-only': deny all write/exec tools.
 * - 'edit': no extra flags (default permission behavior).
 * - 'bypass': skip all permission checks.
 */
export function runtimeModeToFlags(mode: RuntimeMode): string[] {
  switch (mode) {
    case 'read-only':
      return ['--disallowedTools', 'Edit,Write,MultiEdit,NotebookEdit,Bash'];
    case 'edit':
      return [];
    case 'bypass':
      return ['--dangerously-skip-permissions'];
  }
}

export interface ChildExitInfo {
  code: number | null;
  signal: string | null;
}

/**
 * Manages a single `claude` CLI child process in headless stream-json mode.
 * Responsibilities: spawn, write user frames, surface stdout/stderr, cancel turn, stop.
 * NOT responsible for respawn-on-exit — orchestrator (AgentSession) handles that by
 * listening for 'exit' events.
 *
 * Emits:
 *   'stdout-frame' (parsed JSON object)
 *   'stderr' (string, one per line)
 *   'exit' (ChildExitInfo)
 *   'error' ({ where, message, recoverable })
 */
export class ChildManager extends EventEmitter {
  private proc: any = null; // Bun.Subprocess
  private parseErrorStreak = 0;
  private cancelTimer: ReturnType<typeof setTimeout> | null = null;
  private stopping = false;

  constructor(private opts: ChildManagerOpts) {
    super();
  }

  get isAlive(): boolean {
    return (
      this.proc !== null &&
      this.proc.exitCode === null &&
      this.proc.killed !== true
    );
  }

  private buildArgv(): string[] {
    const { claudeSessionId, resume } = this.opts;
    const argv = [
      '--print',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--include-partial-messages',
      '--verbose',
      ...(resume ? ['--resume', claudeSessionId] : ['--session-id', claudeSessionId]),
      '--permission-mode',
      PERMISSION_MODE_MAP[this.opts.permissionMode ?? 'bypass'],
      '--setting-sources',
      'project,local',
    ];
    if (this.opts.settingsPath) {
      argv.push('--settings', this.opts.settingsPath);
    }
    argv.push('--include-hook-events');
    // Derive runtime-mode flags: explicit runtimeMode wins; otherwise split
    // the legacy PermissionMode to extract the runtime slice (backward compat).
    const runtime: RuntimeMode =
      this.opts.runtimeMode ??
      splitPermissionMode(this.opts.permissionMode ?? 'bypass').runtime;
    const runtimeFlags = runtimeModeToFlags(runtime);
    if (runtimeFlags.length > 0) argv.push(...runtimeFlags);
    if (this.opts.extraArgs && this.opts.extraArgs.length > 0) {
      argv.push(...this.opts.extraArgs);
    }
    if (this.opts.model) {
      argv.push('--model', this.opts.model);
    }
    if (this.opts.effort) {
      argv.push('--effort', this.opts.effort);
    }
    if (this.opts.displayName) {
      argv.push('--name', this.opts.displayName);
    }
    return argv;
  }

  async start(): Promise<void> {
    const bin = this.opts.claudeBin ?? 'claude';
    const spawn =
      this.opts.spawn ?? ((cmd: string[], opts: any) => (globalThis as any).Bun.spawn(cmd, opts));
    const env = this.opts.socketPath
      ? { ...process.env, COLLAB_SESSION_SOCK: this.opts.socketPath }
      : process.env;
    try {
      this.proc = spawn([bin, ...this.buildArgv()], {
        cwd: this.opts.cwd,
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
        env,
      });
    } catch (err) {
      this.emit('error', {
        where: 'spawn',
        message: err instanceof Error ? err.message : String(err),
        recoverable: false,
      });
      throw err;
    }
    this.startLineReader(this.proc.stdout, 'stdout');
    this.startLineReader(this.proc.stderr, 'stderr');
    this.proc.exited.then((code: number | null) => this.handleExit(code));
  }

  async writeUserMessage(text: string, attachments: ChatMessageAttachment[] = [], resolvedCwd?: string): Promise<void> {
    if (!this.isAlive) {
      this.emit('error', { where: 'stdin', message: 'child not alive', recoverable: false });
      return;
    }
    let frame: string;
    if (attachments.length === 0) {
      frame =
        JSON.stringify({
          type: 'user',
          message: { role: 'user', content: [{ type: 'text', text }] },
        }) + '\n';
    } else {
      const content: unknown[] = [];
      const attachmentsDir = join(resolvedCwd ?? this.opts.cwd ?? '', '.collab', 'attachments', this.opts.sessionId);
      for (const attachment of attachments) {
        try {
          const filePath = join(attachmentsDir, attachment.attachmentId);
          const buf = await readFile(filePath);
          const b64 = buf.toString('base64');
          content.push({ type: 'image', source: { type: 'base64', media_type: attachment.mimeType, data: b64 } });
        } catch (err) {
          console.warn(`[ChildManager] skipping attachment ${attachment.attachmentId}:`, err instanceof Error ? err.message : String(err));
        }
      }
      if (text.trim().length > 0) {
        content.push({ type: 'text', text });
      }
      frame =
        JSON.stringify({
          type: 'user',
          message: { role: 'user', content },
        }) + '\n';
    }
    try {
      this.proc.stdin.write(frame);
    } catch (err) {
      this.emit('error', {
        where: 'stdin',
        message: err instanceof Error ? err.message : String(err),
        recoverable: true,
      });
    }
  }

  cancelTurn(): void {
    // TODO(spike-4): SIGINT semantics unverified. Re-evaluate the 2s → SIGTERM
    // escalation and whether SIGINT alone cleanly cancels a turn without
    // exiting the child, once the Spike 4 runbook results land.
    if (!this.isAlive) return;
    if (this.cancelTimer) {
      clearTimeout(this.cancelTimer);
      this.cancelTimer = null;
    }
    this.proc.kill('SIGINT');
    this.cancelTimer = setTimeout(() => {
      this.cancelTimer = null;
      if (this.isAlive) this.proc.kill('SIGTERM');
    }, 2000);
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.cancelTimer) {
      clearTimeout(this.cancelTimer);
      this.cancelTimer = null;
    }
    if (!this.isAlive) return;
    try {
      this.proc.stdin.end?.();
    } catch {
      /* ignore */
    }
    this.proc.kill('SIGTERM');
    const killTimer = setTimeout(() => {
      if (this.isAlive) this.proc.kill('SIGKILL');
    }, 3000);
    try {
      await this.proc.exited;
    } finally {
      clearTimeout(killTimer);
    }
  }

  private async startLineReader(
    stream: ReadableStream<Uint8Array>,
    channel: 'stdout' | 'stderr',
  ): Promise<void> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx);
          buf = buf.slice(idx + 1);
          if (line.length === 0) continue;
          if (channel === 'stdout') this.handleStdoutLine(line);
          else this.emit('stderr', line);
        }
      }
      if (buf.length > 0 && channel === 'stdout') this.handleStdoutLine(buf);
      else if (buf.length > 0) this.emit('stderr', buf);
    } catch (err) {
      // reader errored — likely because the child exited; swallow
    }
  }

  private handleStdoutLine(line: string): void {
    try {
      const parsed = JSON.parse(line);
      this.parseErrorStreak = 0;
      this.emit('stdout-frame', parsed);
    } catch (err) {
      this.parseErrorStreak++;
      if (this.parseErrorStreak >= 3) {
        this.emit('error', {
          where: 'parse',
          message: `3 consecutive parse errors; forcing restart. last line: ${line.slice(0, 120)}`,
          recoverable: false,
        });
        try {
          this.proc?.kill('SIGKILL');
        } catch {
          /* ignore */
        }
      } else {
        this.emit('error', {
          where: 'parse',
          message: err instanceof Error ? err.message : String(err),
          recoverable: true,
        });
      }
    }
  }

  private handleExit(code: number | null): void {
    const signal = this.proc?.signalCode ?? null;
    this.emit('exit', { code, signal } satisfies ChildExitInfo);
  }
}
