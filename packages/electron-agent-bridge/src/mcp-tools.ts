// App-agnostic factory producing { defs, handlers } for desktop_* MCP tools.
// The host spreads these defs/handlers into its own MCP server. No app-specific
// (mermaid/.collab/session) logic lives here.

import type { ElectronDriver } from './driver.js';

export type ToolDef = {
  name: string;
  description: string;
  inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
};

export type ToolHandler = (args: any) => Promise<string>;

function req(args: any, key: string): any {
  const v = args?.[key];
  if (v === undefined || v === null) throw new Error('Missing required: ' + key);
  return v;
}

export function createDesktopTools(
  getDriver: () => Promise<ElectronDriver>,
): { defs: ToolDef[]; handlers: Record<string, ToolHandler> } {
  const defs: ToolDef[] = [
    {
      name: 'desktop_navigate',
      description: 'Navigate the desktop app to a URL.',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to navigate the desktop app to' },
        },
        required: ['url'],
      },
    },
    {
      name: 'desktop_screenshot',
      description: 'Capture a screenshot of the desktop app.',
      inputSchema: {
        type: 'object',
        properties: {
          format: {
            type: 'string',
            enum: ['png', 'jpeg'],
            description: 'Image format (default png)',
          },
        },
      },
    },
    {
      name: 'desktop_eval',
      description: 'Evaluate a JavaScript expression in the renderer.',
      inputSchema: {
        type: 'object',
        properties: {
          expression: {
            type: 'string',
            description: 'JavaScript expression to evaluate in the renderer',
          },
        },
        required: ['expression'],
      },
    },
    {
      name: 'desktop_click',
      description: 'Click an element matching a CSS selector.',
      inputSchema: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector to click' },
        },
        required: ['selector'],
      },
    },
    {
      name: 'desktop_fill',
      description: 'Fill a field matching a CSS selector with a value.',
      inputSchema: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector of the field' },
          value: { type: 'string', description: 'Value to set' },
        },
        required: ['selector', 'value'],
      },
    },
    {
      name: 'desktop_wait_for',
      description: 'Wait for an element matching a CSS selector to appear.',
      inputSchema: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector to wait for' },
          timeoutMs: { type: 'number', description: 'Timeout in ms (default 5000)' },
        },
        required: ['selector'],
      },
    },
    {
      name: 'desktop_snapshot',
      description: 'Capture an accessibility/text snapshot of the current page.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'desktop_list_targets',
      description: 'List available CDP targets.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
  ];

  const handlers: Record<string, ToolHandler> = {
    desktop_navigate: async (args) => {
      const d = await getDriver();
      return JSON.stringify(await d.navigate(req(args, 'url')));
    },
    desktop_screenshot: async (args) => {
      const d = await getDriver();
      const r = await d.screenshot({ format: args?.format });
      return JSON.stringify(r);
    },
    desktop_eval: async (args) => {
      const d = await getDriver();
      const result = await d.eval(req(args, 'expression'));
      return JSON.stringify({ result });
    },
    desktop_click: async (args) => {
      const d = await getDriver();
      await d.click(req(args, 'selector'));
      return JSON.stringify({ ok: true });
    },
    desktop_fill: async (args) => {
      const d = await getDriver();
      await d.fill(req(args, 'selector'), req(args, 'value'));
      return JSON.stringify({ ok: true });
    },
    desktop_wait_for: async (args) => {
      const d = await getDriver();
      await d.waitFor(req(args, 'selector'), args?.timeoutMs);
      return JSON.stringify({ ok: true });
    },
    desktop_snapshot: async () => {
      const d = await getDriver();
      return JSON.stringify({ snapshot: await d.snapshot() });
    },
    desktop_list_targets: async () => {
      const d = await getDriver();
      return JSON.stringify(await d.listTargets());
    },
  };

  return { defs, handlers };
}
