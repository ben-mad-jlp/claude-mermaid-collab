import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const API_PORT = parseInt(process.env.PORT || '9002', 10);
const API_HOST = process.env.HOST || 'localhost';
const API_BASE = `http://${API_HOST}:${API_PORT}`;

async function apiPost(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(65_000),
  });
  const json = await res.json() as Record<string, unknown>;
  if (!res.ok || json.error) throw new Error((json.error as string) ?? res.statusText);
  return json;
}

async function apiGet(path: string): Promise<unknown> {
  const res = await fetch(`${API_BASE}${path}`, { signal: AbortSignal.timeout(10_000) });
  const json = await res.json() as Record<string, unknown>;
  if (!res.ok || json.error) throw new Error((json.error as string) ?? res.statusText);
  return json;
}

export async function browserOpen(url: string): Promise<string> {
  const result = await apiPost('/api/browser/open', { url }) as { sessionId: string };
  return JSON.stringify({ sessionId: result.sessionId }, null, 2);
}

export async function browserNavigate(sessionId: string, url: string): Promise<string> {
  await apiPost('/api/browser/command', { sessionId, method: 'Page.navigate', params: { url } });
  await apiPost('/api/browser/command', { sessionId, method: 'Page.bringToFront', params: {} });
  // Wait briefly for navigation to complete
  await new Promise(r => setTimeout(r, 500));
  const titleResult = await apiPost('/api/browser/command', {
    sessionId,
    method: 'Runtime.evaluate',
    params: { expression: 'document.title', returnByValue: true },
  }) as { result: { result: { value: unknown } } };
  return JSON.stringify({ navigated: true, title: titleResult?.result?.result?.value ?? null }, null, 2);
}

export async function browserEvaluate(sessionId: string, expression: string): Promise<string> {
  const result = await apiPost('/api/browser/command', {
    sessionId,
    method: 'Runtime.evaluate',
    params: { expression, returnByValue: true, awaitPromise: true },
  }) as { result: { type?: string; value?: unknown; description?: string; subtype?: string } };
  return JSON.stringify(result.result ?? result, null, 2);
}

export async function browserScreenshot(sessionId: string, project: string, session: string): Promise<string> {
  const result = await apiPost('/api/browser/command', {
    sessionId,
    method: 'Page.captureScreenshot',
    params: { format: 'png' },
  }) as { result: { data: string } };

  const base64 = result.result?.data;
  if (!base64) throw new Error('No screenshot data returned');

  const imagesDir = join(project, '.collab', 'sessions', session, 'images');
  await mkdir(imagesDir, { recursive: true });
  const filename = `screenshot-${Date.now()}.png`;
  const filePath = join(imagesDir, filename);
  await writeFile(filePath, Buffer.from(base64, 'base64'));

  return JSON.stringify({ saved: filePath, size: base64.length }, null, 2);
}

export async function browserConsole(sessionId: string): Promise<string> {
  const result = await apiGet(`/api/browser/events?sessionId=${encodeURIComponent(sessionId)}&type=console`) as { events: unknown[] };
  return JSON.stringify({ events: result.events ?? [] }, null, 2);
}

export async function browserNetwork(sessionId: string): Promise<string> {
  const result = await apiGet(`/api/browser/events?sessionId=${encodeURIComponent(sessionId)}&type=network`) as { events: unknown[] };
  return JSON.stringify({ events: result.events ?? [] }, null, 2);
}

export async function browserClose(sessionId: string): Promise<string> {
  await apiPost('/api/browser/close', { sessionId });
  return JSON.stringify({ closed: true }, null, 2);
}

export const browserToolSchemas = {
  browser_open: {
    name: 'browser_open',
    description: 'Open a browser window to a URL via the VS Code debug session. Returns a sessionId used for subsequent browser commands.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to open in the browser' },
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
        sessionId: { type: 'string', description: 'Browser session ID from browser_open' },
        url: { type: 'string', description: 'URL to navigate to' },
      },
      required: ['sessionId', 'url'],
    },
  },
  browser_evaluate: {
    name: 'browser_evaluate',
    description: 'Evaluate a JavaScript expression in the browser context and return the result.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Browser session ID from browser_open' },
        expression: { type: 'string', description: 'JavaScript expression to evaluate' },
      },
      required: ['sessionId', 'expression'],
    },
  },
  browser_screenshot: {
    name: 'browser_screenshot',
    description: 'Take a PNG screenshot of the current browser state. Saves to the session images folder and returns the file path.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Browser session ID from browser_open' },
        project: { type: 'string', description: 'Absolute path to the project root directory' },
        session: { type: 'string', description: 'Collab session name (used for image storage path)' },
      },
      required: ['sessionId', 'project', 'session'],
    },
  },
  browser_console: {
    name: 'browser_console',
    description: 'Get buffered console log entries from the browser session.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Browser session ID from browser_open' },
      },
      required: ['sessionId'],
    },
  },
  browser_network: {
    name: 'browser_network',
    description: 'Get buffered network request entries from the browser session.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Browser session ID from browser_open' },
      },
      required: ['sessionId'],
    },
  },
  browser_close: {
    name: 'browser_close',
    description: 'Close the browser session and stop the VS Code debug session.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Browser session ID from browser_open' },
      },
      required: ['sessionId'],
    },
  },
};
