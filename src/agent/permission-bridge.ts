import { randomUUID, createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import type { AgentEvent, PermissionMode, PermissionDecision, InteractionMode, RuntimeMode } from './contracts';
import { splitPermissionMode } from './contracts';
import type { PermissionRequest, PermissionResponse, PermissionVerdict } from './permission-socket';
import { mergeSettings } from './settings-store.js';
import { migrate0004 } from './migrations/0004_phase3_allowlist.js';

export interface PendingPermission {
  promptId: string;
  sessionId: string;
  toolUseId: string;
  turnId: string;
  name: string;
  input: unknown;
  deadlineMs: number;
  timer: ReturnType<typeof setTimeout>;
  resolveHook: (verdict: PermissionVerdict, reason?: string) => void;
}

export interface PermissionBridgeDeps {
  broadcast: (event: AgentEvent) => void;
  getMode: (sessionId: string) => PermissionMode;
  /**
   * Optional split-mode accessor. When provided, takes precedence over
   * `getMode` for decision routing. Returning only an `interaction` mode is
   * sufficient; `runtime` may be omitted for bridge purposes.
   */
  getInteractionMode?: (sessionId: string) => InteractionMode;
  getRuntimeMode?: (sessionId: string) => RuntimeMode;
  persistDir: string;
  hookBinPath: string;
  bunBin?: string;
  timeoutMs?: number;
  now?: () => number;
}

const ACCEPT_EDITS_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const READ_ONLY_TOOLS = new Set(['Read', 'Glob', 'Grep']);

function matchRule(rule: string, toolName: string): boolean {
  if (rule === toolName) return true;
  if (rule.startsWith('mcp__') && rule.endsWith('*')) {
    const prefix = rule.slice(0, -1);
    return toolName.startsWith(prefix);
  }
  if (rule.includes('*')) {
    const escaped = rule.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp(`^${escaped}$`).test(toolName);
  }
  return false;
}

export class PermissionBridge {
  // sessionId -> (promptId -> PendingPermission)
  private pending = new Map<string, Map<string, PendingPermission>>();
  // sessionId -> set of tool names allowed for this session
  private allowlist = new Map<string, Set<string>>();
  private db?: import('bun:sqlite').Database;
  private projectRoot?: string;

  constructor(private deps: PermissionBridgeDeps) {}

  /**
   * Socket handler: invoked when the hook child pipes a PermissionRequest over
   * the unix socket. Resolves to a PermissionResponse envelope that the hook
   * prints to stdout for the Claude CLI to consume.
   */
  onPermissionRequest = (sessionId: string, req: PermissionRequest): Promise<PermissionResponse> => {
    const name = req.toolName;
    const input = req.toolInput;
    const toolUseId = (req as any).toolUseId ?? '';
    const turnId = (req as any).turnId ?? '';

    const now = this.deps.now ?? Date.now;

    // Resolve runtime + interaction modes. Prefer the split accessors when
    // provided; otherwise fall back to PermissionMode via splitPermissionMode.
    let runtime: RuntimeMode;
    let interaction: InteractionMode;
    if (this.deps.getInteractionMode || this.deps.getRuntimeMode) {
      const legacy = splitPermissionMode(this.deps.getMode(sessionId));
      runtime = this.deps.getRuntimeMode ? this.deps.getRuntimeMode(sessionId) : legacy.runtime;
      interaction = this.deps.getInteractionMode
        ? this.deps.getInteractionMode(sessionId)
        : legacy.interaction;
    } else {
      const split = splitPermissionMode(this.deps.getMode(sessionId));
      runtime = split.runtime;
      interaction = split.interaction;
    }

    // 1. bypass runtime → allow automatically, regardless of interaction
    if (runtime === 'bypass') {
      const promptId = randomUUID();
      this.broadcastResolved(sessionId, promptId, 'allow_once', 'mode_auto');
      return Promise.resolve(this.makeResponse('allow', 'mode_auto:bypass'));
    }

    // 2. plan interaction → auto-deny all write/exec tools; allow read-class
    if (interaction === 'plan') {
      if (READ_ONLY_TOOLS.has(name)) {
        const promptId = randomUUID();
        this.broadcastResolved(sessionId, promptId, 'allow_once', 'mode_auto');
        return Promise.resolve(this.makeResponse('allow', 'mode_auto:plan:read'));
      }
      const promptId = randomUUID();
      this.broadcastResolved(sessionId, promptId, 'deny', 'mode_auto');
      return Promise.resolve(this.makeResponse('deny', 'mode_auto:plan'));
    }

    // 3. accept-edits interaction + editing tool → allow; still prompt for
    //    Bash/WebFetch/other risky tools.
    if (interaction === 'accept-edits' && ACCEPT_EDITS_TOOLS.has(name)) {
      const promptId = randomUUID();
      this.broadcastResolved(sessionId, promptId, 'allow_once', 'mode_auto');
      return Promise.resolve(this.makeResponse('allow', 'mode_auto:accept-edits'));
    }

    // 'ask' interaction (or accept-edits for non-edit tool) falls through to
    // session allowlist / user prompt below.

    // 4. session allowlist
    const sessionRules = this.allowlist.get(sessionId);
    if (sessionRules && [...sessionRules].some((rule) => matchRule(rule, name))) {
      const promptId = randomUUID();
      this.broadcastResolved(sessionId, promptId, 'allow_once', 'session_allowlist');
      return Promise.resolve(this.makeResponse('allow', 'session_allowlist'));
    }

    // 5. pending — wait for user
    const promptId = randomUUID();
    const deadlineMs = now() + (this.deps.timeoutMs ?? 60_000);

    return new Promise<PermissionResponse>((resolve) => {
      const resolveHook = (verdict: PermissionVerdict, reason?: string) => {
        resolve(this.makeResponse(verdict, reason));
      };

      const timer = setTimeout(() => {
        const submap = this.pending.get(sessionId);
        const entry = submap?.get(promptId);
        if (!entry) return;
        submap!.delete(promptId);
        this.broadcastResolved(sessionId, promptId, 'timeout', 'timeout');
        entry.resolveHook('deny', 'timeout');
      }, this.deps.timeoutMs ?? 60_000);
      (timer as any).unref?.();

      const entry: PendingPermission = {
        promptId,
        sessionId,
        toolUseId,
        turnId,
        name,
        input,
        deadlineMs,
        timer,
        resolveHook,
      };

      let submap = this.pending.get(sessionId);
      if (!submap) {
        submap = new Map();
        this.pending.set(sessionId, submap);
      }
      submap.set(promptId, entry);

      this.deps.broadcast({
        kind: 'permission_requested',
        sessionId,
        ts: now(),
        promptId,
        toolUseId,
        turnId,
        name,
        input,
        deadlineMs,
      });
    });
  };

  /**
   * Called from the UI/MCP surface once the user decides. Finds the pending
   * entry, clears its timer, updates the allowlist if applicable, broadcasts
   * a permission_resolved event, and satisfies the pending promise so the
   * hook child can reply to the Claude CLI.
   */
  resolvePermission(
    sessionId: string,
    promptId: string,
    decision: PermissionDecision,
    userLabel?: string,
  ): void {
    const submap = this.pending.get(sessionId);
    const entry = submap?.get(promptId);
    if (!entry) return;

    clearTimeout(entry.timer);

    if (decision === 'allow_session') {
      let set = this.allowlist.get(sessionId);
      if (!set) {
        set = new Set();
        this.allowlist.set(sessionId, set);
      }
      set.add(entry.name);
    }

    const verdict: PermissionVerdict = decision === 'deny' ? 'deny' : 'allow';
    entry.resolveHook(verdict, 'user');

    this.broadcastResolved(sessionId, promptId, decision, 'user', userLabel);
    submap!.delete(promptId);
  }

  /**
   * Per-session mode is authoritative in the session registry; this is a
   * placeholder kept for API symmetry.
   */
  // TODO: wire this through to the registry if/when PermissionBridge becomes
  // the mode source-of-truth.
  setMode(_sessionId: string, _mode: PermissionMode): void {
    // no-op
  }

  /**
   * Invoked when a session is stopped/canceled so any in-flight permission
   * prompts don't dangle. Every pending entry is denied with a timeout event
   * and the session's allowlist is dropped.
   */
  cancelSessionPending(sessionId: string): void {
    const submap = this.pending.get(sessionId);
    if (submap) {
      for (const entry of submap.values()) {
        clearTimeout(entry.timer);
        this.broadcastResolved(sessionId, entry.promptId, 'timeout', 'timeout');
        entry.resolveHook('deny', 'session_canceled');
      }
      this.pending.delete(sessionId);
    }
    this.allowlist.delete(sessionId);
  }

  /**
   * Writes a Claude CLI settings file that registers the PreToolUse hook for
   * this session. The socket path is baked into the child's env by the
   * ChildManager; it's accepted here for signature stability.
   */
  async generateSettingsFile(sessionId: string, _socketPath: string): Promise<string> {
    const sha = createHash('sha1').update(sessionId).digest('hex').slice(0, 16);
    const dir = path.join(this.deps.persistDir, 'settings');
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, `${sha}.settings.json`);
    const bun = this.deps.bunBin ?? 'bun';
    const config = {
      hooks: {
        PreToolUse: [
          {
            matcher: 'Bash|Edit|Write|MultiEdit|NotebookEdit|WebFetch|Read|Grep|Glob|Task|TodoWrite|mcp__.*',
            hooks: [{ type: 'command', command: `${bun} ${this.deps.hookBinPath}` }],
          },
        ],
      },
    };
    await writeFile(file, JSON.stringify(config, null, 2), 'utf8');
    return file;
  }

  setDb(db: import('bun:sqlite').Database, projectRoot?: string): void {
    this.db = db;
    this.projectRoot = projectRoot;
    migrate0004(db);
  }

  async loadSessionAllowlist(sessionId: string, cwd?: string): Promise<void> {
    const effectiveCwd = cwd ?? this.projectRoot;
    // Load settings-derived allow rules
    try {
      const merged = await mergeSettings(effectiveCwd);
      for (const { rule } of merged.allowRules) {
        const set = this.allowlist.get(sessionId) ?? new Set<string>();
        set.add(rule);
        this.allowlist.set(sessionId, set);
      }
    } catch {
      // settings files may not exist — ignore
    }
    // Rehydrate persisted session allowlist from DB
    if (this.db) {
      const rows = this.db
        .query<{ rule_text: string }, [string]>(
          'SELECT rule_text FROM agent_session_allowlist WHERE session_id = ?',
        )
        .all(sessionId);
      const set = this.allowlist.get(sessionId) ?? new Set<string>();
      for (const row of rows) set.add(row.rule_text);
      this.allowlist.set(sessionId, set);
    }
  }

  addAllowlistRule(sessionId: string, ruleText: string, projectRoot?: string): void {
    const set = this.allowlist.get(sessionId) ?? new Set<string>();
    set.add(ruleText);
    this.allowlist.set(sessionId, set);
    if (this.db) {
      const root = projectRoot ?? this.projectRoot ?? '';
      this.db
        .query(
          'INSERT OR IGNORE INTO agent_session_allowlist (session_id, project_root, rule_text, scope, added_at) VALUES (?, ?, ?, ?, ?)',
        )
        .run(sessionId, root, ruleText, 'session', Date.now());
    }
  }

  private makeResponse(verdict: PermissionVerdict, reason?: string): PermissionResponse {
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: verdict,
        permissionDecisionReason: reason,
      },
    } as PermissionResponse;
  }

  private broadcastResolved(
    sessionId: string,
    promptId: string,
    decision: PermissionDecision | 'timeout',
    resolvedBy: 'user' | 'mode_auto' | 'session_allowlist' | 'timeout',
    userLabel?: string,
  ): void {
    const now = this.deps.now ?? Date.now;
    this.deps.broadcast({
      kind: 'permission_resolved',
      sessionId,
      ts: now(),
      promptId,
      decision,
      resolvedBy,
      userLabel,
    } as AgentEvent);
  }
}
