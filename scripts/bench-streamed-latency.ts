/**
 * bench-streamed-latency.ts (9b8adcea) — measure the streamed-panel pipeline's two
 * latencies against a REAL owned Chrome, through the same chrome-remote-interface the
 * server uses:
 *   - frame-delivery: CDP screencastFrame metadata.timestamp (wall-clock capture) →
 *     receive in the sink. The capture→server half of "capture → canvas paint".
 *   - input round-trip: Input.dispatchMouseEvent call → resolve (the CDP dispatch ack).
 * Prints p50/p95 for both. Headless, self-contained; spawns + kills its own Chrome.
 */
import { spawn } from 'node:child_process';
// @ts-ignore - chrome-remote-interface ships no types
import CDP from 'chrome-remote-interface';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9444;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function pct(xs: number[], p: number): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))];
}
const fmt = (xs: number[]) =>
  `p50 ${pct(xs, 0.5).toFixed(1)}ms · p95 ${pct(xs, 0.95).toFixed(1)}ms · n=${xs.length} (min ${Math.min(...xs).toFixed(1)} / max ${Math.max(...xs).toFixed(1)})`;

async function main() {
  const proc = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${PORT}`,
    '--no-first-run', '--no-default-browser-check', '--user-data-dir=/tmp/mc-bench-chrome',
    '--window-size=1280,800',
  ], { stdio: 'ignore' });
  await sleep(1500);

  let client: any;
  for (let i = 0; i < 20 && !client; i++) {
    try { client = await CDP({ host: '127.0.0.1', port: PORT }); } catch { await sleep(300); }
  }
  if (!client) { proc.kill(); throw new Error('could not connect to Chrome CDP'); }

  const { Page, Input, Runtime } = client;
  await Page.enable();
  await Runtime.enable();

  // An animated page so the screencast keeps producing frames (it only emits on change).
  // Plain body; the harness drives visual damage from outside (data:-URL inline
  // scripts don't reliably run), guaranteeing a frame each time we mutate.
  await Page.navigate({ url: 'data:text/html,<body style="margin:0;height:100vh"></body>' });
  await sleep(500);
  try { await Page.bringToFront(); } catch {}

  // --- frame-delivery latency ---
  const frameLat: number[] = [];
  let frames = 0;
  const TARGET_FRAMES = 200;
  Page.screencastFrame(async (params: any) => {
    const capMs = (params.metadata?.timestamp ?? 0) * 1000; // CDP wall-clock seconds
    if (capMs > 0) {
      const d = Date.now() - capMs;
      if (d >= 0 && d < 5000) frameLat.push(d);
    }
    frames++;
    try { await Page.screencastFrameAck({ sessionId: params.sessionId }); } catch {}
    // Drive the next visual change so the compositor produces another frame.
    if (frames < TARGET_FRAMES) {
      Runtime.evaluate({ expression: `document.body.style.background='rgb(${(frames * 37) % 256},${(frames * 53) % 256},${(frames * 71) % 256})'` }).catch(() => {});
    }
  });
  await Page.startScreencast({ format: 'jpeg', quality: 60, everyNthFrame: 1 });
  // Kick the first damage; the ack→mutate loop sustains the rest.
  await Runtime.evaluate({ expression: `document.body.style.background='rgb(10,20,30)'` });
  // Wait until we've collected enough frames (or time out).
  for (let i = 0; i < 120 && frames < TARGET_FRAMES; i++) await sleep(50);
  await Page.stopScreencast();

  // --- input round-trip (dispatchMouseEvent) latency ---
  const inputLat: number[] = [];
  for (let i = 0; i < 120; i++) {
    const t = Date.now();
    await Input.dispatchMouseEvent({ type: 'mouseMoved', x: 100 + (i % 200), y: 200 + (i % 100) });
    inputLat.push(Date.now() - t);
    await sleep(10);
  }

  console.log('\n=== streamed-panel latency (real owned Chrome, CDP path) ===');
  console.log('frame-delivery (capture→receive):', frameLat.length ? fmt(frameLat) : 'NO SAMPLES');
  console.log('input dispatch RTT             :', fmt(inputLat));

  try { await client.close(); } catch {}
  proc.kill();
  // Emit a machine-readable line for the scope doc.
  console.log('\nJSON ' + JSON.stringify({
    frameDelivery: frameLat.length ? { p50: +pct(frameLat, 0.5).toFixed(1), p95: +pct(frameLat, 0.95).toFixed(1), n: frameLat.length } : null,
    inputRtt: { p50: +pct(inputLat, 0.5).toFixed(1), p95: +pct(inputLat, 0.95).toFixed(1), n: inputLat.length },
  }));
}

main().catch((e) => { console.error(e); process.exit(1); });
