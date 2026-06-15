/**
 * `.wslconfig` persistence hardening (Windows port, P4 / 354b9b0f).
 *
 * WSL2 shuts the lightweight VM down after the guest goes idle (`vmIdleTimeout`,
 * default 60s) — which would KILL detached worker tmux sessions the moment the
 * fleet goes quiet, defeating the whole "workers outlive the sidecar" property.
 * We disable the idle shutdown by writing `vmIdleTimeout=-1` under `[wsl2]` in
 * `%USERPROFILE%\.wslconfig`, preserving any settings the user already has.
 *
 * Pure string transform (no fs here) so it's unit-testable; the PowerShell
 * onboarding script reads/writes the file and calls the equivalent.
 */

/** Disable WSL2 idle shutdown. -1 = never. */
export const VM_IDLE_TIMEOUT_DISABLED = -1;

/**
 * Return `.wslconfig` content with `[wsl2] vmIdleTimeout` set to `ms`, preserving
 * every other section/key and the user's existing keys in `[wsl2]`. Idempotent:
 * re-running with the same value is a no-op. `existing` is the current file
 * content ('' when the file doesn't exist).
 */
export function setVmIdleTimeout(existing: string, ms: number = VM_IDLE_TIMEOUT_DISABLED): string {
  // Drop a single trailing newline so the final \n doesn't split into a spurious
  // empty line (which would land stray blanks inside/after sections). Empty input
  // → no lines at all.
  const normalized = existing.replace(/\r\n/g, '\n').replace(/\n$/, '');
  const lines = normalized.length ? normalized.split('\n') : [];
  const out: string[] = [];
  let inWsl2 = false;
  let wrote = false;
  let sawWsl2 = false;

  const flushIntoWsl2 = () => {
    if (inWsl2 && !wrote) {
      out.push(`vmIdleTimeout=${ms}`);
      wrote = true;
    }
  };

  for (const line of lines) {
    const header = line.match(/^\s*\[(.+?)\]\s*$/);
    if (header) {
      // Leaving a section — if it was [wsl2] and we never saw the key, append it.
      flushIntoWsl2();
      inWsl2 = header[1].trim().toLowerCase() === 'wsl2';
      if (inWsl2) sawWsl2 = true;
      out.push(line);
      continue;
    }
    if (inWsl2 && /^\s*vmIdleTimeout\s*=/.test(line)) {
      if (!wrote) {
        out.push(`vmIdleTimeout=${ms}`);
        wrote = true;
      }
      continue; // drop any duplicate/old value
    }
    out.push(line);
  }
  // EOF while still inside [wsl2] without having written the key.
  flushIntoWsl2();

  if (!sawWsl2) {
    // No [wsl2] section at all — append one.
    if (out.length && out[out.length - 1].trim() !== '') out.push('');
    out.push('[wsl2]', `vmIdleTimeout=${ms}`);
  }

  let result = out.join('\n');
  if (!result.endsWith('\n')) result += '\n';
  return result;
}
