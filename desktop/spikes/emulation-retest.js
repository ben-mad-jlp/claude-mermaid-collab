// D1 follow-up — is the device-emulation gap just an artifact of show:false?
// This time the window IS shown and the WebContentsView is given real bounds.
// Tests both CDP Emulation.setDeviceMetricsOverride and Electron's native
// enableDeviceEmulation, reading innerWidth before/after each. Then quits.

const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

const rootRequire = createRequire(path.join(__dirname, '..', 'package.json'));
const CDP = rootRequire('chrome-remote-interface');

const RESULT_PATH = path.join(__dirname, 'spike-emulation-result.json');
const result = { electronVersion: process.versions.electron, windowShown: true, baseline: null, cdpEmulation: null, electronEmulation: null, ok: false };

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
  });
}

async function main() {
  const { app } = require('electron');
  const cdpPort = await getFreePort();
  app.commandLine.appendSwitch('remote-debugging-port', String(cdpPort));
  app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1');
  await app.whenReady();
  const { BrowserWindow, WebContentsView } = require('electron');

  const win = new BrowserWindow({ width: 1100, height: 800, show: true });
  win.showInactive(); // visible but don't steal keyboard focus
  const view = new WebContentsView();
  win.contentView.addChildView(view);
  view.setBounds({ x: 0, y: 0, width: 1100, height: 800 });

  await view.webContents.loadURL('data:text/html,' + encodeURIComponent('<meta name="viewport" content="width=device-width,initial-scale=1"><title>pane</title><h1>emu</h1>'));
  await new Promise((r) => setTimeout(r, 400)); // let layout settle now that it is visible

  const targets = await CDP.List({ host: '127.0.0.1', port: cdpPort });
  const t = targets.find((x) => (x.title || '') === 'pane');
  const client = await CDP({ host: '127.0.0.1', port: cdpPort, target: t.id });
  const { Runtime, Emulation } = client;
  await Runtime.enable();

  const widths = async () => {
    const r = await Runtime.evaluate({
      expression: 'JSON.stringify({inner:window.innerWidth,client:document.documentElement.clientWidth})',
      returnByValue: true,
    });
    return JSON.parse(r.result.value);
  };

  result.baseline = await widths();

  // (1) CDP path
  try {
    await Emulation.setDeviceMetricsOverride({ width: 375, height: 667, deviceScaleFactor: 2, mobile: true });
    await new Promise((r) => setTimeout(r, 250));
    result.cdpEmulation = await widths();
    await Emulation.clearDeviceMetricsOverride().catch(() => {});
    await new Promise((r) => setTimeout(r, 150));
  } catch (e) { result.cdpEmulation = { error: String(e.message || e) }; }

  // (2) Electron native path
  try {
    view.webContents.enableDeviceEmulation({
      screenPosition: 'mobile', screenSize: { width: 375, height: 667 },
      viewSize: { width: 375, height: 667 }, deviceScaleFactor: 0,
      viewPosition: { x: 0, y: 0 }, scale: 1,
    });
    await new Promise((r) => setTimeout(r, 250));
    result.electronEmulation = await widths();
    view.webContents.disableDeviceEmulation();
  } catch (e) { result.electronEmulation = { error: String(e.message || e) }; }

  await client.close();
  result.ok = (result.cdpEmulation && result.cdpEmulation.inner === 375) ||
              (result.electronEmulation && result.electronEmulation.inner === 375);

  fs.writeFileSync(RESULT_PATH, JSON.stringify(result, null, 2));
  console.log('\n=== EMULATION RETEST (visible window) ===\n' + JSON.stringify(result, null, 2) + '\n');
  setTimeout(() => app.exit(result.ok ? 0 : 2), 200);
}

main().catch((e) => { console.error(e); process.exit(3); });
