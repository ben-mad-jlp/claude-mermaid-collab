import type { ServerWebSocket } from 'bun';
import type { AgentCommand, AgentEvent, EffortLevel } from '../agent/contracts.ts';
import { ideState } from '../services/ide-state.ts';
import { getStatuses } from '../services/session-status-store.ts';
import { setPeerRegistry } from '../services/supervisor-store.ts';

type AgentDispatcherLike = { handle(ws: ServerWebSocket<{ subscriptions: Set<string> }>, cmd: AgentCommand): Promise<void> };

/** True only for IPv4/IPv6 loopback remote addresses. The desktop aggregator
 *  always dials its local collab servers over loopback, so a genuine
 *  peer_registry frame originates from 127.0.0.1 (or its IPv6 forms). A LAN
 *  browser — the forged-registry SSRF vector — never does. Used to gate
 *  peer_registry ingest closed even when MERMAID_AUTH_TOKEN is unset (P1 §2).
 *  Bun reports IPv4 as `127.0.0.1` and may report IPv6 loopback as `::1` or the
 *  IPv4-mapped `::ffff:127.0.0.1`; all three are loopback. */
export function isLoopbackAddress(addr: string | undefined | null): boolean {
  if (!addr) return false;
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

export type NotificationType = 'info' | 'success' | 'warning' | 'error';

export interface NotificationData {
  id: string;
  type: NotificationType;
  title: string;
  message?: string;
  duration: number;
  timestamp: number;
}

export type WSMessage =
  | { type: 'connected'; diagramCount: number }
  | { type: 'diagram_updated'; id: string; content: string; lastModified: number; patch?: { oldString: string; newString: string }; project?: string; session?: string }
  | { type: 'diagram_created'; id: string; name: string; content: string; lastModified: number; project: string; session: string }
  | { type: 'diagram_deleted'; id: string; project: string; session: string }
  | { type: 'diagram_history_updated'; id: string; project: string; session: string; changeCount?: number }
  | { type: 'document_updated'; id: string; content: string; lastModified: number; patch?: { oldString: string; newString: string }; project?: string; session?: string }
  | { type: 'document_created'; id: string; name: string; content: string; lastModified: number; project: string; session: string }
  | { type: 'document_deleted'; id: string; project: string; session: string }
  | { type: 'document_history_updated'; id: string; project: string; session: string; changeCount?: number }
  | { type: 'spreadsheet_updated'; id: string; content: string; lastModified: number; project: string; session: string }
  | { type: 'spreadsheet_created'; id: string; name: string; content: string; lastModified: number; project: string; session: string }
  | { type: 'spreadsheet_deleted'; id: string; project: string; session: string }
  | { type: 'snippet_updated'; id: string; content: string; lastModified: number; project: string; session: string }
  | { type: 'snippet_created'; id: string; name: string; content: string; lastModified: number; project: string; session: string }
  | { type: 'snippet_deleted'; id: string; project: string; session: string }
  | { type: 'code_file_updated'; id: string; content: string; lastModified: number; project: string; session: string }
  | { type: 'code_file_created'; id: string; name: string; content: string; lastModified: number; project: string; session: string }
  | { type: 'code_file_deleted'; id: string; project: string; session: string }
  | { type: 'embed_created'; id: string; name: string; url: string; subtype?: 'storybook'; createdAt: string; storybook?: { storyId: string; port: number }; width?: string; height?: string; project: string; session: string }
  | { type: 'embed_deleted'; id: string; project: string; session: string }
  | { type: 'image_created'; id: string; name: string; url?: string; project: string; session: string; [k: string]: unknown }
  | { type: 'image_deleted'; id: string; project: string; session: string }
  | { type: 'design_updated'; id: string; content: string; sender?: string; project: string; session: string }
  | { type: 'design_created'; id: string; project: string; session: string }
  | { type: 'design_deleted'; id: string; project: string; session: string }
  | { type: 'design_history_updated'; id: string; project: string; session: string; changeCount: number }
  | { type: 'metadata_updated'; itemId?: string; updates?: Record<string, unknown>; foldersChanged?: boolean; project?: string; session?: string }
  | { type: 'subscribe'; id?: string; channel?: string; project?: string }
  | { type: 'unsubscribe'; id?: string; channel?: string }
  | { type: 'question_responded'; questionId: string; response: string; project: string; session: string }
  | { type: 'ui_render'; uiId: string; project: string; session: string; ui: any; blocking: boolean; timestamp: number }
  | { type: 'ui_dismissed'; project: string; session: string }
  | { type: 'ui_updated'; patch: Record<string, unknown>; project: string; session: string }
  | { type: 'session_created'; project: string; session: string }
  | { type: 'session_deleted'; project: string; session: string }
  | { type: 'session_todos_updated'; project: string; session: string; ownerSession?: string; assigneeSession?: string; previousAssigneeSession?: string }
  | { type: 'claude_session_registered'; project: string; session: string; claudePid?: string | number; claudeSessionId?: string; [k: string]: unknown }
  | { type: 'claude_session_status'; project: string; session: string; status: string; [k: string]: unknown }
  | { type: 'claude_context_update'; project: string; session: string; contextPercent: number }
  | { type: 'claude_usage_update'; fiveHourPercent: number; sevenDayPercent: number; updatedAt: number }
  | { type: 'claude_session_checkpoint_ready'; project: string; session: string; persistedAt: number; [k: string]: unknown }
  | { type: 'supervisor_session_cleared'; project: string; session: string; [k: string]: unknown }
  | { type: 'supervisor_decision'; project: string; session: string; kind: string; detail?: string | null; ts: number; [k: string]: unknown }
  | { type: 'lesson_added'; project: string; session: string; [k: string]: unknown }
  | { type: 'notification'; data: NotificationData }
  | { type: 'status_changed'; status: 'working' | 'waiting' | 'idle'; message?: string; lastActivity: string }
  | { type: 'session_state_updated'; lastActivity?: string; completedTasks?: string[]; pendingTasks?: string[]; project?: string; session?: string; state?: unknown }
  | { type: 'agent_start'; sessionId: string; cwd: string }
  | { type: 'agent_send'; sessionId: string; text: string; messageId?: string; attachments?: { attachmentId: string; mimeType: string }[] }
  | { type: 'agent_cancel'; sessionId: string; turnId?: string }
  | { type: 'agent_resume'; sessionId: string }
  | { type: 'agent_stop'; sessionId: string }
  | { type: 'agent_delete_session'; sessionId: string }
  | { type: 'agent_clear'; sessionId: string }
  | { type: 'agent_user_input_respond'; sessionId: string; promptId: string; value: import('../agent/contracts.ts').UserInputValue }
  | { type: 'agent_checkpoint_revert'; sessionId: string; turnId: string }
  | { type: 'agent_permission_resolve'; sessionId: string; promptId: string; decision: import('../agent/contracts.ts').PermissionDecision }
  | { type: 'agent_commit_push_pr'; sessionId: string; title: string; body?: string; draft?: boolean }
  | { type: 'agent_set_model'; sessionId: string; model: string; effort?: EffortLevel; commandId?: string }
  | { type: 'agent_rename_session'; sessionId: string; displayName: string; commandId?: string }
  | { type: 'agent_rewind_to_message'; sessionId: string; messageId: string; commandId?: string }
  | { type: 'sessions_list_invalidated'; sessionId: string }
  | { type: 'agent_event'; channel: string; event: AgentEvent }
  | { type: 'settings_updated'; source?: string; project?: string }
  | { type: 'mcp_server_added'; name: string; project?: string }
  | { type: 'mcp_server_removed'; name: string; project?: string }
  | { type: 'mcp_tools_discovered'; serverName: string; tools: Array<{ name: string; description?: string }>; project?: string }
  | { type: 'mcp_tool_details_loaded'; serverName: string; toolName: string; inputSchema: unknown; project?: string }
  | { type: 'mcp_elicitation_requested'; elicitationId: string; serverName: string; toolName: string; schema: unknown; deadlineMs: number; sessionId?: string }
  | { type: 'mcp_token_cost_updated'; serverName: string; toolName: string; inputTokens: number; outputTokens: number; costUsd?: number }
  | { type: 'ide_focus_terminal'; claudePid: number; claudeSessionId: string; project: string; session: string }
  | { type: 'ide_open_diff'; filePath: string }
  | { type: 'ide_open_terminal'; session: string; project: string; tmuxSession: string }
  | { type: 'ide_connected'; vscodeVersion: string; extensionVersion: string; workspaceFolders?: string[] }
  | { type: 'ide_reattach'; claudePid: number; claudeSessionId: string; project: string; session: string; tmuxSession: string; boundAt: string }
  | { type: 'ide_disconnected'; reason?: string }
  | { type: 'browser_tab_update'; session: string; active: boolean }
  | { type: 'pair_mode_changed'; pairMode: boolean; project: string; session: string }
  | { type: 'supervisor_nudge'; project: string; session: string; serverId: string; text: string; sent: boolean }
  | { type: 'orchestrator_tick'; at: number }
  | { type: 'session_summary_updated'; project: string; session: string;
      progressState: 'active' | 'quiet' | 'stalled' | 'wedged' | 'unknown';
      paneSeenAt: number; updatedAt: number;
      summaryText?: string;
      firstClause?: string;
      summaryUpdatedAt?: number;
      refreshState?: 'fresh' | 'stale-failing';
      structured?: {
        paragraph: string;
        detail?: string;
        status: 'working' | 'idle' | 'stuck' | 'needs-input';
        question?: string;
        options?: Array<{ label: string; valueToSend: string }>;
        recommended?: number;
        multiSelect?: boolean;
      } }
  | { type: 'escalation_created'; project: string; session: string; kind: string; id: string; routedTo?: string; escalation?: unknown }
  | { type: 'escalation_decided'; project: string; session: string; id: string; optionId: string | null }
  // Drive (level=drive) autonomous-decision narration — observational only, NOT
  // load-bearing: the audit table stays the source of truth, these just let a human
  // watch unattended operation live in the EventStream (Bridge).
  | { type: 'drive.auto_resolved'; project: string; todoId: string; escalationId: string; verb: string; bucket?: string; confidence?: number; reason?: string }
  | { type: 'drive.auto_landed'; project: string; escalationId: string; epicId?: string; epicBranch?: string; landed: boolean; conflict?: boolean; masterSha?: string; reason?: string }
  // Steward observability feed (Steward P3) — cheap, NOT load-bearing: the
  // escalation table stays the source of truth; the panel feed just narrates.
  | { type: 'steward_action'; project: string; id: string; action: string; proof?: string }
  | { type: 'steward_handback'; project: string; id: string; reason?: string }
  // Worker-fabric spine (design-worker-fabric-ui §6.4): structural per-phase event so
  // the live work-graph can decorate a todo's node with phase/route/cost. Additive,
  // best-effort; `step` events stay in the transcript poll (not WS) to keep node churn low.
  | { type: 'worker_phase'; project: string; session: string; todoId: string; epicId?: string;
      lifecycle: 'start' | 'end'; role: string; provider?: string; model?: string;
      source?: string; winningScope?: string;
      usage?: { inputTokens?: number; outputTokens?: number }; costUsd?: number; steps?: number; ts: number }
  | { type: 'peer_registry'; peers: Array<{ serverId: string; baseUrl: string }> }
  | { type: 'browser_frame'; session: string; data: string; meta: {
      offsetTop: number; pageScaleFactor: number; deviceWidth: number;
      deviceHeight: number; timestamp?: number; sentAt?: number } }
  | { type: 'browser_input_ack'; session: string; inputId: number }
  /**
   * Inbound panel → server → CDP input event.
   * Mouse/scroll coords are normalized frame fractions [0,1] relative to the
   * rendered frame box; the server maps them to page coords using the latest
   * FrameMeta for the session. Key events do not need coords.
   */
  | { type: 'browser_input'; session: string;
      action: 'mouse' | 'key' | 'scroll';
      xFrac?: number; yFrac?: number;
      event?: 'down' | 'up' | 'move' | 'click'; button?: 'left' | 'middle' | 'right';
      deltaX?: number; deltaY?: number;
      key?: string; text?: string; code?: string; modifiers?: number;
      keyType?: 'keyDown' | 'keyUp' | 'char';
      /** Optional client correlation id — when present the server acks after dispatch
       *  (input round-trip latency instrumentation, 9b8adcea). */
      inputId?: number }
  | { type: 'browser_resize'; session: string;
      width: number; height: number; deviceScaleFactor?: number }
  | { type: 'browser_quality'; session: string;
      quality?: number; maxWidth?: number; maxHeight?: number; everyNthFrame?: number };

export type BrowserInputMsg = Extract<WSMessage, { type: 'browser_input' }>;
export type BrowserResizeMsg  = Extract<WSMessage, { type: 'browser_resize' }>;
export type BrowserQualityMsg = Extract<WSMessage, { type: 'browser_quality' }>;

export class WebSocketHandler {
  private connections: Set<ServerWebSocket<{ subscriptions: Set<string> }>> = new Set();
  private onConnectionsChanged: ((n: number) => void) | null = null;
  private onChannelSubscriptionChange: ((channel: string, count: number) => void) | null = null;
  private onBrowserInput: ((msg: BrowserInputMsg) => void) | null = null;
  private onBrowserResize: ((msg: BrowserResizeMsg) => void) | null = null;
  private onBrowserQuality: ((msg: BrowserQualityMsg) => void) | null = null;
  private agentDispatcher: AgentDispatcherLike | null = null;

  setOnConnectionsChanged(cb: (n: number) => void): void {
    this.onConnectionsChanged = cb;
  }

  private fireConnectionsChanged(): void {
    this.onConnectionsChanged?.(this.connections.size);
  }

  setAgentDispatcher(dispatcher: AgentDispatcherLike): void {
    this.agentDispatcher = dispatcher;
  }

  setOnChannelSubscriptionChange(cb: (channel: string, count: number) => void): void {
    this.onChannelSubscriptionChange = cb;
  }

  setOnBrowserInput(cb: (msg: BrowserInputMsg) => void): void {
    this.onBrowserInput = cb;
  }

  setOnBrowserResize(cb: (msg: BrowserResizeMsg) => void): void { this.onBrowserResize = cb; }
  setOnBrowserQuality(cb: (msg: BrowserQualityMsg) => void): void { this.onBrowserQuality = cb; }

  private countChannelSubscribers(channel: string): number {
    const key = `channel:${channel}`;
    let count = 0;
    for (const ws of this.connections) {
      if (ws.data.subscriptions.has(key)) count++;
    }
    return count;
  }

  handleConnection(ws: ServerWebSocket<{ subscriptions: Set<string> }>): void {
    ws.data.subscriptions = new Set();
    this.connections.add(ws);
    this.fireConnectionsChanged();
  }

  handleDisconnection(ws: ServerWebSocket<{ subscriptions: Set<string> }>): void {
    this.connections.delete(ws);
    this.fireConnectionsChanged();
    ideState.ideDisconnected(ws);
    this.broadcastToChannel('ide', { type: 'ide_status', connected: false } as unknown as WSMessage);
  }

  handleMessage(ws: ServerWebSocket<{ subscriptions: Set<string> }>, message: string): void {
    try {
      const data = JSON.parse(message) as WSMessage;

      if (data.type === 'subscribe') {
        if (data.id) {
          // Specific item subscription (existing behavior)
          ws.data.subscriptions.add(data.id);
        } else if (data.channel) {
          // General channel subscription (new)
          ws.data.subscriptions.add(`channel:${data.channel}`);
          this.onChannelSubscriptionChange?.(data.channel, this.countChannelSubscribers(data.channel));
          // Send current state immediately so client doesn't wait for the next change
          if (data.channel === 'ide') {
            ws.send(JSON.stringify({ type: 'ide_status', connected: ideState.getStatus().connected }));
          }
          // Replay last-known Claude session statuses so a fresh subscriber sees current state.
          // NOTE: session-status-store is per-PROJECT and getStatuses() requires a project path.
          // The subscribe message currently carries only a channel (no project), so we can only
          // replay when a project is explicitly supplied. We intentionally do NOT scan all
          // projects (no such API; openDb() would create stray empty DB files).
          if (data.channel === 'updates' && data.project) {
            for (const row of getStatuses(data.project)) {
              ws.send(JSON.stringify({
                type: 'claude_session_status',
                project: row.project,
                session: row.session,
                status: row.status,
                lastUpdate: row.updatedAt,
              }));
            }
          }
        }
      } else if (data.type === 'unsubscribe') {
        if (data.id) {
          ws.data.subscriptions.delete(data.id);
        } else if (data.channel) {
          ws.data.subscriptions.delete(`channel:${data.channel}`);
          this.onChannelSubscriptionChange?.(data.channel, this.countChannelSubscribers(data.channel));
        }
      } else if (
        data.type === 'agent_start' ||
        data.type === 'agent_send' ||
        data.type === 'agent_cancel' ||
        data.type === 'agent_resume' ||
        data.type === 'agent_stop' ||
        data.type === 'agent_delete_session' ||
        data.type === 'agent_clear' ||
        data.type === 'agent_user_input_respond' ||
        data.type === 'agent_checkpoint_revert' ||
        data.type === 'agent_permission_resolve' ||
        data.type === 'agent_commit_push_pr' ||
        data.type === 'agent_set_model' ||
        data.type === 'agent_rename_session' ||
        data.type === 'agent_rewind_to_message'
      ) {
        if (this.agentDispatcher) {
          const { type, ...rest } = data;
          const cmd = { kind: type, ...rest } as AgentCommand;
          void this.agentDispatcher.handle(ws, cmd);
        } else {
          console.error('Agent command received but no dispatcher registered:', data.type);
        }
      } else if (data.type === 'ide_connected') {
        const d = data as { type: 'ide_connected'; workspaceFolders?: string[]; platform?: string; arch?: string; pid?: number };
        console.log('[ide] connected — platform:', d.platform, 'arch:', d.arch, 'pid:', d.pid, 'folders:', d.workspaceFolders);
        ideState.ideConnected(ws, d.workspaceFolders ?? []).then(() => {
          this.broadcastToChannel('ide', { type: 'ide_status', connected: true } as unknown as WSMessage);
        });
      } else if (data.type === 'peer_registry') {
        // Loopback-gate ingest (P1 §2): the desktop aggregator always dials its
        // local servers over loopback, so only a 127.0.0.1 remote may set the
        // peer registry. A LAN browser forging a peer_registry frame is rejected
        // — closing the registry-injection SSRF even when no auth token is set.
        if (isLoopbackAddress(ws.remoteAddress)) {
          setPeerRegistry(data.peers ?? []);
        } else {
          console.warn('[ws] rejected peer_registry from non-loopback remote:', ws.remoteAddress);
        }
      } else if (data.type === 'browser_input') {
        // Ack after dispatch when the client tagged an inputId (RTT instrumentation,
        // 9b8adcea). onBrowserInput may be sync or async; await either, then echo.
        const inputId = data.inputId;
        if (inputId != null) {
          Promise.resolve(this.onBrowserInput?.(data))
            .then(() => this.broadcastBrowserInputAck(data.session, inputId))
            .catch(() => { /* dispatch failed — no ack, client just won't sample */ });
        } else {
          this.onBrowserInput?.(data);
        }
      } else if (data.type === 'browser_resize') {
        this.onBrowserResize?.(data);
      } else if (data.type === 'browser_quality') {
        this.onBrowserQuality?.(data);
      }
    } catch (error) {
      console.error('Failed to parse WebSocket message:', error);
    }
  }

  broadcast(message: WSMessage): void {
    const json = JSON.stringify(message);
    const deadConnections: ServerWebSocket<{ subscriptions: Set<string> }>[] = [];

    for (const ws of this.connections) {
      try {
        ws.send(json);
      } catch (error) {
        // Track dead connections to clean up
        deadConnections.push(ws);
        console.error('Failed to send WebSocket message:', error);
      }
    }

    // Clean up disconnected clients to prevent memory leaks
    for (const ws of deadConnections) {
      this.connections.delete(ws);
    }
    if (deadConnections.length > 0) this.fireConnectionsChanged();
  }

  broadcastToDiagram(id: string, message: WSMessage): void {
    const json = JSON.stringify(message);
    const deadConnections: ServerWebSocket<{ subscriptions: Set<string> }>[] = [];

    for (const ws of this.connections) {
      if (ws.data.subscriptions.has(id)) {
        try {
          ws.send(json);
        } catch (error) {
          deadConnections.push(ws);
          console.error('Failed to send diagram message:', error);
        }
      }
    }

    // Clean up disconnected clients
    for (const ws of deadConnections) {
      this.connections.delete(ws);
    }
    if (deadConnections.length > 0) this.fireConnectionsChanged();
  }

  broadcastToDocument(id: string, message: WSMessage): void {
    const json = JSON.stringify(message);
    const deadConnections: ServerWebSocket<{ subscriptions: Set<string> }>[] = [];

    for (const ws of this.connections) {
      if (ws.data.subscriptions.has(id)) {
        try {
          ws.send(json);
        } catch (error) {
          deadConnections.push(ws);
          console.error('Failed to send document message:', error);
        }
      }
    }

    // Clean up disconnected clients
    for (const ws of deadConnections) {
      this.connections.delete(ws);
    }
    if (deadConnections.length > 0) this.fireConnectionsChanged();
  }

  broadcastToSpreadsheet(id: string, message: WSMessage): void {
    const json = JSON.stringify(message);
    const deadConnections: ServerWebSocket<{ subscriptions: Set<string> }>[] = [];

    for (const ws of this.connections) {
      if (ws.data.subscriptions.has(id)) {
        try {
          ws.send(json);
        } catch (error) {
          deadConnections.push(ws);
          console.error('Failed to send spreadsheet message:', error);
        }
      }
    }

    // Clean up disconnected clients
    for (const ws of deadConnections) {
      this.connections.delete(ws);
    }
    if (deadConnections.length > 0) this.fireConnectionsChanged();
  }

  broadcastToSnippet(id: string, message: WSMessage): void {
    const json = JSON.stringify(message);
    const deadConnections: ServerWebSocket<{ subscriptions: Set<string> }>[] = [];

    for (const ws of this.connections) {
      if (ws.data.subscriptions.has(id)) {
        try {
          ws.send(json);
        } catch (error) {
          deadConnections.push(ws);
          console.error('Failed to send snippet message:', error);
        }
      }
    }

    // Clean up disconnected clients
    for (const ws of deadConnections) {
      this.connections.delete(ws);
    }
    if (deadConnections.length > 0) this.fireConnectionsChanged();
  }

  broadcastToChannel(channel: string, message: WSMessage): void {
    const json = JSON.stringify(message);
    const key = `channel:${channel}`;
    const deadConnections: ServerWebSocket<{ subscriptions: Set<string> }>[] = [];

    for (const ws of this.connections) {
      if (ws.data.subscriptions.has(key)) {
        try {
          ws.send(json);
        } catch (error) {
          deadConnections.push(ws);
          console.error('Failed to send channel message:', error);
        }
      }
    }

    for (const ws of deadConnections) {
      this.connections.delete(ws);
    }
    if (deadConnections.length > 0) this.fireConnectionsChanged();
  }

  broadcastNotification(notificationData: NotificationData): void {
    const message: WSMessage = {
      type: 'notification',
      data: notificationData,
    };

    const json = JSON.stringify(message);
    const deadConnections: ServerWebSocket<{ subscriptions: Set<string> }>[] = [];

    for (const ws of this.connections) {
      try {
        ws.send(json);
      } catch (error) {
        // Track dead connections to clean up
        deadConnections.push(ws);
        console.error('Failed to send notification message:', error);
      }
    }

    // Clean up disconnected clients to prevent memory leaks
    for (const ws of deadConnections) {
      this.connections.delete(ws);
    }
    if (deadConnections.length > 0) this.fireConnectionsChanged();
  }

  broadcastStatus(status: 'working' | 'waiting' | 'idle', message?: string, lastActivity?: string): void {
    const message_obj: WSMessage = {
      type: 'status_changed',
      status,
      message,
      lastActivity: lastActivity || new Date().toISOString(),
    };

    const json = JSON.stringify(message_obj);
    const deadConnections: ServerWebSocket<{ subscriptions: Set<string> }>[] = [];

    for (const ws of this.connections) {
      try {
        ws.send(json);
      } catch (error) {
        // Track dead connections to clean up
        deadConnections.push(ws);
        console.error('Failed to send status message:', error);
      }
    }

    // Clean up disconnected clients to prevent memory leaks
    for (const ws of deadConnections) {
      this.connections.delete(ws);
    }
    if (deadConnections.length > 0) this.fireConnectionsChanged();
  }

  broadcastBrowserTabUpdate(session: string, active: boolean): void {
    this.broadcast({ type: 'browser_tab_update', session, active });
  }

  broadcastBrowserFrame(session: string, frame: {
    data: string;
    meta: { offsetTop: number; pageScaleFactor: number; deviceWidth: number;
            deviceHeight: number; timestamp?: number };
  }): void {
    // `sentAt` = wall-clock at emit (latency instrumentation, 9b8adcea). On a LOCAL
    // owned-Chrome the client and server share a clock, so client-paint-time − sentAt
    // is the frame-delivery+decode latency. (CDP's meta.timestamp is a monotonic
    // capture clock, not comparable to the client's Date.now.)
    this.broadcastToChannel(`browser:${session}`, {
      type: 'browser_frame', session, data: frame.data, meta: { ...frame.meta, sentAt: Date.now() },
    });
  }

  /** Ack a client input after it was dispatched to CDP — lets the client measure
   *  input round-trip latency (mousedown → dispatch ack). Echoed to the session's
   *  browser channel with the client-supplied correlation id. */
  broadcastBrowserInputAck(session: string, inputId: number): void {
    this.broadcastToChannel(`browser:${session}`, { type: 'browser_input_ack', session, inputId });
  }

  getConnectionCount(): number {
    return this.connections.size;
  }
}
