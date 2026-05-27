#!/usr/bin/env bun
/**
 * Drive the running Electron desktop app over CDP — the way browser_* tools drive
 * a page, but pointed at the app's OWN renderer (not the embedded browser pane).
 *
 * The app must be launched with a known CDP port: `MC_CDP_PORT=9333` (see
 * scripts/debug-app.sh). Run this from anywhere; it resolves chrome-remote-interface
 * from the repo root.
 *
 *   bun desktop/scripts/app-debug.ts targets
 *   bun desktop/scripts/app-debug.ts shot [--target main|pane|<idx>] [--out file.png]
 *   bun desktop/scripts/app-debug.ts eval [--target main|pane|<idx>] '<js expression>'
 *   bun desktop/scripts/app-debug.ts console [--target main|pane|<idx>] [--ms 3000]
 *
 * --port N overrides MC_CDP_PORT (default 9333). Target defaults to `main` (the
 * app UI); `pane` selects the embedded controlled-browser view.
 */
import { join } from 'node:path';
import { createRequire } from 'node:module';

// chrome-remote-interface lives in the repo-root node_modules (server dep).
const require = createRequire(join(import.meta.dir, '..', '..', 'package.json'));
const CDP = require('chrome-remote-interface');

const MARKER = 'mc-browser-pane'; // ELECTRON_VIEW_MARKER — the embedded pane's title/url

interface Target { id: string; type: string; title: string; url: string; }

function parseArgs(argv: string[]) {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) flags[a.slice(2)] = argv[++i] ?? '';
    else positional.push(a);
  }
  return { positional, flags };
}

const { positional, flags } = parseArgs(process.argv.slice(2));
const cmd = positional[0];
const port = Number(flags.port ?? process.env.MC_CDP_PORT ?? 9223);
const host = '127.0.0.1';

function isPane(t: Target): boolean {
  return t.title === MARKER || (t.url ?? '').includes(MARKER);
}

async function listPageTargets(): Promise<Target[]> {
  const all: Target[] = await CDP.List({ host, port });
  return all.filter((t) => t.type === 'page');
}

/** Resolve --target (main|pane|<idx>) to a CDP target. Default: main app UI. */
async function resolveTarget(sel: string | undefined): Promise<Target> {
  const pages = await listPageTargets();
  if (pages.length === 0) throw new Error(`no page targets on ${host}:${port} — is the app running with MC_CDP_PORT=${port}?`);
  if (sel && /^\d+$/.test(sel)) {
    const t = pages[Number(sel)];
    if (!t) throw new Error(`no target at index ${sel} (have ${pages.length})`);
    return t;
  }
  if (sel === 'pane') {
    const t = pages.find(isPane);
    if (!t) throw new Error('embedded pane target not found');
    return t;
  }
  // default 'main': the app UI = the page that is NOT the pane.
  return pages.find((t) => !isPane(t)) ?? pages[0];
}

async function withClient<T>(targetId: string, fn: (client: any) => Promise<T>): Promise<T> {
  const client = await CDP({ host, port, target: targetId });
  try { return await fn(client); }
  finally { await client.close(); }
}

async function cmdTargets() {
  const pages = await listPageTargets();
  pages.forEach((t, i) => {
    const tag = isPane(t) ? 'pane' : 'main';
    console.log(`[${i}] ${tag.padEnd(4)} ${t.title || '(untitled)'}\n        ${t.url}`);
  });
  if (pages.length === 0) console.log(`(no page targets on ${host}:${port})`);
}

async function cmdShot() {
  const t = await resolveTarget(flags.target);
  const out = flags.out ?? `/tmp/mc-app-${flags.target ?? 'main'}-${Date.now()}.png`;
  await withClient(t.id, async (client) => {
    await client.Page.enable();
    const { data } = await client.Page.captureScreenshot({ format: 'png', captureBeyondViewport: false });
    await Bun.write(out, Buffer.from(data, 'base64'));
  });
  console.log(out);
}

async function cmdEval() {
  const expr = positional[1];
  if (!expr) throw new Error("usage: eval [--target main|pane] '<js>'");
  const t = await resolveTarget(flags.target);
  const result = await withClient(t.id, async (client) => {
    await client.Runtime.enable();
    const r = await client.Runtime.evaluate({ expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? ''));
    return r.result.value;
  });
  console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 2));
}

async function cmdConsole() {
  const ms = Number(flags.ms ?? 3000);
  const t = await resolveTarget(flags.target);
  await withClient(t.id, async (client) => {
    await client.Runtime.enable();
    await client.Log.enable().catch(() => {});
    client.Runtime.consoleAPICalled((e: any) => {
      const text = (e.args ?? []).map((a: any) => a.value ?? a.description ?? a.type).join(' ');
      console.log(`[${e.type}] ${text}`);
    });
    client.Log.entryAdded?.((e: any) => console.log(`[${e.entry.level}] ${e.entry.text}`));
    console.log(`(capturing console on "${t.title}" for ${ms}ms…)`);
    await new Promise((r) => setTimeout(r, ms));
  });
}

const commands: Record<string, () => Promise<void>> = {
  targets: cmdTargets, shot: cmdShot, eval: cmdEval, console: cmdConsole,
};

const run = commands[cmd ?? ''];
if (!run) {
  console.error('commands: targets | shot | eval | console   (see file header for usage)');
  process.exit(1);
}
run().catch((e) => { console.error('✗', e.message); process.exit(1); });
