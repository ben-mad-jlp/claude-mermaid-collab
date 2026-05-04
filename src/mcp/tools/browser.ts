import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { withCDPSession, resolveSessionId, CDP_PORT, registerTab } from '../../services/cdp-session.js';

const require = createRequire(import.meta.url);
const CDP = require('chrome-remote-interface') as any;

export async function browserOpen(url: string, session?: string): Promise<string> {
  const sessionId = session ?? await resolveSessionId();
  return withCDPSession(sessionId, CDP_PORT, async (client) => {
    await client.Page.enable();
    await client.Page.navigate({ url });
    await new Promise(r => setTimeout(r, 500)); // brief wait for load
    const titleResult = await client.Runtime.evaluate({ expression: 'document.title', returnByValue: true });
    const title = titleResult.result?.value ?? '';
    try {
      const info = await client.Target.getTargetInfo();
      registerTab(sessionId, info.targetInfo.targetId);
    } catch {} // not all CDP versions support this
    return JSON.stringify({ sessionId, url, title }, null, 2);
  });
}

export async function browserNavigate(sessionId: string | undefined, url: string): Promise<string> {
  const resolvedSession = sessionId ?? await resolveSessionId();
  return withCDPSession(resolvedSession, CDP_PORT, async (client) => {
    await client.Page.enable();
    await client.Page.navigate({ url });
    await new Promise(r => setTimeout(r, 500));
    const titleResult = await client.Runtime.evaluate({ expression: 'document.title', returnByValue: true });
    try {
      const info = await client.Target.getTargetInfo();
      registerTab(resolvedSession, info.targetInfo.targetId);
    } catch {} // not all CDP versions support this
    return JSON.stringify({ navigated: true, url, title: titleResult.result?.value ?? '' }, null, 2);
  });
}

export async function browserEvaluate(sessionId: string | undefined, expression: string): Promise<string> {
  return withCDPSession(sessionId ?? await resolveSessionId(), CDP_PORT, async (client) => {
    await client.Runtime.enable();
    const result = await client.Runtime.evaluate({ expression, returnByValue: true, awaitPromise: true });
    return JSON.stringify(result.result ?? result, null, 2);
  });
}

export async function browserScreenshot(sessionId: string | undefined, project: string, session: string): Promise<string> {
  return withCDPSession(sessionId ?? await resolveSessionId(), CDP_PORT, async (client) => {
    await client.Page.enable();
    const result = await client.Page.captureScreenshot({ format: 'png' });
    const base64 = result.data;
    // Save to file using same path pattern as before
    const timestamp = Date.now();
    const filename = `screenshot-${timestamp}.png`;
    const imagesDir = join(project, '.collab', 'sessions', session, 'images');
    await mkdir(imagesDir, { recursive: true });
    const filePath = join(imagesDir, filename);
    await writeFile(filePath, Buffer.from(base64, 'base64'));
    return JSON.stringify({ saved: filePath, size: base64.length }, null, 2);
  });
}

export async function browserConsole(sessionId: string | undefined): Promise<string> {
  // Note: returns only events captured during this connection window (no persistent buffer)
  return withCDPSession(sessionId ?? await resolveSessionId(), CDP_PORT, async (client) => {
    const events: any[] = [];
    client.Runtime.on('consoleAPICalled', (e: any) => events.push(e));
    await client.Runtime.enable();
    await new Promise(r => setTimeout(r, 200));
    return JSON.stringify({ events }, null, 2);
  });
}

export async function browserNetwork(sessionId: string | undefined): Promise<string> {
  // Note: returns only requests captured during this connection window
  return withCDPSession(sessionId ?? await resolveSessionId(), CDP_PORT, async (client) => {
    const requests: any[] = [];
    client.Network.on('requestWillBeSent', (e: any) => requests.push(e));
    await client.Network.enable();
    await new Promise(r => setTimeout(r, 200));
    return JSON.stringify({ requests }, null, 2);
  });
}

export async function browserClose(sessionId: string | undefined): Promise<string> {
  return withCDPSession(sessionId ?? await resolveSessionId(), CDP_PORT, async (client) => {
    await client.Browser.close();
    return JSON.stringify({ closed: true }, null, 2);
  });
}

export async function browserClick(selector: string, session?: string): Promise<string> {
  const sessionId = session ?? await resolveSessionId();
  return withCDPSession(sessionId, CDP_PORT, async (client) => {
    await client.DOM.enable();
    await client.Runtime.enable();
    const docResult = await client.DOM.getDocument();
    const nodeResult = await client.DOM.querySelector({ nodeId: docResult.root.nodeId, selector });
    if (!nodeResult.nodeId) throw new Error(`Element not found: ${selector}`);
    const boxResult = await client.DOM.getBoxModel({ nodeId: nodeResult.nodeId });
    const [x, y] = [boxResult.model.content[0], boxResult.model.content[1]];
    await client.Input.dispatchMouseEvent({ type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await client.Input.dispatchMouseEvent({ type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    const urlResult = await client.Runtime.evaluate({ expression: 'window.location.href', returnByValue: true });
    const titleResult = await client.Runtime.evaluate({ expression: 'document.title', returnByValue: true });
    return JSON.stringify({ success: true, url: urlResult.result?.value, title: titleResult.result?.value }, null, 2);
  });
}

export async function browserFill(selector: string, value: string, session?: string): Promise<string> {
  const sessionId = session ?? await resolveSessionId();
  return withCDPSession(sessionId, CDP_PORT, async (client) => {
    await client.Runtime.enable();
    const evalResult = await client.Runtime.evaluate({ expression: `document.querySelector(${JSON.stringify(selector)})`, returnByValue: false });
    const objectId = evalResult.result?.objectId;
    if (!objectId) throw new Error(`Element not found: ${selector}`);
    await client.Runtime.callFunctionOn({
      objectId,
      functionDeclaration: 'function(v) { this.value = v; this.dispatchEvent(new Event("input", {bubbles:true})); this.dispatchEvent(new Event("change", {bubbles:true})); }',
      arguments: [{ value }],
      returnByValue: true,
    });
    return JSON.stringify({ success: true, selector, value }, null, 2);
  });
}

export async function browserSelect(selector: string, value: string, session?: string): Promise<string> {
  // Same as fill — sets .value and dispatches change
  const sessionId = session ?? await resolveSessionId();
  return withCDPSession(sessionId, CDP_PORT, async (client) => {
    await client.Runtime.enable();
    const evalResult = await client.Runtime.evaluate({ expression: `document.querySelector(${JSON.stringify(selector)})`, returnByValue: false });
    const objectId = evalResult.result?.objectId;
    if (!objectId) throw new Error(`Element not found: ${selector}`);
    await client.Runtime.callFunctionOn({
      objectId,
      functionDeclaration: 'function(v) { this.value = v; this.dispatchEvent(new Event("change", {bubbles:true})); }',
      arguments: [{ value }],
      returnByValue: true,
    });
    return JSON.stringify({ success: true, selector, value }, null, 2);
  });
}

export async function browserPressKey(key: string, session?: string): Promise<string> {
  const sessionId = session ?? await resolveSessionId();
  return withCDPSession(sessionId, CDP_PORT, async (client) => {
    await client.Input.dispatchKeyEvent({ type: 'keyDown', key });
    await client.Input.dispatchKeyEvent({ type: 'keyUp', key });
    return JSON.stringify({ success: true, key }, null, 2);
  });
}

export async function browserHover(selector: string, session?: string): Promise<string> {
  const sessionId = session ?? await resolveSessionId();
  return withCDPSession(sessionId, CDP_PORT, async (client) => {
    await client.DOM.enable();
    const docResult = await client.DOM.getDocument();
    const nodeResult = await client.DOM.querySelector({ nodeId: docResult.root.nodeId, selector });
    if (!nodeResult.nodeId) throw new Error(`Element not found: ${selector}`);
    const boxResult = await client.DOM.getBoxModel({ nodeId: nodeResult.nodeId });
    const [x, y] = [boxResult.model.content[0], boxResult.model.content[1]];
    await client.Input.dispatchMouseEvent({ type: 'mouseMoved', x, y });
    return JSON.stringify({ success: true, selector }, null, 2);
  });
}

export async function browserHandleDialog(accept: boolean, promptText?: string, session?: string): Promise<string> {
  const sessionId = session ?? await resolveSessionId();
  return withCDPSession(sessionId, CDP_PORT, async (client) => {
    await client.Page.enable();
    await client.Page.handleJavaScriptDialog({ accept, promptText: promptText ?? '' });
    return JSON.stringify({ success: true, accept }, null, 2);
  });
}

export async function browserWaitFor(selector: string | undefined, navigation: boolean | undefined, timeout: number | undefined, session?: string): Promise<string> {
  const sessionId = session ?? await resolveSessionId();
  return withCDPSession(sessionId, CDP_PORT, async (client) => {
    const deadline = Date.now() + (timeout ?? 5000);
    if (navigation) {
      await client.Page.enable();
      await Promise.race([
        client.Page.loadEventFired(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout waiting for navigation')), timeout ?? 5000)),
      ]);
      return JSON.stringify({ found: true, elapsed: Date.now() - (deadline - (timeout ?? 5000)) }, null, 2);
    }
    if (selector) {
      await client.Runtime.enable();
      const start = Date.now();
      const check = `!!document.querySelector(${JSON.stringify(selector)})`;
      while (Date.now() < deadline) {
        const r = await client.Runtime.evaluate({ expression: check, returnByValue: true });
        if (r.result?.value === true) return JSON.stringify({ found: true, elapsed: Date.now() - start }, null, 2);
        await new Promise(r => setTimeout(r, 200));
      }
      throw new Error(`Timeout: "${selector}" not found after ${timeout ?? 5000}ms`);
    }
    throw new Error('Provide selector or navigation: true');
  });
}

export async function browserGetUrl(session?: string): Promise<string> {
  const sessionId = session ?? await resolveSessionId();
  return withCDPSession(sessionId, CDP_PORT, async (client) => {
    await client.Runtime.enable();
    const urlResult = await client.Runtime.evaluate({ expression: 'window.location.href', returnByValue: true });
    const titleResult = await client.Runtime.evaluate({ expression: 'document.title', returnByValue: true });
    return JSON.stringify({ url: urlResult.result?.value, title: titleResult.result?.value }, null, 2);
  });
}

export async function browserDrag(sourceSelector: string, targetSelector: string, session?: string): Promise<string> {
  const sessionId = session ?? await resolveSessionId();
  return withCDPSession(sessionId, CDP_PORT, async (client) => {
    await client.DOM.enable();
    const doc = await client.DOM.getDocument();
    const srcNode = await client.DOM.querySelector({ nodeId: doc.root.nodeId, selector: sourceSelector });
    if (!srcNode.nodeId) throw new Error(`Source not found: ${sourceSelector}`);
    const tgtNode = await client.DOM.querySelector({ nodeId: doc.root.nodeId, selector: targetSelector });
    if (!tgtNode.nodeId) throw new Error(`Target not found: ${targetSelector}`);
    const srcBox = await client.DOM.getBoxModel({ nodeId: srcNode.nodeId });
    const tgtBox = await client.DOM.getBoxModel({ nodeId: tgtNode.nodeId });
    const [sx, sy] = [srcBox.model.content[0], srcBox.model.content[1]];
    const [tx, ty] = [tgtBox.model.content[0], tgtBox.model.content[1]];
    await client.Input.dispatchMouseEvent({ type: 'mousePressed', x: sx, y: sy, button: 'left', clickCount: 1 });
    await client.Input.dispatchMouseEvent({ type: 'mouseMoved', x: tx, y: ty, button: 'left' });
    await client.Input.dispatchMouseEvent({ type: 'mouseReleased', x: tx, y: ty, button: 'left', clickCount: 1 });
    return JSON.stringify({ success: true, from: sourceSelector, to: targetSelector }, null, 2);
  });
}

export async function browserTypeText(text: string, session?: string): Promise<string> {
  const sessionId = session ?? await resolveSessionId();
  return withCDPSession(sessionId, CDP_PORT, async (client) => {
    for (const char of text) {
      await client.Input.dispatchKeyEvent({ type: 'keyDown', text: char, key: char });
      await client.Input.dispatchKeyEvent({ type: 'keyUp', text: char, key: char });
    }
    return JSON.stringify({ success: true, typed: text }, null, 2);
  });
}

export async function browserFillForm(fields: Record<string, string>, session?: string): Promise<string> {
  const sessionId = session ?? await resolveSessionId();
  return withCDPSession(sessionId, CDP_PORT, async (client) => {
    await client.Runtime.enable();
    const results: Record<string, boolean> = {};
    for (const [selector, value] of Object.entries(fields)) {
      const evalResult = await client.Runtime.evaluate({ expression: `document.querySelector(${JSON.stringify(selector)})`, returnByValue: false });
      const objectId = evalResult.result?.objectId;
      if (!objectId) { results[selector] = false; continue; }
      await client.Runtime.callFunctionOn({
        objectId,
        functionDeclaration: 'function(v) { this.value = v; this.dispatchEvent(new Event("input", {bubbles:true})); this.dispatchEvent(new Event("change", {bubbles:true})); }',
        arguments: [{ value }],
        returnByValue: true,
      });
      results[selector] = true;
    }
    return JSON.stringify({ success: true, results }, null, 2);
  });
}

export async function browserEmulate(device: string | undefined, width: number | undefined, height: number | undefined, mobile: boolean | undefined, session?: string): Promise<string> {
  const sessionId = session ?? await resolveSessionId();
  return withCDPSession(sessionId, CDP_PORT, async (client) => {
    const presets: Record<string, { width: number; height: number; mobile: boolean; deviceScaleFactor: number }> = {
      'iPhone 12':        { width: 390, height: 844, mobile: true,  deviceScaleFactor: 3 },
      'iPhone SE':        { width: 375, height: 667, mobile: true,  deviceScaleFactor: 2 },
      'iPad':             { width: 768, height: 1024, mobile: true,  deviceScaleFactor: 2 },
      'Pixel 5':          { width: 393, height: 851, mobile: true,  deviceScaleFactor: 2.75 },
      'Galaxy S21':       { width: 360, height: 800, mobile: true,  deviceScaleFactor: 3 },
      'Desktop 1080p':    { width: 1920, height: 1080, mobile: false, deviceScaleFactor: 1 },
      'Desktop 1440p':    { width: 2560, height: 1440, mobile: false, deviceScaleFactor: 1 },
    };
    const preset = device ? presets[device] : undefined;
    const w = width ?? preset?.width ?? 1280;
    const h = height ?? preset?.height ?? 800;
    const isMobile = mobile ?? preset?.mobile ?? false;
    const dpr = preset?.deviceScaleFactor ?? 1;
    await client.Emulation.setDeviceMetricsOverride({ width: w, height: h, deviceScaleFactor: dpr, mobile: isMobile });
    return JSON.stringify({ success: true, device: device ?? 'custom', width: w, height: h, mobile: isMobile }, null, 2);
  });
}

export async function browserResizePage(width: number, height: number, session?: string): Promise<string> {
  const sessionId = session ?? await resolveSessionId();
  return withCDPSession(sessionId, CDP_PORT, async (client) => {
    await client.Emulation.setDeviceMetricsOverride({ width, height, deviceScaleFactor: 1, mobile: false });
    return JSON.stringify({ success: true, width, height }, null, 2);
  });
}

export async function browserListPages(): Promise<string> {
  const tabs = await CDP.List({ host: '127.0.0.1', port: CDP_PORT });
  return JSON.stringify({ pages: tabs.filter((t: any) => t.type === 'page').map((t: any) => ({ id: t.id, title: t.title, url: t.url })) }, null, 2);
}

export async function browserSelectPage(targetId: string): Promise<string> {
  await CDP.Activate({ id: targetId, host: '127.0.0.1', port: CDP_PORT });
  return JSON.stringify({ success: true, targetId }, null, 2);
}

export async function browserTakeSnapshot(session?: string): Promise<string> {
  const sessionId = session ?? await resolveSessionId();
  return withCDPSession(sessionId, CDP_PORT, async (client) => {
    await client.DOM.enable();
    const { outerHTML } = await client.DOM.getOuterHTML({ nodeId: (await client.DOM.getDocument()).root.nodeId });
    return JSON.stringify({ snapshot: outerHTML }, null, 2);
  });
}

export async function browserTakeMemorySnapshot(session?: string): Promise<string> {
  const sessionId = session ?? await resolveSessionId();
  return withCDPSession(sessionId, CDP_PORT, async (client) => {
    await client.HeapProfiler.enable();
    let chunks = '';
    client.HeapProfiler.on('addHeapSnapshotChunk', ({ chunk }: { chunk: string }) => { chunks += chunk; });
    await new Promise<void>((resolve, reject) => {
      client.HeapProfiler.takeHeapSnapshot({ reportProgress: false })
        .then(() => resolve())
        .catch(reject);
    });
    const parsed = JSON.parse(chunks);
    const nodeCount = parsed.snapshot?.meta?.node_count ?? (chunks.length / 100); // rough estimate
    return JSON.stringify({ nodeCount, size: chunks.length }, null, 2);
  });
}

export async function browserUploadFile(selector: string, filePath: string, session?: string): Promise<string> {
  const sessionId = session ?? await resolveSessionId();
  return withCDPSession(sessionId, CDP_PORT, async (client) => {
    await client.DOM.enable();
    const doc = await client.DOM.getDocument();
    const node = await client.DOM.querySelector({ nodeId: doc.root.nodeId, selector });
    if (!node.nodeId) throw new Error(`Element not found: ${selector}`);
    await client.DOM.setFileInputFiles({ nodeId: node.nodeId, files: [filePath] });
    return JSON.stringify({ success: true, selector, filePath }, null, 2);
  });
}

export async function browserLighthouseAudit(url: string | undefined, session?: string): Promise<string> {
  const sessionId = session ?? await resolveSessionId();
  return withCDPSession(sessionId, CDP_PORT, async (client) => {
    await client.Page.enable();
    await client.Runtime.enable();
    if (url) await client.Page.navigate({ url });
    // Run basic audits via Runtime evaluation of performance APIs
    const metrics = await client.Performance.getMetrics();
    const paintResult = await client.Runtime.evaluate({
      expression: `JSON.stringify(performance.getEntriesByType('paint').map(e => ({name: e.name, startTime: Math.round(e.startTime)})))`,
      returnByValue: true,
    });
    const lcpResult = await client.Runtime.evaluate({
      expression: `JSON.stringify((() => { let lcp = 0; new PerformanceObserver(l => { l.getEntries().forEach(e => lcp = e.startTime); }).observe({type:'largest-contentful-paint',buffered:true}); return Math.round(lcp); })())`,
      returnByValue: true,
    });
    return JSON.stringify({
      url,
      metrics: metrics.metrics,
      paint: JSON.parse(paintResult.result?.value ?? '[]'),
      lcp: lcpResult.result?.value ?? 0,
    }, null, 2);
  });
}

export async function browserPerformanceAnalyzeInsight(session?: string): Promise<string> {
  const sessionId = session ?? await resolveSessionId();
  return withCDPSession(sessionId, CDP_PORT, async (client) => {
    await client.Performance.enable();
    await client.Runtime.enable();
    const metrics = await client.Performance.getMetrics();
    const resourceResult = await client.Runtime.evaluate({
      expression: `JSON.stringify(performance.getEntriesByType('resource').map(e => ({name: e.name.split('/').pop(), type: e.initiatorType, duration: Math.round(e.duration), size: e.transferSize ?? 0})).sort((a,b) => b.duration - a.duration).slice(0, 10))`,
      returnByValue: true,
    });
    const memResult = await client.Runtime.evaluate({
      expression: `JSON.stringify(performance.memory ? {used: performance.memory.usedJSHeapSize, total: performance.memory.totalJSHeapSize, limit: performance.memory.jsHeapSizeLimit} : null)`,
      returnByValue: true,
    });
    return JSON.stringify({
      metrics: metrics.metrics,
      slowestResources: JSON.parse(resourceResult.result?.value ?? '[]'),
      memory: JSON.parse(memResult.result?.value ?? 'null'),
    }, null, 2);
  });
}

export const browserToolSchemas = {
  browser_open: {
    name: 'browser_open',
    description: 'Open a browser window to a URL via direct CDP connection. Returns a sessionId used for subsequent browser commands.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to open in the browser' },
        session: { type: 'string', description: 'CDP session ID (optional, auto-resolved if omitted)' },
      },
      required: ['url'],
    },
  },
  browser_navigate: {
    name: 'browser_navigate',
    description: 'Navigate the browser to a new URL within an existing session.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Browser session ID (optional, auto-resolved if omitted)' },
        url: { type: 'string', description: 'URL to navigate to' },
      },
      required: ['url'],
    },
  },
  browser_evaluate: {
    name: 'browser_evaluate',
    description: 'Evaluate a JavaScript expression in the browser context and return the result.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Browser session ID (optional, auto-resolved if omitted)' },
        expression: { type: 'string', description: 'JavaScript expression to evaluate' },
      },
      required: ['expression'],
    },
  },
  browser_screenshot: {
    name: 'browser_screenshot',
    description: 'Take a PNG screenshot of the current browser state. Saves to the session images folder and returns the file path.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Browser session ID (optional, auto-resolved if omitted)' },
        project: { type: 'string', description: 'Absolute path to the project root directory' },
        session: { type: 'string', description: 'Collab session name (used for image storage path)' },
      },
      required: ['project', 'session'],
    },
  },
  browser_console: {
    name: 'browser_console',
    description: 'Get console log entries captured during this CDP connection window.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Browser session ID (optional, auto-resolved if omitted)' },
      },
      required: [],
    },
  },
  browser_network: {
    name: 'browser_network',
    description: 'Get network request entries captured during this CDP connection window.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Browser session ID (optional, auto-resolved if omitted)' },
      },
      required: [],
    },
  },
  browser_close: {
    name: 'browser_close',
    description: 'Close the browser via CDP.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Browser session ID (optional, auto-resolved if omitted)' },
      },
      required: [],
    },
  },
  browser_click: {
    name: 'browser_click',
    description: 'Click an element in the browser identified by a CSS selector.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector of the element to click' },
        session: { type: 'string', description: 'CDP session ID (optional, auto-resolved if omitted)' },
      },
      required: ['selector'],
    },
  },
  browser_fill: {
    name: 'browser_fill',
    description: 'Fill an input element identified by a CSS selector with a value.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector of the input element' },
        value: { type: 'string', description: 'Value to set on the input element' },
        session: { type: 'string', description: 'CDP session ID (optional, auto-resolved if omitted)' },
      },
      required: ['selector', 'value'],
    },
  },
  browser_select: {
    name: 'browser_select',
    description: 'Set the selected value of a <select> element identified by a CSS selector.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector of the select element' },
        value: { type: 'string', description: 'Option value to select' },
        session: { type: 'string', description: 'CDP session ID (optional, auto-resolved if omitted)' },
      },
      required: ['selector', 'value'],
    },
  },
  browser_press_key: {
    name: 'browser_press_key',
    description: 'Dispatch a key press event in the browser (keyDown + keyUp).',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Key name to press (e.g. "Enter", "Escape", "Tab")' },
        session: { type: 'string', description: 'CDP session ID (optional, auto-resolved if omitted)' },
      },
      required: ['key'],
    },
  },
  browser_hover: {
    name: 'browser_hover',
    description: 'Move the mouse over an element identified by a CSS selector.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector of the element to hover over' },
        session: { type: 'string', description: 'CDP session ID (optional, auto-resolved if omitted)' },
      },
      required: ['selector'],
    },
  },
  browser_handle_dialog: {
    name: 'browser_handle_dialog',
    description: 'Accept or dismiss a JavaScript dialog (alert, confirm, prompt).',
    inputSchema: {
      type: 'object',
      properties: {
        accept: { type: 'boolean', description: 'Whether to accept (true) or dismiss (false) the dialog' },
        promptText: { type: 'string', description: 'Text to enter into a prompt dialog (optional)' },
        session: { type: 'string', description: 'CDP session ID (optional, auto-resolved if omitted)' },
      },
      required: ['accept'],
    },
  },
  browser_wait_for: {
    name: 'browser_wait_for',
    description: 'Wait for a CSS selector to appear in the DOM, or for a page navigation to complete.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector to wait for (mutually exclusive with navigation)' },
        navigation: { type: 'boolean', description: 'If true, wait for page load event instead of a selector' },
        timeout: { type: 'number', description: 'Timeout in milliseconds (default: 5000)' },
        session: { type: 'string', description: 'CDP session ID (optional, auto-resolved if omitted)' },
      },
      required: [],
    },
  },
  browser_get_url: {
    name: 'browser_get_url',
    description: 'Get the current URL and page title from the browser.',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'CDP session ID (optional, auto-resolved if omitted)' },
      },
      required: [],
    },
  },
  browser_drag: {
    name: 'browser_drag',
    description: 'Drag an element from one CSS selector to another.',
    inputSchema: {
      type: 'object',
      properties: {
        sourceSelector: { type: 'string', description: 'CSS selector of the element to drag' },
        targetSelector: { type: 'string', description: 'CSS selector of the drop target' },
        session: { type: 'string', description: 'CDP session ID (optional, auto-resolved if omitted)' },
      },
      required: ['sourceSelector', 'targetSelector'],
    },
  },
  browser_type_text: {
    name: 'browser_type_text',
    description: 'Type text into the currently focused element character by character.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to type' },
        session: { type: 'string', description: 'CDP session ID (optional, auto-resolved if omitted)' },
      },
      required: ['text'],
    },
  },
  browser_fill_form: {
    name: 'browser_fill_form',
    description: 'Fill multiple form fields at once. Keys are CSS selectors, values are the strings to set.',
    inputSchema: {
      type: 'object',
      properties: {
        fields: { type: 'object', description: 'Map of CSS selector → value', additionalProperties: { type: 'string' } },
        session: { type: 'string', description: 'CDP session ID (optional, auto-resolved if omitted)' },
      },
      required: ['fields'],
    },
  },
  browser_emulate: {
    name: 'browser_emulate',
    description: 'Emulate a device or set a custom viewport. Built-in presets: "iPhone 12", "iPhone SE", "iPad", "Pixel 5", "Galaxy S21", "Desktop 1080p", "Desktop 1440p".',
    inputSchema: {
      type: 'object',
      properties: {
        device: { type: 'string', description: 'Device preset name (optional)' },
        width: { type: 'number', description: 'Viewport width in px (overrides preset)' },
        height: { type: 'number', description: 'Viewport height in px (overrides preset)' },
        mobile: { type: 'boolean', description: 'Whether to emulate mobile (overrides preset)' },
        session: { type: 'string', description: 'CDP session ID (optional, auto-resolved if omitted)' },
      },
      required: [],
    },
  },
  browser_resize_page: {
    name: 'browser_resize_page',
    description: 'Resize the browser viewport to the given dimensions.',
    inputSchema: {
      type: 'object',
      properties: {
        width: { type: 'number', description: 'New viewport width in px' },
        height: { type: 'number', description: 'New viewport height in px' },
        session: { type: 'string', description: 'CDP session ID (optional, auto-resolved if omitted)' },
      },
      required: ['width', 'height'],
    },
  },
  browser_list_pages: {
    name: 'browser_list_pages',
    description: 'List all open page tabs in the connected Chrome instance.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  browser_select_page: {
    name: 'browser_select_page',
    description: 'Activate (focus) a specific Chrome tab by its target ID (from browser_list_pages).',
    inputSchema: {
      type: 'object',
      properties: {
        targetId: { type: 'string', description: 'Target ID of the tab to activate' },
      },
      required: ['targetId'],
    },
  },
  browser_take_snapshot: {
    name: 'browser_take_snapshot',
    description: 'Get the full outer HTML of the current page as a DOM snapshot.',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'CDP session ID (optional, auto-resolved if omitted)' },
      },
      required: [],
    },
  },
  browser_take_memory_snapshot: {
    name: 'browser_take_memory_snapshot',
    description: 'Take a JS heap memory snapshot and return node count and size summary.',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'CDP session ID (optional, auto-resolved if omitted)' },
      },
      required: [],
    },
  },
  browser_upload_file: {
    name: 'browser_upload_file',
    description: 'Set files on a file input element (absolute server-side paths).',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector of the file input element' },
        filePath: { type: 'string', description: 'Absolute path to the file on the server' },
        session: { type: 'string', description: 'CDP session ID (optional, auto-resolved if omitted)' },
      },
      required: ['selector', 'filePath'],
    },
  },
  browser_lighthouse_audit: {
    name: 'browser_lighthouse_audit',
    description: 'Run a lightweight performance audit on the current page using browser performance APIs.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to navigate to before auditing (optional, uses current page if omitted)' },
        session: { type: 'string', description: 'CDP session ID (optional, auto-resolved if omitted)' },
      },
      required: [],
    },
  },
  browser_performance_analyze_insight: {
    name: 'browser_performance_analyze_insight',
    description: 'Analyze current page performance: metrics, slowest resources, and memory usage.',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'CDP session ID (optional, auto-resolved if omitted)' },
      },
      required: [],
    },
  },
};
