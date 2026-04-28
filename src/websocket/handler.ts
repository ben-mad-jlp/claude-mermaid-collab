import type { ServerWebSocket } from 'bun';
import type { AgentCommand, AgentEvent, EffortLevel } from '../agent/contracts.ts';

type AgentDispatcherLike = { handle(ws: ServerWebSocket<{ subscriptions: Set<string> }>, cmd: AgentCommand): Promise<void> };

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
  | { type: 'subscribe'; id?: string; channel?: string }
  | { type: 'unsubscribe'; id?: string; channel?: string }
  | { type: 'question_responded'; questionId: string; response: string; project: string; session: string }
  | { type: 'ui_render'; uiId: string; project: string; session: string; ui: any; blocking: boolean; timestamp: number }
  | { type: 'ui_dismissed'; project: string; session: string }
  | { type: 'ui_updated'; patch: Record<string, unknown>; project: string; session: string }
  | { type: 'session_created'; project: string; session: string }
  | { type: 'session_deleted'; project: string; session: string }
  | { type: 'session_todos_updated'; project: string; session: string }
  | { type: 'claude_session_registered'; project: string; session: string; claudePid?: string | number; claudeSessionId?: string; [k: string]: unknown }
  | { type: 'claude_session_status'; project: string; session: string; status: string; [k: string]: unknown }
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
  | { type: 'ide_connected'; vscodeVersion: string; extensionVersion: string }
  | { type: 'ide_disconnected'; reason?: string };

export class WebSocketHandler {
  private connections: Set<ServerWebSocket<{ subscriptions: Set<string> }>> = new Set();
  private agentDispatcher: AgentDispatcherLike | null = null;

  setAgentDispatcher(dispatcher: AgentDispatcherLike): void {
    this.agentDispatcher = dispatcher;
  }

  handleConnection(ws: ServerWebSocket<{ subscriptions: Set<string> }>): void {
    ws.data.subscriptions = new Set();
    this.connections.add(ws);
  }

  handleDisconnection(ws: ServerWebSocket<{ subscriptions: Set<string> }>): void {
    this.connections.delete(ws);
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
        }
      } else if (data.type === 'unsubscribe') {
        if (data.id) {
          ws.data.subscriptions.delete(data.id);
        } else if (data.channel) {
          ws.data.subscriptions.delete(`channel:${data.channel}`);
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
  }

  getConnectionCount(): number {
    return this.connections.size;
  }
}
