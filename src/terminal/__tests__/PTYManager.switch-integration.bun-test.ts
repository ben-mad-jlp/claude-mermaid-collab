/**
 * REAL-PROCESS integration test for the persistent re-pointable console.
 *
 * The v5.92.23 regression (literal `tmux attach-session …` echoed into the shell
 * → `zsh parse error near ')'`, terminal unusable) slipped past tsc + unit tests
 * because it was a RUNTIME failure: the console PTY auto-created with the user's
 * interactive $SHELL, whose line editor mangled the burst-written command. The
 * fix runs the console on a quiet /bin/sh control shell. tsc can't see that — so
 * this test actually spawns the PTY, switches it at a REAL tmux session, and
 * asserts a client genuinely attached (and nothing parse-errored).
 */
// Runs under the Bun runtime (real Bun.spawn PTY) — NOT vitest. Invoke with:
//   bun test src/terminal/__tests__/PTYManager.switch-integration.bun-test.ts
import { describe, it, expect, afterEach } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { PTYManager } from '../PTYManager';

function tmuxAvailable(): boolean {
  try {
    execFileSync('tmux', ['-V'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const HAVE_TMUX = tmuxAvailable();

/** Minimal ServerWebSocket stand-in that records every 'output' frame. */
class CollectingWS {
  messages: string[] = [];
  closed = false;
  send(data: string) { this.messages.push(data); }
  close() { this.closed = true; }
  outputText(): string {
    return this.messages
      .map(m => { try { return JSON.parse(m); } catch { return null; } })
      .filter(p => p && p.type === 'output')
      .map(p => p.data)
      .join('');
  }
}

const describeMaybe = HAVE_TMUX ? describe : describe.skip;

describeMaybe('console switchTarget — real tmux attach (no shell mangling)', () => {
  const created: string[] = [];
  const manager = new PTYManager();

  afterEach(() => {
    for (const s of created.splice(0)) {
      try { execFileSync('tmux', ['kill-session', '-t', s], { stdio: 'ignore' }); } catch { /* gone */ }
    }
    manager.killAll();
  });

  it('attaches a real tmux client and never leaks a parse error', async () => {
    const sessionId = `console-int-${process.pid}`;
    const base = `mc-switch-int-${process.pid}`;
    created.push(base);

    const ws = new CollectingWS() as any;
    // Non-deferred so output flows to ws immediately (like a live, resized client).
    manager.attach(sessionId, ws);

    // The console must be a quiet control shell, not the interactive $SHELL.
    expect(manager.get(sessionId)!.shell).toBe('/bin/sh');

    manager.switchTarget(sessionId, { base });

    // Give /bin/sh time to run the attach command and tmux to establish a client.
    await new Promise(r => setTimeout(r, 1500));

    // STRONGEST assertion: tmux itself reports a live client on the target.
    const clients = execFileSync('tmux', ['list-clients', '-t', base], { encoding: 'utf-8' });
    expect(clients.trim().length).toBeGreaterThan(0);

    // And the control shell never choked on the written command.
    const out = ws.outputText().toLowerCase();
    expect(out).not.toContain('parse error');
    expect(out).not.toContain('command not found');
  });

  it('RE-POINTS from one target to another without truncating the attach (the switch bug)', async () => {
    const sessionId = `console-reswitch-${process.pid}`;
    const a = `mc-reswitch-a-${process.pid}`;
    const b = `mc-reswitch-b-${process.pid}`;
    created.push(a, b);

    const ws = new CollectingWS() as any;
    manager.attach(sessionId, ws);

    // First attach → A.
    manager.switchTarget(sessionId, { base: a });
    await new Promise(r => setTimeout(r, 1500));
    expect(execFileSync('tmux', ['list-clients', '-t', a], { encoding: 'utf-8' }).trim().length)
      .toBeGreaterThan(0);

    // RE-POINT A → B. The detach-race regression dropped the attach command's
    // leading bytes here, so B never got a client and the shell printed a
    // truncated `|| tmux new-session …`. Gating the re-attach on tmux's
    // `[detached …]` line fixes it.
    manager.switchTarget(sessionId, { base: b });
    await new Promise(r => setTimeout(r, 2000));

    const clientsB = execFileSync('tmux', ['list-clients', '-t', b], { encoding: 'utf-8' });
    expect(clientsB.trim().length).toBeGreaterThan(0);

    // No truncation artifacts in the stream.
    const out = ws.outputText().toLowerCase();
    expect(out).not.toContain('syntax error');
    expect(out).not.toContain('command not found');
    expect(out).not.toContain('unexpected token');
  });
});
