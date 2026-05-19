/**
 * Manual `vscode` mock for unit-testing the extension under root vitest.
 * Aliased to the module specifier `vscode` via vitest.config.ts.
 *
 * It is intentionally functional (not auto-mocked): commands register into a
 * live registry so a test can invoke a registered command callback, and
 * window/workspace return stub objects whose methods are `vi.fn()` so tests
 * can assert calls. Reset shared state between tests with `__reset()`.
 */
import { vi } from 'vitest';

export enum StatusBarAlignment { Left = 1, Right = 2 }
export enum ExtensionKind { UI = 1, Workspace = 2 }
export enum ConfigurationTarget { Global = 1, Workspace = 2, WorkspaceFolder = 3 }

export class ThemeColor {
  constructor(public readonly id: string) {}
}

export class RelativePattern {
  constructor(public readonly base: unknown, public readonly pattern: string) {}
}

export class EventEmitter<T = unknown> {
  private listeners: Array<(e: T) => void> = [];
  event = (listener: (e: T) => void) => {
    this.listeners.push(listener);
    return { dispose: () => { this.listeners = this.listeners.filter(l => l !== listener); } };
  };
  fire(e: T): void { for (const l of [...this.listeners]) l(e); }
  dispose(): void { this.listeners = []; }
}

export const Uri = {
  file: (p: string) => ({ fsPath: p, path: p, scheme: 'file', toString: () => `file://${p}` }),
  parse: (s: string) => ({ fsPath: s, path: s, scheme: 'uri', toString: () => s }),
};

// ── command registry ──────────────────────────────────────────────────────
const commandRegistry = new Map<string, (...args: any[]) => any>();

export const commands = {
  registerCommand: vi.fn((id: string, cb: (...args: any[]) => any) => {
    commandRegistry.set(id, cb);
    return { dispose: () => commandRegistry.delete(id) };
  }),
  executeCommand: vi.fn(async (id: string, ...args: any[]) => {
    const cb = commandRegistry.get(id);
    return cb ? cb(...args) : undefined;
  }),
};

/** Test helper: get a registered command callback by id. */
export function __getCommand(id: string): ((...args: any[]) => any) | undefined {
  return commandRegistry.get(id);
}

// ── output channels / status bar ──────────────────────────────────────────
export function makeOutputChannel() {
  return {
    lines: [] as string[],
    appendLine(s: string) { (this.lines as string[]).push(s); },
    append(_s: string) {},
    show(_p?: boolean) {},
    dispose() {},
  };
}

export function makeStatusBarItem() {
  return {
    text: '',
    tooltip: '' as string | undefined,
    command: '' as string | undefined,
    backgroundColor: undefined as unknown,
    alignment: undefined as unknown,
    priority: undefined as number | undefined,
    show: vi.fn(),
    hide: vi.fn(),
    dispose: vi.fn(),
  };
}

export const window = {
  createOutputChannel: vi.fn((_name: string) => makeOutputChannel()),
  createStatusBarItem: vi.fn((alignment?: number, priority?: number) => {
    const i = makeStatusBarItem();
    i.alignment = alignment;
    i.priority = priority;
    return i;
  }),
  showWarningMessage: vi.fn(async (..._a: any[]) => undefined),
  showInformationMessage: vi.fn(async (..._a: any[]) => undefined),
  showErrorMessage: vi.fn(async (..._a: any[]) => undefined),
};

// ── workspace ─────────────────────────────────────────────────────────────
const configStore = new Map<string, unknown>();

export const workspace: any = {
  workspaceFolders: undefined as Array<{ uri: { fsPath: string } }> | undefined,
  getConfiguration: vi.fn((_section?: string) => ({
    get: (key: string) => configStore.get(key),
    update: vi.fn(async (key: string, value: unknown) => { configStore.set(key, value); }),
  })),
  createFileSystemWatcher: vi.fn((_pattern: unknown) => {
    const onCreate = new EventEmitter();
    const onChange = new EventEmitter();
    const onDelete = new EventEmitter();
    return {
      onDidCreate: onCreate.event,
      onDidChange: onChange.event,
      onDidDelete: onDelete.event,
      _emit: { create: onCreate, change: onChange, delete: onDelete },
      dispose: vi.fn(),
    };
  }),
  openTunnel: vi.fn(async (_opts: any) => ({
    localAddress: { host: '127.0.0.1', port: 39999 },
    dispose: vi.fn(),
  })),
};

export const env = {
  remoteName: undefined as string | undefined,
  openExternal: vi.fn(async (_uri: unknown) => true),
};

/** Test helper: make a fake ExtensionContext. */
export function makeExtensionContext(over: Partial<any> = {}): any {
  const globalStateStore = new Map<string, unknown>();
  return {
    subscriptions: [] as Array<{ dispose(): void }>,
    extension: { extensionKind: ExtensionKind.UI, packageJSON: { version: '1.0.17' } },
    globalState: {
      get: vi.fn((k: string) => globalStateStore.get(k)),
      update: vi.fn(async (k: string, v: unknown) => { globalStateStore.set(k, v); }),
    },
    ...over,
  };
}

/** Reset all shared mock state. Call in beforeEach. */
export function __reset(): void {
  commandRegistry.clear();
  configStore.clear();
  workspace.workspaceFolders = undefined;
  env.remoteName = undefined;
  vi.clearAllMocks();
}
