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
 */

export interface RemoteLaunchOpts {
  host: string;
  port: number;
  /** SSH user; omitted → ssh uses its own default (current user / ~/.ssh/config). */
  user?: string;
  /** One-time SSH password; omitted → rely on keys/agent. Never stored. */
  password?: string;
  /** The command to run on the remote box to start the collab server. */
  command: string;
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

export async function launchRemoteServer(opts: RemoteLaunchOpts): Promise<RemoteLaunchResult> {
  const { host, port, user, password, command } = opts;
  if (!host || !command) {
    return { ok: false, reachable: false, output: '', error: 'host and command are required' };
  }

  const target = user ? `${user}@${host}` : host;
  // Detach the server fully so it survives the SSH session closing. We start a
  // new session (setsid, if present — Linux) so a PTY teardown can't SIGHUP it,
  // and fall back to plain nohup. stdio is redirected and stdin closed.
  const q = shSingleQuote(command);
  const remoteScript =
    `if command -v setsid >/dev/null 2>&1; then ` +
    `setsid sh -lc ${q} > "$HOME/.mermaid-collab-launch.log" 2>&1 < /dev/null & ` +
    `else nohup sh -lc ${q} > "$HOME/.mermaid-collab-launch.log" 2>&1 < /dev/null & fi; ` +
    `sleep 1; exit 0`;

  // A PTY (`-tt`) is only needed to answer an interactive password prompt; with
  // key/agent auth it forces a controlling terminal whose teardown SIGHUPs the
  // launched server, so omit it unless a password was supplied.
  const sshArgs = [
    'ssh',
    ...(password ? ['-tt'] : ['-T']),
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', 'ConnectTimeout=12',
    ...(password
      ? ['-o', 'NumberOfPasswordPrompts=1', '-o', 'PreferredAuthentications=password,keyboard-interactive']
      : ['-o', 'BatchMode=yes']),
    target,
    remoteScript,
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
          // Answer the password prompt exactly once.
          if (password && !passwordSent && /[Pp]assword:|passphrase/i.test(output)) {
            passwordSent = true;
            try { proc.terminal?.write(password + '\n'); } catch { /* best-effort */ }
          }
        },
        exit() { /* handled via proc.exited below */ },
      },
    });
  } catch (err) {
    return { ok: false, reachable: false, output, error: err instanceof Error ? err.message : 'ssh failed to spawn' };
  }

  // Guard against a hung ssh (e.g. unexpected prompt) — kill after a timeout.
  const killTimer = setTimeout(() => { try { proc.kill(); } catch { /* ignore */ } }, 25_000);
  const exitCode = await proc.exited;
  clearTimeout(killTimer);

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
