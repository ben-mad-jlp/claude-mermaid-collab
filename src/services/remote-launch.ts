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
  // Detach the server so ssh can return: background under nohup with stdio
  // redirected and stdin closed, then exit the login shell.
  const remoteScript =
    `nohup sh -lc ${shSingleQuote(command)} > "$HOME/.mermaid-collab-launch.log" 2>&1 < /dev/null & ` +
    `sleep 1; exit 0`;

  const sshArgs = [
    'ssh',
    '-tt', // force a PTY so password / host-key prompts are answerable
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

  // Poll the remote health endpoint for up to ~15s for it to come up.
  let reachable = false;
  for (let i = 0; i < 10; i++) {
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
