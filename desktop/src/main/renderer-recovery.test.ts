import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { attachRendererRecovery } from './renderer-recovery';

type Listener = (...args: any[]) => void;

interface FakeWindow {
  webContents: {
    on(event: string, listener: Listener): void;
    reload: () => void;
    forcefullyCrashRenderer: () => void;
  };
  on(event: string, listener: Listener): void;
  loadURL: (url: string) => void;
}

function makeFakeWindow() {
  const webContentsListeners = new Map<string, Listener>();
  const windowListeners = new Map<string, Listener>();
  const reloadCalls: number[] = [];
  const loadURLCalls: string[] = [];
  const forceCrashCalls: number[] = [];

  const win: FakeWindow = {
    webContents: {
      on(event: string, listener: Listener) {
        webContentsListeners.set(event, listener);
      },
      reload: () => {
        reloadCalls.push(1);
      },
      forcefullyCrashRenderer: () => {
        forceCrashCalls.push(1);
      },
    },
    on(event: string, listener: Listener) {
      windowListeners.set(event, listener);
    },
    loadURL: (url: string) => {
      loadURLCalls.push(url);
    },
  };

  return { win, webContentsListeners, windowListeners, reloadCalls, loadURLCalls, forceCrashCalls };
}

describe('attachRendererRecovery', () => {
  let tempDir: string;
  let forensicsFilePath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'renderer-recovery-test-'));
    forensicsFilePath = path.join(tempDir, 'logs', 'renderer-forensics.log');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function readForensicsLines(): string[] {
    if (!existsSync(forensicsFilePath)) return [];
    return readFileSync(forensicsFilePath, 'utf8').trim().split('\n').filter(Boolean);
  }

  test('render-process-gone triggers exactly one reload and appends a forensics line', () => {
    const fake = makeFakeWindow();
    let now = 100_000;
    const clock = () => now;

    attachRendererRecovery(fake.win, {
      forensicsFilePath,
      clock,
      showUnresponsiveDialog: () => {
        throw new Error('unresponsive dialog must not be called for a crash');
      },
    });

    const crashListener = fake.webContentsListeners.get('render-process-gone');
    expect(crashListener).toBeDefined();

    now = 100_000 + 4321; // uptime = 4321ms
    crashListener!({}, { reason: 'crashed', exitCode: 133 });

    expect(fake.reloadCalls.length).toBe(1);
    expect(fake.loadURLCalls.length).toBe(0);

    const lines = readForensicsLines();
    expect(lines.length).toBe(1);
    const line = lines[0];
    expect(line).toContain('reason=crashed');
    expect(line).toContain('exitCode=133');
    expect(line).toContain('action=reload');
    const uptimeMatch = line.match(/uptimeMs=(\d+)/);
    expect(uptimeMatch).not.toBeNull();
    expect(Number(uptimeMatch![1])).toBe(4321);
  });

  test('4th crash inside the 60s window flips to give-up and loads the crash page instead of reloading', () => {
    const fake = makeFakeWindow();
    let now = 500_000;
    const clock = () => now;

    attachRendererRecovery(fake.win, {
      forensicsFilePath,
      clock,
      showUnresponsiveDialog: () => {
        throw new Error('unresponsive dialog must not be called for a crash');
      },
    });

    const crashListener = fake.webContentsListeners.get('render-process-gone');
    expect(crashListener).toBeDefined();

    // Three crashes inside the 60s window: all reload.
    for (let i = 0; i < 3; i++) {
      now += 1_000;
      crashListener!({}, { reason: 'crashed', exitCode: 133 });
    }
    expect(fake.reloadCalls.length).toBe(3);
    expect(fake.loadURLCalls.length).toBe(0);

    // 4th crash still inside the same 60s window: budget exhausted -> give-up.
    now += 1_000;
    crashListener!({}, { reason: 'oom<"kill" & died>', exitCode: 137 });

    expect(fake.reloadCalls.length).toBe(3); // no additional reload
    expect(fake.loadURLCalls.length).toBe(1);

    const lines = readForensicsLines();
    expect(lines.length).toBe(4);
    expect(lines[3]).toContain('action=give-up');
    expect(lines[3]).toContain('exitCode=137');

    // Crash page names the reason, HTML-escaped (buildCrashPageHtml escaping).
    const url = fake.loadURLCalls[0];
    expect(url.startsWith('data:text/html;charset=utf-8,')).toBe(true);
    const html = decodeURIComponent(url.slice('data:text/html;charset=utf-8,'.length));
    expect(html).toContain('reason: oom&lt;&quot;kill&quot; &amp; died&gt;');
    expect(html).not.toContain('oom<"kill"');
  });

  test('unresponsive calls the injected showUnresponsiveDialog and appends reason=unresponsive', () => {
    const fake = makeFakeWindow();
    let now = 700_000;
    const clock = () => now;

    const dialogCalls: unknown[] = [];
    attachRendererRecovery(fake.win, {
      forensicsFilePath,
      clock,
      showUnresponsiveDialog: (win) => {
        dialogCalls.push(win);
      },
    });

    const unresponsiveListener = fake.windowListeners.get('unresponsive');
    expect(unresponsiveListener).toBeDefined();

    now += 2_500;
    unresponsiveListener!();

    expect(dialogCalls.length).toBe(1);
    expect(dialogCalls[0]).toBe(fake.win);
    expect(fake.reloadCalls.length).toBe(0);
    expect(fake.loadURLCalls.length).toBe(0);

    const lines = readForensicsLines();
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain('reason=unresponsive');
    expect(lines[0]).toContain('action=unresponsive');
  });

  test('this test file never imports or spawns the sidecar supervisor module', () => {
    const self = readFileSync(new URL(import.meta.url).pathname, 'utf8');
    // Match the module name split so this assertion does not match itself.
    const forbidden = 'server-' + 'supervisor';
    expect(self.includes(forbidden)).toBe(false);
    expect(self).not.toMatch(/\bspawn\s*\(/);
  });
});
