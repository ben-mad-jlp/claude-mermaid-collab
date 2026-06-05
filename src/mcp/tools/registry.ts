/**
 * Table-driven MCP tool registry.
 *
 * Each tool is a self-contained ToolDef { name, description, inputSchema,
 * handler(args, ctx) } registered in its DOMAIN module. setup.ts builds the
 * registry, DERIVES the ListTools response from it (single source of truth —
 * kills the list/switch drift), and dispatches by lookup.
 *
 * `ctx` injects cross-cutting collaborators (the WS broadcaster) so handlers
 * are unit-testable with a fake broadcaster and the broadcast that the legacy
 * switch sometimes forgot is centralised.
 *
 * INCREMENTAL: the registry and the legacy switch in setup.ts COEXIST — the
 * dispatcher checks the registry first and falls through to the old switch for
 * unmigrated tools. Domains are migrated one at a time until the switch is
 * empty and can be deleted.
 */

/** A WS broadcast message (loose shape — matches getWebSocketHandler().broadcast). */
export type BroadcastMessage = Record<string, any>;

/**
 * Cross-cutting collaborators injected into every handler. Keep this minimal —
 * it exists so handlers don't reach into setup.ts singletons directly and so
 * tests can pass a fake broadcaster.
 */
export interface ToolCtx {
  /** Broadcast a message to live WS subscribers. No-op if no handler is bound. */
  broadcast(message: BroadcastMessage): void;
}

/**
 * A tool handler returns the same `string` payload the legacy switch cases
 * returned (already JSON.stringified where appropriate); setup.ts wraps it in
 * the MCP `{ content: [{ type: 'text', text }] }` envelope.
 */
export type ToolHandler = (args: Record<string, any>, ctx: ToolCtx) => Promise<string>;

export interface ToolDef {
  name: string;
  description: string;
  /** JSON Schema object for the tool's arguments (the MCP `inputSchema`). */
  inputSchema: Record<string, any>;
  handler: ToolHandler;
}

/** The MCP ListTools entry derived from a ToolDef (handler omitted). */
export interface ToolListEntry {
  name: string;
  description: string;
  inputSchema: Record<string, any>;
}

export class ToolRegistry {
  private readonly defs = new Map<string, ToolDef>();

  /** Register one or more tool definitions. Throws on duplicate names. */
  register(...defs: ToolDef[]): this {
    for (const def of defs) {
      if (this.defs.has(def.name)) {
        throw new Error(`Duplicate tool registration: ${def.name}`);
      }
      this.defs.set(def.name, def);
    }
    return this;
  }

  has(name: string): boolean {
    return this.defs.has(name);
  }

  /** Derive the ListTools entries (single source of truth for migrated tools). */
  list(): ToolListEntry[] {
    return Array.from(this.defs.values(), ({ name, description, inputSchema }) => ({
      name,
      description,
      inputSchema,
    }));
  }

  /** The set of registered tool names (for de-duping against the legacy list). */
  names(): Set<string> {
    return new Set(this.defs.keys());
  }

  /** Dispatch a registered tool by name. Throws if the name is not registered. */
  async dispatch(name: string, args: Record<string, any>, ctx: ToolCtx): Promise<string> {
    const def = this.defs.get(name);
    if (!def) throw new Error(`Unknown tool: ${name}`);
    return def.handler(args ?? {}, ctx);
  }
}
