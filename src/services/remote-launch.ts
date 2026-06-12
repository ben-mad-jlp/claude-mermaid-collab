/**
 * remote-launch — start a collab server on a remote machine over SSH.
 *
 * Shells out to the system `ssh` in a Bun PTY (the same PTY primitive the
 * in-app terminals use) so an interactive password prompt can be answered. The
 * password is supplied per-launch by the user and is NEVER persisted. If no
 * password is given we run with BatchMode (keys/agent only) so it fails fast
 * instead of hanging on a prompt.
 *
 * The remote command is wrapped so the server detaches (nohup + background) and
 * the SSH session can return; we then poll the remote /api/health to confirm.
 *
 * SECURITY: a remote launch binds 0.0.0.0 (reachable off-box), so the server
 * MUST come up auth-required or it is an open hole on the LAN. We therefore
 * generate a bearer token, weave MERMAID_AUTH_TOKEN=<token> into the synthesized
 * start command, and hand the token back so the connection that immediately
 * adds/connects uses it. NEVER bind 0.0.0.0 without a token.
 */

import { randomBytes } from 'crypto';

export interface RemoteLaunchOpts {
  host: string;
  port: number;
  /** SSH user; omitted → ssh uses its own default (current user / ~/.ssh/config). */
  user?: string;
  /** One-time SSH password; omitted → rely on keys/agent. Never stored. */
  password?: string;
  /** The command to run on the remote box to start the collab server. */
  command: string;
  /**
   * Bearer token the launched server must require. When set and the command does
   * not already export MERMAID_AUTH_TOKEN, we prepend it so the server comes up
   * auth-required even if the caller passed a hand-edited command.
   */
  token?: string;
}

/** Generate a fresh bearer token for a remote-launched (0.0.0.0-bound) server. */
export function generateAuthToken(): string {
  return randomBytes(24).toString('hex');
}

/**
 * Pure synthesis of the suggested start command from the remote probe results.
 * Extracted from {@link detectRemoteLaunch} so the security-critical invariant
 * "0.0.0.0 implies a token" is unit-testable without a real SSH session.
 *
 * Every command we synthesize sets BOTH MERMAID_BIND_HOST=0.0.0.0 AND
 * MERMAID_AUTH_TOKEN=<token> — binding off-box without a token would leave the
 * server open on the LAN.
 */
export function synthesizeStartCommand(
  probe: { port: number; token: string; mc: string; cache: string; bun: string; snapBun: boolean },
): { suggestedCommand: string; note?: string } {
  const { port, token, mc, cache, bun, snapBun } = probe;
  const auth = `MERMAID_AUTH_TOKEN=${token}`;
  if (mc) {
    return { suggestedCommand: `${auth} MERMAID_BIND_HOST=0.0.0.0 mermaid-collab start --port ${port}` };
  }
  if (cache && bun && !snapBun) {
    return { suggestedCommand: `cd ${cache} && ${auth} MERMAID_BIND_HOST=0.0.0.0 PORT=${port} ${bun} run src/server.ts` };
  }
  if (cache && snapBun) {
    return { suggestedCommand: '', note: 'Only a snap-confined bun was found; it cannot read ~/.claude. Install a non-snap bun (curl -fsSL https://bun.sh/install | bash), then re-detect.' };
  }
  if (!bun) {
    return { suggestedCommand: '', note: 'No bun found on the remote. Install bun (curl -fsSL https://bun.sh/install | bash) or a global mermaid-collab.' };
  }
  return { suggestedCommand: '', note: 'No mermaid-collab CLI or plugin-cache install found. Set the start command manually.' };
}

/**
 * Ensure a launched command exports the bearer token. If the command already
 * sets MERMAID_AUTH_TOKEN (e.g. the synthesized one), it is returned unchanged;
 * otherwise the token is prepended so a hand-edited command can't bind 0.0.0.0
 * open. Returns the command unchanged when no token is supplied.
 */
export function applyTokenToCommand(command: string, token?: string): string {
  if (!token) return command;
  if (/(^|\s)MERMAID_AUTH_TOKEN=/.test(command)) return command;
  return `MERMAID_AUTH_TOKEN=${token} ${command}`;
}

export interface RemoteLaunchResult {
  ok: boolean;
  reachable: boolean;
  output: string;
  error?: string;
}

/** Single-quote a string for safe embedding in a POSIX shell command. */
function shSingleQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

async function probeHealth(host: string, port: number, timeoutMs = 1500): Promise<boolean> {
  try {
    const r = await fetch(`http://${host}:${port}/api/health`, { signal: AbortSignal.timeout(timeoutMs) });
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * Run one SSH command on a remote host and return its exit code + captured
 * output. A PTY (`-tt`) is used only when a password is supplied (to answer the
 * prompt); otherwise `-T` + BatchMode (keys/agent, fails fast). The caller owns
 * whatever the `remoteCommand` does (e.g. detaching a server, or a quick probe).
 */
async function sshRun(
  opts: { host: string; user?: string; password?: string; remoteCommand: string; killAfterMs?: number },
): Promise<{ exitCode: number; output: string; error?: string }> {
  const { host, user, password, remoteCommand, killAfterMs = 25_000 } = opts;
  const target = user ? `${user}@${host}` : host;
  const sshArgs = [
    'ssh',
    ...(password ? ['-tt'] : ['-T']),
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', 'ConnectTimeout=12',
    ...(password
      ? ['-o', 'NumberOfPasswordPrompts=1', '-o', 'PreferredAuthentications=password,keyboard-interactive']
      : ['-o', 'BatchMode=yes']),
    target,
    remoteCommand,
  ];

  let output = '';
  let passwordSent = false;
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn(sshArgs, {
      env: { ...process.env, TERM: 'xterm-256color' },
      terminal: {
        cols: 80,
        rows: 24,
        data(_t, data) {
          output += new TextDecoder().decode(data);
          if (password && !passwordSent && /[Pp]assword:|passphrase/i.test(output)) {
            passwordSent = true;
            try { proc.terminal?.write(password + '\n'); } catch { /* best-effort */ }
          }
        },
        exit() { /* via proc.exited */ },
      },
    });
  } catch (err) {
    return { exitCode: -1, output, error: err instanceof Error ? err.message : 'ssh failed to spawn' };
  }

  const killTimer = setTimeout(() => { try { proc.kill(); } catch { /* ignore */ } }, killAfterMs);
  const exitCode = await proc.exited;
  clearTimeout(killTimer);
  return { exitCode, output };
}

export async function launchRemoteServer(opts: RemoteLaunchOpts): Promise<RemoteLaunchResult> {
  const { host, port, user, password, command, token } = opts;
  if (!host || !command) {
    return { ok: false, reachable: false, output: '', error: 'host and command are required' };
  }

  // A 0.0.0.0-bound server must be auth-required: make sure the token is in the
  // command env even if the caller hand-edited it (no-op if already present).
  const effectiveCommand = applyTokenToCommand(command, token);

  // Detach the server fully so it survives the SSH session closing. We start a
  // new session (setsid, if present — Linux) so a PTY teardown can't SIGHUP it,
  // and fall back to plain nohup. stdio is redirected and stdin closed.
  const q = shSingleQuote(effectiveCommand);
  const remoteScript =
    `if command -v setsid >/dev/null 2>&1; then ` +
    `setsid sh -lc ${q} > "$HOME/.mermaid-collab-launch.log" 2>&1 < /dev/null & ` +
    `else nohup sh -lc ${q} > "$HOME/.mermaid-collab-launch.log" 2>&1 < /dev/null & fi; ` +
    `sleep 1; exit 0`;

  const { exitCode, output, error } = await sshRun({ host, user, password, remoteCommand: remoteScript });
  if (error) return { ok: false, reachable: false, output, error };

  // Poll the remote health endpoint for up to ~30s (first-run TS startup can be
  // slow) for the server to come up.
  let reachable = false;
  for (let i = 0; i < 20; i++) {
    if (await probeHealth(host, port)) { reachable = true; break; }
    await new Promise((r) => setTimeout(r, 1500));
  }

  const ok = reachable || exitCode === 0;
  return {
    ok,
    reachable,
    output: output.slice(-4000),
    error: ok ? undefined : `ssh exited with code ${exitCode} and the server did not become reachable`,
  };
}

export interface RemoteDetectResult {
  ok: boolean;
  /** A best-effort start command to prefill the launch dialog (may be ''). */
  suggestedCommand: string;
  bun?: string;
  mermaidCli?: string;
  pluginCacheDir?: string;
  /** True when the only bun found is snap-confined (can't read ~/.claude). */
  snapBun?: boolean;
  /**
   * Bearer token woven into suggestedCommand. The UI stores this as the
   * connection's token so the immediate connect to the (auth-required) server
   * authenticates. Present whenever a command was synthesized.
   */
  token?: string;
  note?: string;
  output?: string;
  error?: string;
}

/**
 * SSH into a host and probe how to start collab there, then synthesize a
 * suggested start command. Heuristics:
 *  - a global `mermaid-collab` on PATH → use it;
 *  - else the newest plugin-cache version dir + a usable bun → `bun run src/server.ts`;
 *  - prefer a non-snap bun (~/.bun/bin/bun) since snap-confined bun can't read ~/.claude.
 * Always binds 0.0.0.0 so the server is reachable off-box — and therefore always
 * sets MERMAID_AUTH_TOKEN so it comes up auth-required (never open on the LAN).
 */
export async function detectRemoteLaunch(
  opts: { host: string; port: number; user?: string; password?: string; token?: string },
): Promise<RemoteDetectResult> {
  const { host, port, user, password } = opts;
  if (!host) return { ok: false, suggestedCommand: '', error: 'host is required' };
  // Reuse a caller-supplied token (e.g. an existing connection's) or mint one.
  const token = opts.token || generateAuthToken();

  // One probe script; prints KEY=value lines we parse. Prefer ~/.bun/bin/bun.
  const probe =
    `B=""; for c in "$HOME/.bun/bin/bun" "$(command -v bun 2>/dev/null)"; do ` +
    `if [ -n "$c" ] && [ -x "$c" ]; then B="$c"; break; fi; done; ` +
    `echo "BUN=$B"; ` +
    `echo "MC=$(command -v mermaid-collab 2>/dev/null)"; ` +
    `echo "CACHE=$(ls -d $HOME/.claude/plugins/cache/mermaid-collab*/mermaid-collab/[0-9]* 2>/dev/null | sort -V | tail -1)"`;

  const { exitCode, output, error } = await sshRun({ host, user, password, remoteCommand: probe, killAfterMs: 20_000 });
  if (error) return { ok: false, suggestedCommand: '', output, error };
  if (exitCode !== 0) {
    return { ok: false, suggestedCommand: '', output: output.slice(-2000), error: `ssh probe exited with code ${exitCode}` };
  }

  const get = (k: string): string => {
    const m = output.match(new RegExp(`^${k}=(.*)$`, 'm'));
    return m ? m[1].trim() : '';
  };
  const bun = get('BUN');
  const mc = get('MC');
  const cache = get('CACHE');
  const snapBun = !!bun && bun.startsWith('/snap/');

  const { suggestedCommand, note } = synthesizeStartCommand({ port, token, mc, cache, bun, snapBun });

  return {
    ok: true,
    suggestedCommand,
    bun: bun || undefined,
    mermaidCli: mc || undefined,
    pluginCacheDir: cache || undefined,
    snapBun: snapBun || undefined,
    // Only hand back the token when it's actually wired into a command.
    token: suggestedCommand ? token : undefined,
    note,
    output: output.slice(-2000),
  };
}
