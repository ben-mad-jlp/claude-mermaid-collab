import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { ChildManager } from './child-manager.ts';
import { Projector } from './projector.ts';
import { EventLog } from './event-log.ts';
import { PermissionBridge } from './permission-bridge.ts';
import { start as startPermissionSocket, type PermissionSocketServer } from './permission-socket.ts';
import { WorktreeManager } from './worktree-manager.ts';
import type { AgentEvent, PermissionMode, PermissionDecision, ProjectionCtx, SessionWorktree, SessionMetadata, EffortLevel } from './contracts.ts';

// Fixed namespace UUID for the collab agent (treated as 16 raw bytes; value is arbitrary but stable).
export const NAMESPACE_COLLAB_AGENT = 'd16e4f3e-1d0e-4a1f-9f3a-c011a6a9e401';

function uuidBytesFromString(u: string): Uint8Array {
  const hex = u.replace(/-/g, '');
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function bytesToUuid(b: Uint8Array): string {
  const hex = Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function uuidv5(name: string, namespace: string): string {
  const nsBytes = uuidBytesFromString(namespace);
  const hash = createHash('sha1');
  hash.update(nsBytes);
  hash.update(name, 'utf8');
  const digest = hash.digest();
  const out = new Uint8Array(16);
  out.set(digest.subarray(0, 16));
  out[6] = (out[6] & 0x0f) | 0x50; // version 5
  out[8] = (out[8] & 0x3f) | 0x80; // RFC 4122 variant
  return bytesToUuid(out);
}

export type AgentBroadcast = (msg: { type: 'agent_event'; channel: string; event: AgentEvent }) => void;

export interface RegistryOpts {
  broadcast: AgentBroadcast;
  persistDir?: string;
  spawn?: (cmd: string[], opts: any) => any;
  claudeBin?: string;
  hookBinPath?: string;
  bunBin?: string;
  permissionTimeoutMs?: number;
  defaultPermissionMode?: PermissionMode;
  projectRoot?: string;
  worktreeBaseDir?: string;
  eventLog?: EventLog;
}

interface Entry {
  child: ChildManager;
  claudeSessionId: string;
  cwd: string;
  ctx: ProjectionCtx;
  runningToolUseIds: Set<string>;
  permissionMode: PermissionMode;
  sessionAllowlist: Set<string>;
  socket: PermissionSocketServer | null;
  settingsPath: string | null;
  socketPath: string | null;
  worktree: SessionWorktree | null;
  worktreeDirty?: boolean;
  model?: string;
  effort?: EffortLevel;
  displayName?: string;
}

interface PersistRecord {
  sessionId: string;
  claudeSessionId: string;
  cwd: string;
  lastSeen: number;
}

const RING_MAX = 500;

function extractJsonlText(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content
    .filter((c: any) => c && c.type === 'text' && typeof c.text === 'string')
    .map((c: any) => c.text)
    .join('');
}

export class AgentSessionRegistry {
  private map = new Map<string, Entry>();
  private pendingStarts = new Map<string, Promise<ChildManager>>();
  private transcripts = new Map<string, AgentEvent[]>();
  private readonly persistDir: string;
  private readonly bridge: PermissionBridge;
  private readonly worktreeManager: WorktreeManager;
  private readonly projectRoot: string;
  private readonly eventLog: EventLog;
  private readonly projector: Projector;
  private readonly db: ReturnType<EventLog['getDb']>;

  constructor(private opts: RegistryOpts) {
    this.persistDir = opts.persistDir ?? path.join(process.cwd(), '.collab', 'agent-sessions');
    this.projectRoot = opts.projectRoot ?? process.cwd();
    this.eventLog = opts.eventLog ?? new EventLog(path.join(this.persistDir, 'agent-events.db'));
    this.projector = new Projector(this.eventLog);
    this.db = this.eventLog.getDb();
    const hookBinPath = opts.hookBinPath ?? path.resolve(process.cwd(), 'bin/permission-hook.ts');
    this.bridge = new PermissionBridge({
      broadcast: (event: AgentEvent) => this.dispatch(event.sessionId, event),
      getMode: (sid: string) =>
        this.map.get(sid)?.permissionMode ?? opts.defaultPermissionMode ?? 'supervised',
      persistDir: this.persistDir,
      hookBinPath,
      bunBin: opts.bunBin,
      timeoutMs: opts.permissionTimeoutMs,
    });
    this.worktreeManager = new WorktreeManager({
      projectRoot: this.projectRoot,
      baseDir: opts.worktreeBaseDir ?? path.join(this.persistDir, 'worktrees'),
      persistDir: this.persistDir,
      spawn: opts.spawn,
    });
  }

  resolvePermission(
    sessionId: string,
    promptId: string,
    decision: PermissionDecision,
    userLabel?: string,
  ): void {
    this.bridge.resolvePermission(sessionId, promptId, decision, userLabel);
  }

  setPermissionMode(sessionId: string, mode: PermissionMode): void {
    const entry = this.map.get(sessionId);
    if (entry) entry.permissionMode = mode;
    this.bridge.setMode?.(sessionId, mode);
  }

  getClaudeSessionId(sessionId: string): string {
    return uuidv5(sessionId, NAMESPACE_COLLAB_AGENT);
  }

  async getOrCreate(sessionId: string, cwd: string): Promise<ChildManager> {
    const existing = this.map.get(sessionId);
    if (existing && existing.child.isAlive) return existing.child;

    const pending = this.pendingStarts.get(sessionId);
    if (pending) return pending;

    const p = this.startChild(sessionId, cwd).finally(() => {
      this.pendingStarts.delete(sessionId);
    });
    this.pendingStarts.set(sessionId, p);
    return p;
  }

  async resume(sessionId: string): Promise<ChildManager> {
    const record = await this.readPersist(sessionId);
    if (!record) throw new Error(`no persisted record for session ${sessionId}`);
    return this.getOrCreate(sessionId, record.cwd);
  }

  async stop(sessionId: string): Promise<void> {
    const entry = this.map.get(sessionId);
    if (!entry) return;
    await entry.child.stop();
    this.bridge.cancelSessionPending(sessionId);
    await entry.socket?.close().catch(() => {});
    this.map.delete(sessionId);
    this.transcripts.delete(sessionId);
  }

  /**
   * Fully reset a session so the next `agent_send` starts fresh with a new
   * Claude session. Cancels any in-flight turn, kills the child process,
   * deletes the Claude CLI jsonl history file (so the deterministic
   * claudeSessionId re-spawns as a new conversation), and emits
   * `session_cleared` so clients can reset their transcript UI.
   */
  async clear(sessionId: string): Promise<void> {
    this.cancelTurn(sessionId);
    const entry = this.map.get(sessionId);
    if (!entry) return;
    const previousClaudeSessionId = entry.claudeSessionId;
    const cwd = entry.cwd;
    await entry.child.stop();
    await entry.socket?.close().catch(() => {});
    this.map.delete(sessionId);
    this.transcripts.delete(sessionId);
    // Mirror slug logic used in claudeSessionExists/backfillHistory.
    const slug = cwd.replace(/[/.]/g, '-');
    const home = process.env.HOME ?? '';
    const jsonlPath = path.join(home, '.claude', 'projects', slug, `${previousClaudeSessionId}.jsonl`);
    await fs.unlink(jsonlPath).catch(() => {});
    this.dispatch(sessionId, {
      kind: 'session_cleared',
      sessionId,
      ts: Date.now(),
      previousClaudeSessionId,
    } as AgentEvent);
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.stop(sessionId);
    try {
      await this.worktreeManager.remove(sessionId);
    } catch (e) {
      console.warn('[registry] worktree remove failed', e);
    }
    try {
      await fs.unlink(this.persistPath(sessionId));
    } catch {
      /* ignore */
    }
  }

  async runCommitPushPR(
    sessionId: string,
    opts: { title: string; body?: string; draft?: boolean },
  ): Promise<void> {
    const entry = this.map.get(sessionId);
    if (!entry?.worktree || isNonGit(entry.worktree)) {
      throw new Error('No worktree for this session');
    }
    const turnId = randomUUID();
    const toolUseId = randomUUID();
    const name = 'ComposeCommitPushPR';
    this.dispatch(sessionId, { kind: 'turn_start', sessionId, ts: Date.now(), turnId });
    this.dispatch(sessionId, {
      kind: 'tool_call_started',
      sessionId,
      ts: Date.now(),
      turnId,
      messageId: turnId,
      toolUseId,
      name,
      input: opts,
      index: 0,
    });
    try {
      const result = await this.worktreeManager.commitPushPR(sessionId, {
        title: opts.title,
        body: opts.body,
        draft: opts.draft,
        onProgress: (channel, chunk) =>
          this.dispatch(sessionId, {
            kind: 'tool_call_progress',
            sessionId,
            ts: Date.now(),
            toolUseId,
            channel,
            chunk,
            seq: Date.now(),
          }),
      });
      this.dispatch(sessionId, {
        kind: 'tool_call_completed',
        sessionId,
        ts: Date.now(),
        toolUseId,
        status: 'ok',
        output: result,
      });
    } catch (e) {
      this.dispatch(sessionId, {
        kind: 'tool_call_completed',
        sessionId,
        ts: Date.now(),
        toolUseId,
        status: 'error',
        error: (e as Error).message,
      });
    } finally {
      this.dispatch(sessionId, {
        kind: 'turn_end',
        sessionId,
        ts: Date.now(),
        turnId,
        canceled: false,
      });
    }
  }

  transcriptOf(sessionId: string): AgentEvent[] {
    return this.transcripts.get(sessionId) ?? [];
  }

  getEventLog(): EventLog {
    return this.eventLog;
  }

  getIfAlive(sessionId: string): ChildManager | null {
    const entry = this.map.get(sessionId);
    return entry && entry.child.isAlive ? entry.child : null;
  }

  getSession(sessionId: string): SessionMetadata | null {
    const row = this.db
      .prepare(
        `SELECT session_id, display_name, model, effort, last_activity_ts,
                total_cost_usd, total_input_tokens, total_output_tokens,
                total_cache_read_tokens, total_cache_creation_tokens
         FROM agent_sessions WHERE session_id = ?`,
      )
      .get(sessionId) as
      | {
          session_id: string;
          display_name: string | null;
          model: string | null;
          effort: string | null;
          last_activity_ts: number | null;
          total_cost_usd: number | null;
          total_input_tokens: number | null;
          total_output_tokens: number | null;
          total_cache_read_tokens: number | null;
          total_cache_creation_tokens: number | null;
        }
      | undefined;
    if (!row) {
      // DB row doesn't exist yet (first spawn before any event is appended).
      // Fall back to the in-memory Entry so model/effort/displayName are visible
      // to child-manager before the first event commits (BUG-02).
      const entry = this.map.get(sessionId);
      if (!entry && !this.pendingStarts.has(sessionId)) return null;
      return {
        sessionId,
        displayName: entry?.displayName,
        model: entry?.model,
        effort: entry?.effort,
        lastActivityTs: undefined,
        totalCostUsd: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCacheReadTokens: 0,
        totalCacheCreationTokens: 0,
      };
    }
    return {
      sessionId: row.session_id,
      displayName: row.display_name ?? undefined,
      model: row.model ?? undefined,
      effort: (row.effort as EffortLevel | null) ?? undefined,
      lastActivityTs: row.last_activity_ts ?? undefined,
      totalCostUsd: row.total_cost_usd ?? 0,
      totalInputTokens: row.total_input_tokens ?? 0,
      totalOutputTokens: row.total_output_tokens ?? 0,
      totalCacheReadTokens: row.total_cache_read_tokens ?? 0,
      totalCacheCreationTokens: row.total_cache_creation_tokens ?? 0,
    };
  }

  listSessions(
    opts: { projectRoot?: string; limit?: number; offset?: number; archived?: boolean } = {},
  ): SessionMetadata[] {
    // Note: `archived_at` / `project_root` columns do not yet exist on
    // `agent_sessions` (migration 0002). The `opts.archived` and
    // `opts.projectRoot` filters are a no-op / in-memory gate here until a
    // later migration adds those columns and we can push them into SQL.
    if (opts.projectRoot && opts.projectRoot !== this.projectRoot) return [];
    const limit = Math.max(1, Math.min(200, opts.limit ?? 50));
    const offset = Math.max(0, opts.offset ?? 0);
    const rows = this.db
      .prepare(
        `SELECT session_id, display_name, model, effort, last_activity_ts,
                total_cost_usd, total_input_tokens, total_output_tokens,
                total_cache_read_tokens, total_cache_creation_tokens
         FROM agent_sessions
         ORDER BY COALESCE(last_activity_ts, 0) DESC, session_id ASC
         LIMIT ? OFFSET ?`,
      )
      .all(limit, offset) as Array<{
        session_id: string;
        display_name: string | null;
        model: string | null;
        effort: string | null;
        last_activity_ts: number | null;
        total_cost_usd: number | null;
        total_input_tokens: number | null;
        total_output_tokens: number | null;
        total_cache_read_tokens: number | null;
        total_cache_creation_tokens: number | null;
      }>;
    return rows.map((r) => ({
      sessionId: r.session_id,
      displayName: r.display_name ?? undefined,
      model: r.model ?? undefined,
      effort: (r.effort as EffortLevel | null) ?? undefined,
      lastActivityTs: r.last_activity_ts ?? undefined,
      totalCostUsd: r.total_cost_usd ?? 0,
      totalInputTokens: r.total_input_tokens ?? 0,
      totalOutputTokens: r.total_output_tokens ?? 0,
      totalCacheReadTokens: r.total_cache_read_tokens ?? 0,
      totalCacheCreationTokens: r.total_cache_creation_tokens ?? 0,
    }));
  }

  setModel(sessionId: string, model: string, effort?: EffortLevel): void {
    this.db
      .prepare('INSERT OR IGNORE INTO agent_sessions (session_id, last_seq) VALUES (?, 0)')
      .run(sessionId);
    this.db
      .prepare('UPDATE agent_sessions SET model = ?, effort = ? WHERE session_id = ?')
      .run(model, effort ?? null, sessionId);
    const entry = this.map.get(sessionId);
    if (entry) {
      entry.model = model;
      entry.effort = effort;
    }
  }

  setDisplayName(sessionId: string, name: string): void {
    this.db
      .prepare('INSERT OR IGNORE INTO agent_sessions (session_id, last_seq) VALUES (?, 0)')
      .run(sessionId);
    this.db
      .prepare('UPDATE agent_sessions SET display_name = ? WHERE session_id = ?')
      .run(name, sessionId);
    const entry = this.map.get(sessionId);
    if (entry) entry.displayName = name;
  }

  recordAndDispatch(sessionId: string, event: AgentEvent): number | undefined {
    return this.dispatch(sessionId, event);
  }

  /**
   * Mark a turnId that should be used by the projector the next time it mints
   * a top-level turn for this session. Lets the dispatcher reuse the same
   * turnId across `checkpoint_created` and the subsequent `turn_start`.
   */
  setPendingTurnId(sessionId: string, turnId: string): void {
    const entry = this.map.get(sessionId);
    if (!entry) return;
    entry.ctx.pendingTurnId = turnId;
  }

  /**
   * Cancel the current turn: send SIGINT to the child and synthesize a
   * terminal `turn_end` event (canceled=true) so clients clear their
   * streaming/in-flight state immediately, without waiting for the child's
   * eventual `result` frame (which may never arrive or may arrive late).
   *
   * Also resets the projection ctx so any late-arriving `result` frame does
   * not produce a duplicate turn_end for the already-canceled turn.
   */
  cancelTurn(sessionId: string): void {
    const entry = this.map.get(sessionId);
    if (!entry) return;
    const child = entry.child;
    const ctx = entry.ctx;
    const turnId = ctx.currentTurnId;
    const runningIds = Array.from(entry.runningToolUseIds);
    if (turnId) {
      const now = Date.now();
      for (const id of runningIds) {
        ctx.completedToolUseIds.add(id);
        this.dispatch(sessionId, {
          kind: 'tool_call_completed',
          sessionId,
          ts: now,
          toolUseId: id,
          status: 'canceled',
          historical: false,
        });
      }
      entry.runningToolUseIds.clear();
    }
    if (child.isAlive) child.cancelTurn();
    this.bridge.cancelSessionPending(sessionId);
    if (turnId) {
      ctx.currentTurnId = null;
      ctx.currentAssistantMessageId = null;
      ctx.nextDeltaIndex = 0;
      this.dispatch(sessionId, {
        kind: 'turn_end',
        sessionId,
        ts: Date.now(),
        turnId,
        canceled: true,
        stopReason: 'canceled',
      });
    }
  }

  private async claudeSessionExists(cwd: string, claudeSessionId: string): Promise<boolean> {
    const slug = cwd.replace(/[/.]/g, '-');
    const home = process.env.HOME ?? '';
    const p = path.join(home, '.claude', 'projects', slug, `${claudeSessionId}.jsonl`);
    try {
      await fs.access(p);
      return true;
    } catch {
      return false;
    }
  }

  private async startChild(sessionId: string, _cwd: string): Promise<ChildManager> {
    const claudeSessionId = this.getClaudeSessionId(sessionId);

    const permissionMode: PermissionMode = this.opts.defaultPermissionMode ?? 'supervised';

    const shortHash = createHash('sha1').update(sessionId).digest('hex').slice(0, 16);
    const socketDir = path.join(this.persistDir, 'sockets');
    await fs.mkdir(socketDir, { recursive: true });
    const socketPath = path.join(socketDir, `${shortHash}.sock`);

    const settingsPath = await this.bridge.generateSettingsFile(sessionId, socketPath);

    // Ensure worktree before spawning child.
    const wt = await this.worktreeManager.ensure(sessionId);
    const dirty =
      !isNonGit(wt) ? await this.worktreeManager.isDirty(sessionId) : false;
    const spawnCwd = isNonGit(wt) ? this.projectRoot : wt.path;
    const resume = await this.claudeSessionExists(spawnCwd, claudeSessionId);
    this.dispatch(sessionId, {
      kind: 'worktree_info',
      sessionId,
      ts: Date.now(),
      info: wt,
      dirty,
    });

    const socket = await startPermissionSocket(
      socketPath,
      async (req) => {
        const entry = this.map.get(sessionId);
        const entryWt = entry?.worktree ?? wt;
        if (entryWt && !isNonGit(entryWt)) {
          const paths = extractPathsFromInput(req.toolName, req.toolInput);
          if (
            paths.length > 0 &&
            paths.every((p) => isInsideWorktree(p, entryWt.path))
          ) {
            const promptId = randomUUID();
            this.dispatch(sessionId, {
              kind: 'permission_resolved',
              sessionId,
              ts: Date.now(),
              promptId,
              decision: 'allow_once',
              resolvedBy: 'worktree_auto',
            });
            return {
              hookSpecificOutput: {
                hookEventName: 'PreToolUse',
                permissionDecision: 'allow',
                permissionDecisionReason: 'worktree_auto',
              },
            } as any;
          }
        }
        return this.bridge.onPermissionRequest(sessionId, req);
      },
    );

    const existingMeta = this.getSession(sessionId);

    const child = new ChildManager({
      sessionId,
      cwd: spawnCwd,
      claudeSessionId,
      resume,
      spawn: this.opts.spawn,
      claudeBin: this.opts.claudeBin,
      permissionMode,
      settingsPath,
      socketPath,
      extraArgs: isNonGit(wt) ? [] : ['--add-dir', this.projectRoot],
      model: existingMeta?.model,
      effort: existingMeta?.effort,
      displayName: existingMeta?.displayName,
    });

    const ctx: ProjectionCtx = {
      sessionId,
      currentTurnId: null,
      currentAssistantMessageId: null,
      nextDeltaIndex: 0,
      historical: false,
      seenToolUseIds: new Set<string>(),
      completedToolUseIds: new Set<string>(),
      toolInputDeltas: {},
      subAgentParentMap: new Map<string, string>(),
      toolUseIdByBlockIndex: {},
      toolProgressSeq: {},
      thinkingDeltas: {},
      turnIdByToolUseId: {},
    };

    const runningToolUseIds = new Set<string>();

    child.on('stdout-frame', (frame: unknown) => {
      console.log(`[agent:${sessionId}] frame:`, JSON.stringify(frame).slice(0, 500));
      // Project + append as one atomic batch so every event carries a seq.
      const stamped = this.projector.project(frame, ctx);
      for (const event of stamped) {
        if (event.kind === 'tool_call_started') {
          runningToolUseIds.add(event.toolUseId);
        } else if (event.kind === 'tool_call_completed') {
          runningToolUseIds.delete(event.toolUseId);
        } else if (event.kind === 'turn_end') {
          runningToolUseIds.clear();
        }
        this.broadcastAndCache(sessionId, event);
      }
    });

    child.on('stderr', (line: string) => {
      console.error(`[agent:${sessionId}] stderr:`, line);
    });

    const myChild = child;
    child.on('exit', (info: { code: number | null; signal: string | null }) => {
      console.error(`[agent:${sessionId}] exit:`, info);
      if (runningToolUseIds.size > 0 && ctx.currentTurnId) {
        const now = Date.now();
        for (const id of runningToolUseIds) {
          ctx.completedToolUseIds.add(id);
          this.dispatch(sessionId, {
            kind: 'tool_call_completed',
            sessionId,
            ts: now,
            toolUseId: id,
            status: 'canceled',
            historical: false,
          });
        }
        runningToolUseIds.clear();
      }
      const ev: AgentEvent = {
        kind: 'session_ended',
        sessionId,
        ts: Date.now(),
        reason: 'exit',
        code: info.code ?? undefined,
      };
      this.dispatch(sessionId, ev);
      this.bridge.cancelSessionPending(sessionId);
      const cur = this.map.get(sessionId);
      if (cur && cur.child === myChild) {
        cur.socket?.close().catch(() => {});
        this.map.delete(sessionId);
        this.transcripts.delete(sessionId);
      }
    });

    child.on('error', (err: { where: string; message: string; recoverable: boolean }) => {
      const ev: AgentEvent = {
        kind: 'error',
        sessionId,
        ts: Date.now(),
        where: (err.where as any) ?? 'child',
        message: err.message,
        recoverable: err.recoverable,
      };
      this.dispatch(sessionId, ev);
    });

    await child.start();
    await this.writePersist({
      sessionId,
      claudeSessionId,
      cwd: spawnCwd,
      lastSeen: Date.now(),
    });

    this.map.set(sessionId, {
      child,
      claudeSessionId,
      cwd: spawnCwd,
      ctx,
      runningToolUseIds,
      permissionMode,
      sessionAllowlist: new Set<string>(),
      socket,
      settingsPath,
      socketPath,
      worktree: wt,
      worktreeDirty: dirty,
      model: existingMeta?.model,
      effort: existingMeta?.effort,
      displayName: existingMeta?.displayName,
    });

    // Claude's stream-json input mode doesn't emit the system/init frame until
    // it receives the first user message. Synthesize session_started now using
    // the deterministic UUID so the UI can mark itself ready.
    this.dispatch(sessionId, {
      kind: 'session_started',
      sessionId,
      ts: Date.now(),
      claudeSessionId,
      cwd: spawnCwd,
      resumed: resume,
    });

    // When resuming, Claude CLI has the full conversation history on disk but
    // does not replay it to stdout. Read the jsonl and synthesize historical
    // AgentEvents so late-joining tabs and post-restart reconnects see the
    // prior transcript.
    if (resume) {
      await this.backfillHistory(sessionId, spawnCwd, claudeSessionId);
    }

    return child;
  }

  private async backfillHistory(sessionId: string, cwd: string, claudeSessionId: string): Promise<void> {
    const slug = cwd.replace(/[/.]/g, '-');
    const home = process.env.HOME ?? '';
    const p = path.join(home, '.claude', 'projects', slug, `${claudeSessionId}.jsonl`);
    let raw: string;
    try {
      raw = await fs.readFile(p, 'utf8');
    } catch {
      return;
    }
    const lines = raw.split('\n');
    let turnIdx = 0;
    const histSeen = new Map<string, { turnId: string; ts: number; messageId?: string }>();
    const histCompleted = new Set<string>();
    for (const line of lines) {
      if (!line) continue;
      let entry: any;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      const ts = Number.isFinite(Date.parse(entry.timestamp)) ? Date.parse(entry.timestamp) : Date.now();
      const content = entry?.message?.content;
      const text = extractJsonlText(content);
      if (entry.type === 'user') {
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block?.type === 'tool_result' && block.tool_use_id) {
              histCompleted.add(block.tool_use_id);
            }
          }
        }
        if (text) {
          this.dispatch(sessionId, {
            kind: 'user_message',
            sessionId,
            ts,
            messageId: entry.uuid ?? `hist-user-${turnIdx}`,
            text,
          });
        }
      } else if (entry.type === 'assistant') {
        const turnId = `hist-turn-${turnIdx++}`;
        const messageId = entry.message?.id ?? entry.uuid ?? `hist-asst-${turnIdx}`;
        this.dispatch(sessionId, { kind: 'turn_start', sessionId, ts, turnId });
        if (Array.isArray(content)) {
          let toolIdx = 0;
          for (const block of content) {
            if (block?.type === 'tool_use' && block.id) {
              histSeen.set(block.id, { turnId, ts, messageId });
              this.dispatch(sessionId, {
                kind: 'tool_call_started',
                sessionId,
                ts,
                turnId,
                messageId,
                toolUseId: block.id,
                name: block.name,
                input: block.input ?? {},
                index: toolIdx++,
                historical: true,
              });
            }
          }
        }
        if (text) {
          this.dispatch(sessionId, {
            kind: 'assistant_message_complete',
            sessionId,
            ts,
            turnId,
            messageId,
            text,
            historical: true,
          });
        }
        this.dispatch(sessionId, { kind: 'turn_end', sessionId, ts, turnId });
      }
    }
    for (const [id, info] of histSeen) {
      if (histCompleted.has(id)) continue;
      this.dispatch(sessionId, {
        kind: 'tool_call_completed',
        sessionId,
        ts: info.ts,
        toolUseId: id,
        status: 'error',
        error: 'no_result',
        historical: true,
      });
    }
  }

  private dispatch(sessionId: string, event: AgentEvent): number | undefined {
    // Route single synthetic events through the EventLog as a 1-event batch so
    // they also get a monotonic `seq`. Then broadcast + cache the stamped copy.
    const [stamped] = this.projector.appendSynthetic(sessionId, [event]);
    if (!stamped) return undefined;
    this.broadcastAndCache(sessionId, stamped);
    return (stamped as { seq?: number }).seq;
  }

  private broadcastAndCache(sessionId: string, event: AgentEvent): void {
    const channel = `agent:${sessionId}`;
    this.opts.broadcast({ type: 'agent_event', channel, event });
    const ring = this.transcripts.get(sessionId) ?? [];
    ring.push(event);
    while (ring.length > RING_MAX) ring.shift();
    this.transcripts.set(sessionId, ring);
  }

  /**
   * Return recent events for a session. The in-memory ring is a hot cache;
   * if empty, lazy-load the last N events from the EventLog via replay.
   */
  async getRecent(sessionId: string, n: number = RING_MAX): Promise<AgentEvent[]> {
    const ring = this.transcripts.get(sessionId);
    if (ring && ring.length > 0) return ring.slice(-n);
    const last = this.eventLog.getLastSeq(sessionId);
    if (last === 0) return [];
    const from = Math.max(0, last - n);
    const out: AgentEvent[] = [];
    for await (const ev of this.eventLog.replay(sessionId, from)) {
      out.push(ev);
    }
    this.transcripts.set(sessionId, out.slice(-RING_MAX));
    return out;
  }

  private persistPath(sessionId: string): string {
    const sha = createHash('sha1').update(sessionId).digest('hex');
    return path.join(this.persistDir, `${sha}.json`);
  }

  private async readPersist(sessionId: string): Promise<PersistRecord | null> {
    try {
      const raw = await fs.readFile(this.persistPath(sessionId), 'utf8');
      return JSON.parse(raw) as PersistRecord;
    } catch (err: any) {
      if (err?.code === 'ENOENT') return null;
      return null;
    }
  }

  private async writePersist(record: PersistRecord): Promise<void> {
    await fs.mkdir(this.persistDir, { recursive: true });
    await fs.writeFile(this.persistPath(record.sessionId), JSON.stringify(record, null, 2), 'utf8');
  }
}

function extractPathsFromInput(name: string | undefined, input: unknown): string[] {
  if (!name || !input || typeof input !== 'object') return [];
  const inp = input as Record<string, unknown>;
  switch (name) {
    case 'Read':
    case 'Edit':
    case 'Write':
    case 'MultiEdit':
    case 'NotebookEdit': {
      const p = inp.file_path;
      return typeof p === 'string' ? [p] : [];
    }
    case 'Grep':
    case 'Glob': {
      const p = inp.path;
      return typeof p === 'string' ? [p] : [];
    }
    default:
      return [];
  }
}

function isNonGit(wt: SessionWorktree): wt is { kind: 'non_git'; sessionId: string; path: string } {
  return (wt as any).kind === 'non_git';
}

function isInsideWorktree(p: string, worktreePath: string): boolean {
  if (!path.isAbsolute(p)) return false;
  const resolved = path.resolve(p);
  const wt = path.resolve(worktreePath);
  return resolved === wt || resolved.startsWith(wt + path.sep);
}
