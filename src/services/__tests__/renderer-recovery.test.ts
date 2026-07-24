// Runs via `bun test`. Exercises desktop/src/main/renderer-recovery.ts through injected
// doubles only — no electron import — so scripts/test-backend.ts (which scans src/ only)
// picks up regression coverage for a module that lives under desktop/.
import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import {
  attachRendererRecovery,
  RendererReloadBudget,
  formatRendererCrashForensics,
  RENDERER_RELOAD_MAX,
} from '../../../desktop/src/main/renderer-recovery';

let tmpPathCounter = 0;
function uniqueForensicsPath(): string {
  tmpPathCounter += 1;
  return join(os.tmpdir(), `renderer-crashes-${tmpPathCounter}.log`);
}

function makeRenderer() {
  const webContentsListeners = new Map<string, (...args: any[]) => void>();
  const winListeners = new Map<string, (...args: any[]) => void>();
  const reloadCalls: void[] = [];
  const forcefullyCrashCalls: void[] = [];
  const loadURLCalls: string[] = [];

  const win = {
    webContents: {
      on: (event: string, listener: (...args: any[]) => void) => {
        webContentsListeners.set(event, listener);
      },
      reload: () => {
        reloadCalls.push(undefined);
      },
      forcefullyCrashRenderer: () => {
        forcefullyCrashCalls.push(undefined);
      },
    },
    on: (event: string, listener: (...args: any[]) => void) => {
      winListeners.set(event, listener);
    },
    loadURL: (url: string) => {
      loadURLCalls.push(url);
    },
  };

  function fire(event: string, ...args: any[]) {
    const listener = webContentsListeners.get(event) ?? winListeners.get(event);
    if (!listener) throw new Error(`no listener registered for ${event}`);
    listener(...args);
  }

  return { win, fire, reloadCalls, forcefullyCrashCalls, loadURLCalls };
}

function makeClock(start: number) {
  let now = start;
  return {
    clock: () => now,
    advance: (deltaMs: number) => {
      now += deltaMs;
    },
  };
}

describe('renderer-recovery — attachRendererRecovery', () => {
  it('reloads and logs forensics on a first crash', () => {
    const forensicsFilePath = uniqueForensicsPath();
    const { win, fire, reloadCalls } = makeRenderer();
    const { clock } = makeClock(1_000_000);
    const reloadImpl = () => reloadCalls.push(undefined);
    const loadCrashPageImpl = () => {};
    const showUnresponsiveDialog = () => {};

    attachRendererRecovery(win, {
      forensicsFilePath,
      clock,
      reloadImpl,
      loadCrashPageImpl,
      showUnresponsiveDialog,
    });

    fire('render-process-gone', {}, { reason: 'crashed', exitCode: 133 });

    expect(reloadCalls.length).toBe(1);
    const contents = readFileSync(forensicsFilePath, 'utf8');
    expect(contents).toMatch(/reason=crashed/);
    expect(contents).toMatch(/action=reload/);
  });

  it('gives up and loads the crash page once the reload budget is exhausted', () => {
    const forensicsFilePath = uniqueForensicsPath();
    const { win, fire } = makeRenderer();
    const { clock, advance } = makeClock(2_000_000);
    const reloadCalls: void[] = [];
    const crashPageCalls: Array<{ win: unknown; html: string }> = [];
    const budget = new RendererReloadBudget();

    attachRendererRecovery(win, {
      forensicsFilePath,
      clock,
      budget,
      reloadImpl: () => reloadCalls.push(undefined),
      loadCrashPageImpl: (w, html) => crashPageCalls.push({ win: w, html }),
      showUnresponsiveDialog: () => {},
    });

    for (let i = 0; i < RENDERER_RELOAD_MAX + 1; i++) {
      fire('render-process-gone', {}, { reason: 'crashed', exitCode: 133 });
      advance(10);
    }

    expect(crashPageCalls.length).toBe(1);
    const contents = readFileSync(forensicsFilePath, 'utf8');
    const lines = contents.trim().split('\n');
    expect(lines[lines.length - 1]).toMatch(/action=give-up/);
  });

  it('invokes the unresponsive dialog stub and logs the reason', () => {
    const forensicsFilePath = uniqueForensicsPath();
    const { win, fire } = makeRenderer();
    const { clock } = makeClock(3_000_000);
    let unresponsiveCalls = 0;

    attachRendererRecovery(win, {
      forensicsFilePath,
      clock,
      reloadImpl: () => {},
      loadCrashPageImpl: () => {},
      showUnresponsiveDialog: () => {
        unresponsiveCalls += 1;
      },
    });

    fire('unresponsive');

    expect(unresponsiveCalls).toBe(1);
    const contents = readFileSync(forensicsFilePath, 'utf8');
    expect(contents).toMatch(/reason=unresponsive/);
  });

  it('formatRendererCrashForensics stays importable for direct formatting checks', () => {
    const line = formatRendererCrashForensics({
      ts: 0,
      reason: 'crashed',
      exitCode: 1,
      uptimeMs: 5,
      action: 'reload',
    });
    expect(line).toMatch(/reason=crashed/);
  });
});
