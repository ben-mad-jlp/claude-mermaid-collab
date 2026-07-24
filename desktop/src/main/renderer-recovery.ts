import { mkdirSync, appendFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const RENDERER_RELOAD_MAX = 3;
export const RENDERER_RELOAD_WINDOW_MS = 60_000;

export class RendererReloadBudget {
  private times: number[] = [];
  private readonly max: number;
  private readonly windowMs: number;

  constructor(max: number = RENDERER_RELOAD_MAX, windowMs: number = RENDERER_RELOAD_WINDOW_MS) {
    this.max = max;
    this.windowMs = windowMs;
  }

  record(now: number): 'reload' | 'give-up' {
    this.times.push(now);
    this.times = this.times.filter(t => t > now - this.windowMs);
    return this.times.length > this.max ? 'give-up' : 'reload';
  }
}

export function formatRendererCrashForensics(input: {
  ts: number;
  reason: string;
  exitCode: number | null;
  uptimeMs: number;
  action: 'reload' | 'give-up' | 'unresponsive';
}): string {
  const isoTs = new Date(input.ts).toISOString();
  return `[${isoTs}] renderer-crash reason=${input.reason} exitCode=${input.exitCode} uptimeMs=${input.uptimeMs} action=${input.action}`;
}

export function appendRendererForensics(filePath: string, line: string): void {
  try {
    mkdirSync(dirname(filePath), { recursive: true });
    appendFileSync(filePath, line + '\n');
  } catch { /* best-effort */ }
}

export function buildCrashPageHtml(reason: string): string {
  const escaped = reason
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>App Crashed</title>
<style>
  body { font-family: sans-serif; background: #1e1e1e; color: #eee; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; }
  button { margin-top: 16px; padding: 8px 16px; font-size: 14px; cursor: pointer; }
</style>
</head>
<body>
  <h2>Something went wrong</h2>
  <p>reason: ${escaped}</p>
  <button id="mc-reload" onclick="location.reload()">Reload</button>
</body>
</html>`;
}

interface RendererLike {
  webContents: {
    // Method shorthand, NOT an arrow-typed property: strictFunctionTypes checks
    // function-typed properties contravariantly, so Electron's overloaded
    // `on(event: 'audio-state-changed', ...)` fails against a string-keyed
    // property — method declarations stay bivariant and accept the real type.
    on(event: string, listener: (...args: any[]) => void): void;
    reload: () => void;
    forcefullyCrashRenderer: () => void;
  };
  on(event: string, listener: (...args: any[]) => void): void;
  loadURL: (url: string) => void;
}

export interface AttachRendererRecoveryOptions {
  forensicsFilePath: string;
  clock?: () => number;
  budget?: RendererReloadBudget;
  showUnresponsiveDialog?: (win: RendererLike) => void;
  reloadImpl?: (win: RendererLike) => void;
  loadCrashPageImpl?: (win: RendererLike, html: string) => void;
}

function defaultUnresponsiveDialog(win: RendererLike): void {
  const { dialog } = require('electron');
  dialog
    .showMessageBox(win, {
      type: 'warning',
      message: 'The app is not responding.',
      buttons: ['Wait', 'Force Reload'],
      defaultId: 0,
      cancelId: 0,
    })
    .then((result: { response: number }) => {
      if (result.response === 1) {
        win.webContents.forcefullyCrashRenderer();
      }
    });
}

export function attachRendererRecovery(win: RendererLike, opts: AttachRendererRecoveryOptions): void {
  const clock = opts.clock ?? Date.now;
  const budget = opts.budget ?? new RendererReloadBudget();
  const reloadImpl = opts.reloadImpl ?? ((w: RendererLike) => w.webContents.reload());
  const loadCrashPageImpl =
    opts.loadCrashPageImpl ??
    ((w: RendererLike, html: string) => w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html)));
  const showUnresponsiveDialog = opts.showUnresponsiveDialog ?? defaultUnresponsiveDialog;

  const createdAt = clock();

  win.webContents.on('render-process-gone', (_e: unknown, details: { reason: string; exitCode: number | null }) => {
    const now = clock();
    const uptimeMs = now - createdAt;
    const verdict = budget.record(now);
    appendRendererForensics(
      opts.forensicsFilePath,
      formatRendererCrashForensics({
        ts: now,
        reason: details.reason,
        exitCode: details.exitCode,
        uptimeMs,
        action: verdict,
      })
    );
    if (verdict === 'reload') {
      reloadImpl(win);
    } else {
      loadCrashPageImpl(win, buildCrashPageHtml(details.reason));
    }
  });

  win.on('unresponsive', () => {
    const now = clock();
    appendRendererForensics(
      opts.forensicsFilePath,
      formatRendererCrashForensics({
        ts: now,
        reason: 'unresponsive',
        exitCode: null,
        uptimeMs: now - createdAt,
        action: 'unresponsive',
      })
    );
    showUnresponsiveDialog(win);
  });
}
