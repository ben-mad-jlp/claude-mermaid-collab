import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { withCDPSession, resolveSessionId, CDP_PORT, registerTab } from '../../services/cdp-session.js';

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
};
