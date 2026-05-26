// D1 spike — does an Electron WebContentsView behave like a CDP-drivable Chrome?
//
// Validates, in one automated run (no manual GUI interaction):
//   Option A: chrome-remote-interface (the lib the Bun server already uses) connecting
//             to Electron's own --remote-debugging-port, finding the WebContentsView
//             target in /json/list, and driving it with the CDP commands browser.ts uses.
//   Option B: webContents.debugger.sendCommand() from the main process directly.
//
// Writes desktop/spike-result.json and quits. Exit code 0 if Option A works.

const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

// Reuse the server's own chrome-remote-interface install (root node_modules).
const rootRequire = createRequire(path.join(__dirname, '..', 'package.json'));
const CDP = rootRequire('chrome-remote-interface');

const RESULT_PATH = path.join(__dirname, 'spike-result.json');
const result = {
  electronVersion: process.versions.electron,
  chromeVersion: process.versions.chrome,
  port: null,
  jsonList: { ok: false, targets: [], viewTargetFound: false, note: '' },
  optionA: { ok: false, steps: {}, error: null },
  optionB: { ok: false, steps: {}, error: null },
};

// Pick a free loopback port BEFORE app start (remote-debugging-port needs a real port).
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

async function main() {
  const { app } = require('electron');
  const port = await getFreePort();
  result.port = port;

  // Must be set before app 'ready'.
  app.commandLine.appendSwitch('remote-debugging-port', String(port));
  app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1');

  await app.whenReady();
  const { BrowserWindow, WebContentsView } = require('electron');

  // Window kept off-screen-ish + not focused so it doesn't steal the desktop.
  const win = new BrowserWindow({ width: 900, height: 700, show: false });
  const view = new WebContentsView();
  win.contentView.addChildView(view);
  view.setBounds({ x: 0, y: 0, width: 900, height: 700 });

  const TEST_URL =
    'data:text/html,' +
    encodeURIComponent('<title>spike-page</title><h1 id="h">hello-from-webcontentsview</h1>');
  await view.webContents.loadURL(TEST_URL);

  // ---- /json/list discovery (the thing cdp-session.ts relies on) ----
  try {
    const targets = await CDP.List({ host: '127.0.0.1', port });
    result.jsonList.ok = true;
    result.jsonList.targets = targets.map((t) => ({
      type: t.type,
      title: t.title,
      url: (t.url || '').slice(0, 60),
      hasWs: !!t.webSocketDebuggerUrl,
    }));
    const viewTarget = targets.find((t) => (t.title || '').includes('spike-page'));
    result.jsonList.viewTargetFound = !!viewTarget;
    if (!viewTarget) {
      result.jsonList.note =
        'WebContentsView did NOT appear in /json/list — Option A discovery via CDP.List fails as-is.';
    }

    // ---- Option A: drive that target via chrome-remote-interface ----
    if (viewTarget) {
      try {
        const client = await CDP({ host: '127.0.0.1', port, target: viewTarget.id });
        const { Runtime, Page } = client;
        await Runtime.enable();
        await Page.enable();
        const evalRes = await Runtime.evaluate({
          expression: 'document.getElementById("h").textContent',
          returnByValue: true,
        });
        result.optionA.steps.runtimeEvaluate = evalRes.result.value;
        const shot = await Page.captureScreenshot({ format: 'png' });
        result.optionA.steps.screenshotBytes = Buffer.from(shot.data, 'base64').length;
        await client.close();
        result.optionA.ok =
          result.optionA.steps.runtimeEvaluate === 'hello-from-webcontentsview' &&
          result.optionA.steps.screenshotBytes > 0;
      } catch (e) {
        result.optionA.error = String(e && e.message ? e.message : e);
      }
    }
  } catch (e) {
    result.jsonList.note = 'CDP.List threw: ' + String(e && e.message ? e.message : e);
  }

  // ---- Option B: webContents.debugger from main ----
  try {
    const dbg = view.webContents.debugger;
    dbg.attach('1.3');
    result.optionB.steps.attached = true;
    const evalRes = await dbg.sendCommand('Runtime.evaluate', {
      expression: 'document.title',
      returnByValue: true,
    });
    result.optionB.steps.runtimeEvaluate = evalRes.result.value;
    const shot = await dbg.sendCommand('Page.captureScreenshot', { format: 'png' });
    result.optionB.steps.screenshotBytes = Buffer.from(shot.data, 'base64').length;
    dbg.detach();
    result.optionB.ok =
      result.optionB.steps.runtimeEvaluate === 'spike-page' &&
      result.optionB.steps.screenshotBytes > 0;
  } catch (e) {
    result.optionB.error = String(e && e.message ? e.message : e);
  }

  fs.writeFileSync(RESULT_PATH, JSON.stringify(result, null, 2));
  // eslint-disable-next-line no-console
  console.log('\n=== D1 SPIKE RESULT ===\n' + JSON.stringify(result, null, 2) + '\n');
  app.exit(result.optionA.ok ? 0 : 2);
}

main().catch((e) => {
  result.optionA.error = result.optionA.error || String(e && e.stack ? e.stack : e);
  try {
    fs.writeFileSync(RESULT_PATH, JSON.stringify(result, null, 2));
  } catch {}
  console.error(e);
  process.exit(3);
});
