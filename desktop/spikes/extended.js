// D1 spike — EXTENDED. Next-milestone validation:
//   1. Electron main spawns + supervises the real Bun server as a sidecar child process.
//   2. The main window loads the REAL collab UI served by that sidecar.
//   3. A WebContentsView "browser pane" is driven via chrome-remote-interface across the
//      FULL CDP surface browser.ts uses — Input / DOM / Emulation / Network — plus the two
//      event-streaming paths (Network.requestWillBeSent, Runtime.consoleAPICalled) that are
//      the hard part of an IPC bridge (R-event-streaming).
//   4. A/B coexistence: can webContents.debugger attach while CRI is already connected?
//
// Writes desktop/spike-extended-result.json, kills the sidecar, quits.

const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const { createRequire } = require('node:module');

const rootRequire = createRequire(path.join(__dirname, '..', 'package.json'));
const CDP = rootRequire('chrome-remote-interface');

const REPO = path.join(__dirname, '..');
const RESULT_PATH = path.join(__dirname, 'spike-extended-result.json');

const result = {
  electronVersion: process.versions.electron,
  sidecar: { spawned: false, healthy: false, port: null, healthMs: null, error: null },
  uiLoad: { ok: false, title: null, error: null },
  cdpSurface: {}, // per-command pass/fail
  events: { networkRequestWillBeSent: false, consoleAPICalled: false },
  coexistence: { criConnected: false, debuggerAttachedWhileCri: false, note: '', error: null },
  ok: false,
};

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function waitForHealth(port, timeoutMs) {
  const start = Date.now();
  const url = `http://127.0.0.1:${port}/api/health`;
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (r.ok) return Date.now() - start;
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`server health timeout after ${timeoutMs}ms`);
}

let serverChild = null;

async function main() {
  const { app } = require('electron');

  // Enable CDP FIRST — remote-debugging-port switches are ignored once the app is 'ready',
  // and the sidecar health-wait below is long enough for Electron to reach ready on its own.
  const cdpPort = await getFreePort();
  app.commandLine.appendSwitch('remote-debugging-port', String(cdpPort));
  app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1');

  // ---- 1. spawn the Bun sidecar on its own port (don't touch the live :9002) ----
  const serverPort = await getFreePort();
  result.sidecar.port = serverPort;
  serverChild = cp.spawn('bun', ['run', 'src/server.ts'], {
    cwd: REPO,
    env: {
      ...process.env,
      PORT: String(serverPort),
      HOST: '127.0.0.1',
      MERMAID_PROJECT: REPO,
      MERMAID_SESSION: 'spike',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  result.sidecar.spawned = !!serverChild.pid;
  serverChild.stderr.on('data', () => {});
  serverChild.stdout.on('data', () => {});

  try {
    result.sidecar.healthMs = await waitForHealth(serverPort, 25000);
    result.sidecar.healthy = true;
  } catch (e) {
    result.sidecar.error = String(e.message || e);
    finishAndQuit(3);
    return;
  }

  // ---- electron ready (CDP switch already set at top) ----
  await app.whenReady();
  const { BrowserWindow, WebContentsView } = require('electron');

  // ---- 2. main window loads the REAL collab UI ----
  const win = new BrowserWindow({ width: 1100, height: 800, show: false });
  try {
    await win.webContents.loadURL(`http://127.0.0.1:${serverPort}`);
    result.uiLoad.title = win.webContents.getTitle();
    result.uiLoad.ok = true;
  } catch (e) {
    result.uiLoad.error = String(e.message || e);
  }

  // ---- 3. browser pane: a test page exercising click + console + fetch ----
  const view = new WebContentsView();
  win.contentView.addChildView(view);
  view.setBounds({ x: 0, y: 0, width: 1100, height: 800 });
  const PANE_HTML =
    '<!doctype html><title>pane</title>' +
    '<button id="b" style="position:absolute;left:10px;top:10px;width:120px;height:40px"' +
    ' onclick="document.title=\'clicked\'">Go</button>' +
    '<script>console.log("pane-console-marker");' +
    'fetch("/__spike_probe__").catch(()=>{});</script>';
  await view.webContents.loadURL('data:text/html,' + encodeURIComponent(PANE_HTML));

  // find the pane target
  const targets = await CDP.List({ host: '127.0.0.1', port: cdpPort });
  const paneTarget = targets.find((t) => (t.title || '') === 'pane');
  if (!paneTarget) {
    result.coexistence.note = 'pane target not found';
    finishAndQuit(2);
    return;
  }

  // ---- Option A: drive the pane via chrome-remote-interface, full surface ----
  const client = await CDP({ host: '127.0.0.1', port: cdpPort, target: paneTarget.id });
  result.coexistence.criConnected = true;
  const { Runtime, Page, DOM, Input, Network, Emulation } = client;

  // event listeners BEFORE triggering
  Network.requestWillBeSent(() => {
    result.events.networkRequestWillBeSent = true;
  });
  Runtime.consoleAPICalled((p) => {
    if (p.args && p.args.some((a) => a.value === 'pane-console-marker')) {
      result.events.consoleAPICalled = true;
    }
  });

  await Runtime.enable();
  await Page.enable();
  await DOM.enable();
  await Network.enable();

  const step = async (name, fn) => {
    try {
      await fn();
      result.cdpSurface[name] = true;
    } catch (e) {
      result.cdpSurface[name] = String(e.message || e);
    }
  };

  await step('Runtime.evaluate', async () => {
    const r = await Runtime.evaluate({ expression: '2+2', returnByValue: true });
    if (r.result.value !== 4) throw new Error('bad eval');
  });
  await step('DOM.querySelector+getBoxModel', async () => {
    const { root } = await DOM.getDocument({});
    const { nodeId } = await DOM.querySelector({ nodeId: root.nodeId, selector: '#b' });
    if (!nodeId) throw new Error('no node');
    await DOM.getBoxModel({ nodeId });
  });
  await step('Input.dispatchMouseEvent(click)', async () => {
    for (const type of ['mousePressed', 'mouseReleased']) {
      await Input.dispatchMouseEvent({ type, x: 60, y: 30, button: 'left', clickCount: 1 });
    }
    await new Promise((r) => setTimeout(r, 150));
    const r = await Runtime.evaluate({ expression: 'document.title', returnByValue: true });
    if (r.result.value !== 'clicked') throw new Error('click did not register: ' + r.result.value);
  });
  await step('Emulation.setDeviceMetricsOverride', async () => {
    await Emulation.setDeviceMetricsOverride({
      width: 375, height: 667, deviceScaleFactor: 2, mobile: true,
      screenWidth: 375, screenHeight: 667, positionX: 0, positionY: 0,
    });
    await new Promise((r) => setTimeout(r, 200));
    const r = await Runtime.evaluate({
      expression: 'JSON.stringify({inner:window.innerWidth,client:document.documentElement.clientWidth,visual:(window.visualViewport&&Math.round(window.visualViewport.width))})',
      returnByValue: true,
    });
    result.cdpSurface['Emulation.widths'] = r.result.value; // record what actually changed
    const w = JSON.parse(r.result.value);
    if (w.inner !== 375 && w.client !== 375 && w.visual !== 375) {
      throw new Error('no width signal hit 375: ' + r.result.value);
    }
  });
  await Emulation.clearDeviceMetricsOverride().catch(() => {});
  await step('Page.captureScreenshot', async () => {
    const s = await Page.captureScreenshot({ format: 'png' });
    if (Buffer.from(s.data, 'base64').length < 100) throw new Error('tiny screenshot');
  });
  // trigger a real network request (ABSOLUTE url — relative fetch on a data: URL has no base)
  await Runtime.evaluate({
    expression: `fetch("http://127.0.0.1:${serverPort}/api/health").catch(()=>{})`,
  });
  await new Promise((r) => setTimeout(r, 400));

  // ---- 4. coexistence: attach webContents.debugger while CRI still connected ----
  try {
    const dbg = view.webContents.debugger;
    dbg.attach('1.3');
    const r = await dbg.sendCommand('Runtime.evaluate', {
      expression: '"both-clients-ok"', returnByValue: true,
    });
    result.coexistence.debuggerAttachedWhileCri = r.result.value === 'both-clients-ok';
    dbg.detach();
    result.coexistence.note = 'webContents.debugger attached successfully while CRI was connected';
  } catch (e) {
    result.coexistence.error = String(e.message || e);
    result.coexistence.note = 'CONFLICT: webContents.debugger could not attach while CRI connected';
  }

  // ---- R3 follow-up: does Electron's NATIVE device emulation work where CDP's didn't? ----
  try {
    view.webContents.enableDeviceEmulation({
      screenPosition: 'mobile',
      screenSize: { width: 375, height: 667 },
      viewSize: { width: 375, height: 667 },
      deviceScaleFactor: 0,
      viewPosition: { x: 0, y: 0 },
      scale: 1,
    });
    await new Promise((r) => setTimeout(r, 250));
    const r = await Runtime.evaluate({ expression: 'window.innerWidth', returnByValue: true });
    result.cdpSurface['electron.enableDeviceEmulation->innerWidth'] = r.result.value;
    view.webContents.disableDeviceEmulation();
  } catch (e) {
    result.cdpSurface['electron.enableDeviceEmulation->innerWidth'] = 'ERR: ' + String(e.message || e);
  }

  await client.close();

  result.ok =
    result.sidecar.healthy &&
    result.uiLoad.ok &&
    Object.values(result.cdpSurface).every((v) => v === true) &&
    result.events.networkRequestWillBeSent &&
    result.events.consoleAPICalled;

  finishAndQuit(result.ok ? 0 : 2);
}

function finishAndQuit(code) {
  try {
    fs.writeFileSync(RESULT_PATH, JSON.stringify(result, null, 2));
  } catch {}
  // eslint-disable-next-line no-console
  console.log('\n=== D1 EXTENDED SPIKE RESULT ===\n' + JSON.stringify(result, null, 2) + '\n');
  try {
    if (serverChild) serverChild.kill('SIGTERM');
  } catch {}
  const { app } = require('electron');
  setTimeout(() => app.exit(code), 200);
}

main().catch((e) => {
  result.coexistence.error = result.coexistence.error || String(e.stack || e);
  finishAndQuit(3);
});
