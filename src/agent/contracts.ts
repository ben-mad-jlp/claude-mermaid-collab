// Phase 1 agent event contracts. Types-only; no runtime schemas.
// Later phases add permission_*, hook_event variants to the AgentEvent union.

export type AgentEventKind =
  | 'user_message'
  | 'assistant_delta'
  | 'assistant_message_complete'
  | 'turn_start'
  | 'turn_end'
  | 'session_started'
  | 'session_ended'
  | 'error'
  | 'tool_call_started'
  | 'tool_call_progress'
  | 'tool_call_completed'
  | 'sub_agent_turn'
  | 'permission_requested'
  | 'permission_resolved'
  | 'worktree_info'
  | 'assistant_thinking'
  | 'compaction'
  | 'model_changed'
  | 'session_renamed'
  | 'attachment_uploaded'
  | 'attachment_referenced'
  | 'session_cleared'
  | 'command_ack'
  | 'user_input_requested'
  | 'user_input_resolved'
  | 'checkpoint_created'
  | 'checkpoint_reverted'
  | 'settings_changed'
  | 'mcp_server_added'
  | 'mcp_server_removed'
  | 'mcp_tools_discovered'
  | 'mcp_tool_details_loaded'
  | 'mcp_elicitation_requested'
  | 'mcp_token_cost_updated';

export interface ChatMessageAttachment {
  attachmentId: string;
  mimeType: string; // image/png | image/jpeg | image/webp | image/gif
}

export type PermissionMode = 'supervised' | 'accept-edits' | 'plan' | 'bypass';
export type PermissionDecision = 'allow_once' | 'allow_session' | 'deny';

export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export type RuntimeMode = 'read-only' | 'edit' | 'bypass';
export type InteractionMode = 'ask' | 'accept-edits' | 'plan';
export type UserInputKind = 'text' | 'choice';
export type UserInputValue =
  | { kind: 'text'; text: string }
  | { kind: 'choice'; choiceId: string };

export function splitPermissionMode(m: PermissionMode): { runtime: RuntimeMode; interaction: InteractionMode } {
  switch (m) {
    case 'supervised': return { runtime: 'edit', interaction: 'ask' };
    case 'accept-edits': return { runtime: 'edit', interaction: 'accept-edits' };
    case 'plan': return { runtime: 'read-only', interaction: 'plan' };
    case 'bypass': return { runtime: 'bypass', interaction: 'accept-edits' };
  }
}

export function joinModes(r: RuntimeMode, i: InteractionMode): PermissionMode {
  if (r === 'bypass') return 'bypass';
  if (i === 'plan') return 'plan';
  if (i === 'accept-edits') return 'accept-edits';
  return 'supervised';
}

export interface BaseEvent {
  sessionId: string;
  ts: number;
}

export interface WorktreeInfo {
  sessionId: string;
  path: string;        // absolute path to worktree dir
  branch: string;      // e.g. collab/<slug>-20260417-1234
  baseBranch: string;  // HEAD branch at creation time
  createdAt: number;
}
export interface NonGitFallback {
  kind: 'non_git';
  sessionId: string;
  path: string; // projectRoot
}
export type SessionWorktree = WorktreeInfo | NonGitFallback;

export interface SessionMetadata {
  sessionId: string;
  displayName?: string;
  model?: string;
  effort?: EffortLevel;
  lastActivityTs?: number;
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheCreationTokens: number;
}

// Known Claude Code tool names; fallback to arbitrary string for forward compat.
export type KnownToolName =
  | 'Read' | 'Edit' | 'Write' | 'Bash' | 'Grep' | 'Glob'
  | 'MultiEdit' | 'NotebookEdit' | 'WebFetch' | 'WebSearch'
  | 'TodoWrite' | 'Task';
export type ToolName = KnownToolName | (string & {});

export interface UserMessageEvent extends BaseEvent {
  kind: 'user_message';
  messageId: string;
  text: string;
}

export interface TurnStartEvent extends BaseEvent {
  kind: 'turn_start';
  turnId: string;
}

export interface AssistantDeltaEvent extends BaseEvent {
  kind: 'assistant_delta';
  turnId: string;
  messageId: string;
  index: number;
  text: string;
}

export interface AssistantMessageCompleteEvent extends BaseEvent {
  kind: 'assistant_message_complete';
  turnId: string;
  messageId: string;
  text: string;
  historical?: boolean;
}

export interface TurnEndUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
}

export interface TurnEndEvent extends BaseEvent {
  kind: 'turn_end';
  turnId: string;
  usage?: TurnEndUsage;
  stopReason?: string;
  canceled?: boolean;
}

export interface SessionStartedEvent extends BaseEvent {
  kind: 'session_started';
  claudeSessionId: string;
  cwd: string;
  resumed: boolean;
}

export interface SessionEndedEvent extends BaseEvent {
  kind: 'session_ended';
  reason: 'exit' | 'error' | 'cancel';
  code?: number;
}

export interface ErrorEvent extends BaseEvent {
  kind: 'error';
  where: 'spawn' | 'stdin' | 'parse' | 'child' | 'permission';
  message: string;
  recoverable: boolean;
}

export interface ToolCallStartedEvent extends BaseEvent {
  kind: 'tool_call_started';
  turnId: string;
  messageId: string;
  toolUseId: string;
  name: ToolName;
  input: unknown;
  index: number;
  historical?: boolean;
  parentTurnId?: string;
}

export interface ToolCallProgressEvent extends BaseEvent {
  kind: 'tool_call_progress';
  toolUseId: string;
  channel: 'stdout' | 'stderr' | 'input';
  chunk: string;
  seq: number;
  parentTurnId?: string;
}

export interface ToolCallCompletedEvent extends BaseEvent {
  kind: 'tool_call_completed';
  toolUseId: string;
  status: 'ok' | 'error' | 'canceled';
  output?: unknown;
  error?: string;
  durationMs?: number;
  historical?: boolean;
  parentTurnId?: string;
}

export interface SubAgentTurnEvent extends BaseEvent {
  kind: 'sub_agent_turn';
  turnId: string;
  parentTurnId: string;
  name?: string;
}

export interface PermissionRequestedEvent extends BaseEvent {
  kind: 'permission_requested';
  promptId: string;
  toolUseId: string;
  turnId: string;
  name: ToolName;
  input: unknown;
  reason?: string;
  suggestedDecision?: 'allow' | 'deny';
  deadlineMs: number;
  historical?: boolean;
}
export interface PermissionResolvedEvent extends BaseEvent {
  kind: 'permission_resolved';
  promptId: string;
  decision: PermissionDecision | 'timeout';
  resolvedBy: 'user' | 'session_allowlist' | 'mode_auto' | 'worktree_auto' | 'timeout';
  userLabel?: string;
}

export interface WorktreeInfoEvent extends BaseEvent {
  kind: 'worktree_info';
  info: SessionWorktree; // WorktreeInfo | NonGitFallback
  dirty: boolean;
}

export interface AssistantThinkingEvent extends BaseEvent {
  kind: 'assistant_thinking';
  turnId: string;
  text: string;
  delta?: boolean;
}

export interface CompactionEvent extends BaseEvent {
  kind: 'compaction';
  tokensBefore: number;
  tokensAfter: number;
  messagesRetained: number;
}

export interface ModelChangedEvent extends BaseEvent {
  kind: 'model_changed';
  model: string;
  effort?: EffortLevel;
  seq: number;
}

export interface SessionRenamedEvent extends BaseEvent {
  kind: 'session_renamed';
  displayName: string;
  seq: number;
}

export interface AttachmentUploadedEvent extends BaseEvent {
  kind: 'attachment_uploaded';
  attachmentId: string;
  mimeType: string;
  url: string;
  sizeBytes: number;
}

export interface AttachmentReferencedEvent extends BaseEvent {
  kind: 'attachment_referenced';
  messageId: string;
  attachmentId: string;
  mimeType: string;
}

export interface SessionClearedEvent {
  kind: 'session_cleared';
  sessionId: string;
  previousClaudeSessionId?: string;
  ts: number;
}

export interface UserInputRequestedEvent extends BaseEvent {
  kind: 'user_input_requested';
  promptId: string;
  prompt: string;            // the question
  expectedKind: UserInputKind; // 'text' | 'choice'
  choices?: Array<{ id: string; label: string }>;
  deadlineMs: number;        // absolute timestamp when timeout fires
}

export interface UserInputResolvedEvent extends BaseEvent {
  kind: 'user_input_resolved';
  promptId: string;
  value: UserInputValue | { kind: 'timeout' };
}

export interface CheckpointCreatedEvent extends BaseEvent {
  kind: 'checkpoint_created';
  turnId: string;
  firstSeq: number;
  stashSha: string; // may be 'HEAD' (no changes) or 'none' (non-git)
}

export interface CheckpointRevertedEvent extends BaseEvent {
  kind: 'checkpoint_reverted';
  turnId: string;
  firstSeq: number;   // the seq we reverted to (exclusive)
  safetyStashSha?: string;
}

export interface SettingsChangedEvent extends BaseEvent {
  kind: 'settings_changed';
  key: string;
  value: unknown;
  seq: number;
}

export interface McpServerAddedEvent extends BaseEvent {
  kind: 'mcp_server_added';
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface McpServerRemovedEvent extends BaseEvent {
  kind: 'mcp_server_removed';
  name: string;
}

export interface McpToolsDiscoveredEvent extends BaseEvent {
  kind: 'mcp_tools_discovered';
  serverName: string;
  tools: Array<{ name: string; description?: string }>;
}

export interface McpToolDetailsLoadedEvent extends BaseEvent {
  kind: 'mcp_tool_details_loaded';
  serverName: string;
  toolName: string;
  inputSchema: unknown;
}

export interface McpElicitationRequestedEvent extends BaseEvent {
  kind: 'mcp_elicitation_requested';
  elicitationId: string;
  serverName: string;
  toolName: string;
  schema: unknown;
  deadlineMs: number;
}

export interface McpTokenCostUpdatedEvent extends BaseEvent {
  kind: 'mcp_token_cost_updated';
  serverName: string;
  toolName: string;
  inputTokens: number;
  outputTokens: number;
  costUsd?: number;
}

export type AgentEvent =
  | UserMessageEvent
  | TurnStartEvent
  | AssistantDeltaEvent
  | AssistantMessageCompleteEvent
  | TurnEndEvent
  | SessionStartedEvent
  | SessionEndedEvent
  | ErrorEvent
  | ToolCallStartedEvent
  | ToolCallProgressEvent
  | ToolCallCompletedEvent
  | SubAgentTurnEvent
  | PermissionRequestedEvent
  | PermissionResolvedEvent
  | WorktreeInfoEvent
  | AssistantThinkingEvent
  | CompactionEvent
  | ModelChangedEvent
  | SessionRenamedEvent
  | AttachmentUploadedEvent
  | AttachmentReferencedEvent
  | SessionClearedEvent
  | CommandAckEvent
  | UserInputRequestedEvent
  | UserInputResolvedEvent
  | CheckpointCreatedEvent
  | CheckpointRevertedEvent
  | SettingsChangedEvent
  | McpServerAddedEvent
  | McpServerRemovedEvent
  | McpToolsDiscoveredEvent
  | McpToolDetailsLoadedEvent
  | McpElicitationRequestedEvent
  | McpTokenCostUpdatedEvent;

export type CommandId = string; // ULID

export interface CommandAckEvent {
  kind: 'command_ack';
  commandId: CommandId;
  sessionId: string;
  resultSeq?: number;
  ts: number;
}

export type AgentCommandBody =
  | { kind: 'agent_start'; sessionId: string; cwd: string }
  | { kind: 'agent_send'; sessionId: string; text: string; messageId?: string; attachments?: ChatMessageAttachment[] }
  | { kind: 'agent_cancel'; sessionId: string; turnId?: string }
  | { kind: 'agent_resume'; sessionId: string; lastSeq?: number }
  | { kind: 'agent_stop'; sessionId: string }
  | { kind: 'agent_clear'; sessionId: string }
  | { kind: 'agent_delete_session'; sessionId: string }
  | { kind: 'agent_permission_resolve'; sessionId: string; promptId: string; decision: PermissionDecision }
  | { kind: 'agent_set_runtime_mode'; sessionId: string; mode: RuntimeMode }
  | { kind: 'agent_set_interaction_mode'; sessionId: string; mode: InteractionMode }
  | { kind: 'agent_user_input_respond'; sessionId: string; promptId: string; value: UserInputValue }
  | { kind: 'agent_checkpoint_revert'; sessionId: string; turnId: string }
  | { kind: 'agent_commit_push_pr'; sessionId: string; title: string; body?: string; draft?: boolean }
  | { kind: 'agent_set_model'; sessionId: string; model: string; effort?: EffortLevel }
  | { kind: 'agent_rename_session'; sessionId: string; displayName: string }
  | { kind: 'agent_rewind_to_message'; sessionId: string; messageId: string }
  | { kind: 'agent_add_allowlist_rule'; sessionId: string; toolName: string; pathGlob?: string; permanent?: boolean }
  | { kind: 'agent_update_settings_rule'; sessionId: string; key: string; value: unknown }
  | { kind: 'agent_mcp_add'; sessionId: string; name: string; command: string; args?: string[]; env?: Record<string, string> }
  | { kind: 'agent_mcp_remove'; sessionId: string; name: string }
  | { kind: 'agent_mcp_test'; sessionId: string; name: string }
  | { kind: 'agent_mcp_elicit_respond'; sessionId: string; elicitationId: string; values: Record<string, unknown> };

export type AgentCommand = AgentCommandBody & { commandId?: CommandId };

export interface AgentRewindToMessageCommand {
  kind: 'agent_rewind_to_message';
  sessionId: string;
  messageId: string;
  commandId: string;
}

export type AgentSetModelCommand = Extract<AgentCommand, { kind: 'agent_set_model' }>;
export type AgentRenameSessionCommand = Extract<AgentCommand, { kind: 'agent_rename_session' }>;

export interface ProjectionCtx {
  sessionId: string;
  currentTurnId: string | null;
  currentAssistantMessageId: string | null;
  nextDeltaIndex: number;
  historical?: boolean;
  seenToolUseIds: Set<string>;
  completedToolUseIds: Set<string>;
  toolInputDeltas: Record<string, string>;
  subAgentParentMap: Map<string, string>;
  toolUseIdByBlockIndex: Record<string, string>;
  toolProgressSeq: Record<string, number>;
  thinkingDeltas: Record<string, string>;
  turnIdByToolUseId: Record<string, string>;
  /**
   * Optional pre-minted turnId for the next top-level turn. When set, the
   * projector uses this value (instead of generating a new uuid) the next time
   * it would mint a turnId for a `turn_start`. This lets the dispatcher reuse
   * a single turnId across the checkpoint row + the projected turn so the UI
   * can match `checkpoint_created.turnId` against `turn_start.turnId`.
   *
   * Cleared by the projector once consumed.
   */
  pendingTurnId?: string | null;
}
