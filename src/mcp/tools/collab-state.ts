/**
 * Collab State Management Tools
 *
 * Provides MCP tools for managing collab session state and context snapshots.
 * Skills use these tools instead of direct file I/O.
 */

import { readFile, writeFile, mkdir, unlink, access, readdir, rm, cp } from 'fs/promises';
import { join } from 'path';
import { getDisplayName } from '../workflow/state-machine.js';
import type { WebSocketHandler } from '../../websocket/handler.js';
import type { TaskBatch, WorkItem, WorkItemType } from '../workflow/types.js';

// ============= Type Definitions =============

export interface CollabState {
  state?: string; // Current state machine state ID
  phase?: string; // Optional, derived from state via derivePhase()
  lastActivity: string;
  currentItem: number | null;
  currentItemType?: WorkItemType; // Type of current item for routing
  hasSnapshot: boolean;
  displayName?: string; // User-friendly display name for current state
  workItems?: WorkItem[]; // Work items for the session
  batches?: TaskBatch[]; // Execution batches
  currentBatch?: number; // Index of current batch
  completedTasks?: string[];
  pendingTasks?: string[];
  totalItems?: number;
  documentedItems?: number;
  autoAllowRoughDraft?: boolean; // User preference for auto-allowing rough-draft proposals
}

export interface ContextSnapshot {
  version: number;
  timestamp: string;
  activeSkill: string;
  currentStep: string;
  pendingQuestion: string | null;
  inProgressItem: number | null;
  recentContext: Array<{ type: string; content: string }>;
}

export interface StateUpdateParams {
  state?: string; // Current state machine state ID
  phase?: string;
  currentItem?: number | null;
  currentItemType?: WorkItemType; // Type of current item for routing
  hasSnapshot?: boolean;
  workItems?: WorkItem[]; // Work items for the session
  batches?: TaskBatch[]; // Execution batches
  currentBatch?: number; // Index of current batch
  completedTasks?: string[];
  pendingTasks?: string[];
  totalItems?: number;
  documentedItems?: number;
  autoAllowRoughDraft?: boolean; // User preference for auto-allowing rough-draft proposals
}

// ============= Helper Functions =============

function getStatePath(project: string, session: string): string {
  return join(project, '.collab', 'sessions', session, 'collab-state.json');
}

function getSnapshotPath(project: string, session: string): string {
  return join(project, '.collab', 'sessions', session, 'context-snapshot.json');
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Derive phase from state for backwards compatibility.
 * Extracts the base phase from the state identifier.
 * @param state - The state identifier
 * @returns The derived phase name
 */
export function derivePhase(state: string): string {
  if (state.startsWith('brainstorm')) {
    return 'brainstorming';
  }
  if (state.startsWith('rough-draft')) {
    return 'rough-draft';
  }
  if (state.startsWith('clear')) {
    return 'transition';
  }
  if (state === 'ready-to-implement') {
    return 'ready';
  }
  if (state === 'execute-batch') {
    return 'executing';
  }
  // Return state as-is as fallback
  return state;
}

// ============= State Management Functions =============

export async function getSessionState(project: string, session: string): Promise<CollabState> {
  const path = getStatePath(project, session);

  if (!(await fileExists(path))) {
    throw new Error(`Session not found: ${session}`);
  }

  const content = await readFile(path, 'utf-8');
  const rawState = JSON.parse(content) as CollabState;

  // Compute display name from state if available
  if (rawState.state) {
    rawState.displayName = getDisplayName(rawState.state);
  }

  // Derive phase from state for backwards compatibility if not already set
  if (rawState.state && !rawState.phase) {
    rawState.phase = derivePhase(rawState.state);
  }

  return rawState;
}

export async function updateSessionState(
  project: string,
  session: string,
  updates: StateUpdateParams,
  wsHandler?: WebSocketHandler
): Promise<{ success: boolean }> {
  const path = getStatePath(project, session);

  // Read current state or create empty
  let currentState: Partial<CollabState> = {};
  if (await fileExists(path)) {
    const content = await readFile(path, 'utf-8');
    currentState = JSON.parse(content);
  }

  // Merge updates
  const newState: CollabState = {
    // Only include phase if explicitly set or exists in current state (for backwards compat)
    // New sessions should use state instead, with phase derived via derivePhase()
    ...(updates.phase && { phase: updates.phase }),
    ...(currentState.phase && !updates.phase && { phase: currentState.phase }),
    lastActivity: new Date().toISOString(),
    currentItem: updates.currentItem !== undefined ? updates.currentItem : (currentState.currentItem ?? null),
    hasSnapshot: updates.hasSnapshot ?? currentState.hasSnapshot ?? false,
    // State machine field - primary control mechanism
    ...(updates.state && { state: updates.state }),
    ...(currentState.state && !updates.state && { state: currentState.state }),
    // Work items
    ...(updates.workItems && { workItems: updates.workItems }),
    ...(currentState.workItems && !updates.workItems && { workItems: currentState.workItems }),
    ...(updates.currentItemType && { currentItemType: updates.currentItemType }),
    ...(currentState.currentItemType && !updates.currentItemType && { currentItemType: currentState.currentItemType }),
    // Batches
    ...(updates.batches && { batches: updates.batches }),
    ...(currentState.batches && !updates.batches && { batches: currentState.batches }),
    ...(updates.currentBatch !== undefined && { currentBatch: updates.currentBatch }),
    ...(currentState.currentBatch !== undefined && updates.currentBatch === undefined && { currentBatch: currentState.currentBatch }),
    // Existing fields
    ...(updates.completedTasks && { completedTasks: updates.completedTasks }),
    ...(updates.pendingTasks && { pendingTasks: updates.pendingTasks }),
    ...(currentState.completedTasks && !updates.completedTasks && { completedTasks: currentState.completedTasks }),
    ...(currentState.pendingTasks && !updates.pendingTasks && { pendingTasks: currentState.pendingTasks }),
    ...(updates.totalItems !== undefined && { totalItems: updates.totalItems }),
    ...(updates.documentedItems !== undefined && { documentedItems: updates.documentedItems }),
    ...(currentState.totalItems !== undefined && updates.totalItems === undefined && { totalItems: currentState.totalItems }),
    ...(currentState.documentedItems !== undefined && updates.documentedItems === undefined && { documentedItems: currentState.documentedItems }),
    // Auto-allow rough-draft preference
    ...(updates.autoAllowRoughDraft !== undefined && { autoAllowRoughDraft: updates.autoAllowRoughDraft }),
    ...(currentState.autoAllowRoughDraft !== undefined && updates.autoAllowRoughDraft === undefined && { autoAllowRoughDraft: currentState.autoAllowRoughDraft }),
  };

  // Ensure directory exists
  const dir = join(project, '.collab', 'sessions', session);
  await mkdir(dir, { recursive: true });

  await writeFile(path, JSON.stringify(newState, null, 2));

  // Broadcast session state update via WebSocket if handler is provided
  if (wsHandler) {
    try {
      // Compute displayName for broadcast
      const displayName = newState.state ? getDisplayName(newState.state) : undefined;

      wsHandler.broadcast({
        type: 'session_state_updated',
        phase: newState.phase,
        lastActivity: newState.lastActivity,
        currentItem: newState.currentItem,
        hasSnapshot: newState.hasSnapshot,
        ...(newState.state && { state: newState.state }),
        ...(displayName && { displayName }),
        ...(newState.workItems && { workItems: newState.workItems }),
        ...(newState.currentItemType && { currentItemType: newState.currentItemType }),
        ...(newState.batches && { batches: newState.batches }),
        ...(newState.currentBatch !== undefined && { currentBatch: newState.currentBatch }),
        ...(newState.completedTasks && { completedTasks: newState.completedTasks }),
        ...(newState.pendingTasks && { pendingTasks: newState.pendingTasks }),
        ...(newState.totalItems !== undefined && { totalItems: newState.totalItems }),
        ...(newState.documentedItems !== undefined && { documentedItems: newState.documentedItems }),
      });
    } catch (error) {
      console.error('Failed to broadcast session state update:', error);
    }
  }

  return { success: true };
}

// ============= Snapshot Management Functions =============

export async function hasSnapshot(project: string, session: string): Promise<boolean> {
  const path = getSnapshotPath(project, session);
  return fileExists(path);
}

export async function saveSnapshot(
  project: string,
  session: string,
  activeSkill: string,
  currentStep: string,
  inProgressItem: number | null,
  pendingQuestion?: string | null,
  recentContext?: Array<{ type: string; content: string }>
): Promise<{ success: boolean }> {
  const path = getSnapshotPath(project, session);

  const snapshot: ContextSnapshot = {
    version: 1,
    timestamp: new Date().toISOString(),
    activeSkill,
    currentStep,
    pendingQuestion: pendingQuestion ?? null,
    inProgressItem,
    recentContext: recentContext ?? [],
  };

  // Ensure directory exists
  const dir = join(project, '.collab', 'sessions', session);
  await mkdir(dir, { recursive: true });

  await writeFile(path, JSON.stringify(snapshot, null, 2));

  // Also update hasSnapshot in state
  await updateSessionState(project, session, { hasSnapshot: true });

  return { success: true };
}

export async function loadSnapshot(project: string, session: string): Promise<ContextSnapshot | null> {
  const path = getSnapshotPath(project, session);

  if (!(await fileExists(path))) {
    return null;
  }

  const content = await readFile(path, 'utf-8');
  return JSON.parse(content) as ContextSnapshot;
}

export async function deleteSnapshot(project: string, session: string): Promise<{ success: boolean }> {
  const path = getSnapshotPath(project, session);

  try {
    await unlink(path);
  } catch (error: any) {
    // Idempotent - ignore if file doesn't exist
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }

  // Also update hasSnapshot in state
  try {
    await updateSessionState(project, session, { hasSnapshot: false });
  } catch {
    // State file might not exist, that's ok
  }

  return { success: true };
}

// ============= Archive Session Functions =============

export interface ArchiveOptions {
  deleteSession?: boolean; // Whether to delete the session after archiving (default: true)
  timestamp?: boolean;     // Whether to add timestamp to archive folder name (default: false)
}

export interface ArchiveResult {
  success: boolean;
  archivePath: string;
  archivedFiles: {
    documents: string[];
    diagrams: string[];
  };
}

export async function archiveSession(
  project: string,
  session: string,
  options: ArchiveOptions = {}
): Promise<ArchiveResult> {
  const { deleteSession = true, timestamp = false } = options;

  const sessionDir = join(project, '.collab', 'sessions', session);
  const documentsDir = join(sessionDir, 'documents');
  const diagramsDir = join(sessionDir, 'diagrams');

  // Build archive folder name with optional timestamp
  let archiveFolderName = session;
  if (timestamp) {
    const now = new Date();
    const ts = now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    archiveFolderName = `${session}-${ts}`;
  }
  const archiveDir = join(project, 'docs', 'designs', archiveFolderName);

  // Check if session exists
  if (!(await fileExists(sessionDir))) {
    throw new Error(`Session not found: ${session}`);
  }

  // Check if archive already exists
  if (await fileExists(archiveDir)) {
    throw new Error(`Archive already exists: ${archiveDir}`);
  }

  // Create archive directory
  await mkdir(archiveDir, { recursive: true });

  const archivedFiles: { documents: string[]; diagrams: string[] } = {
    documents: [],
    diagrams: [],
  };

  // Copy documents
  if (await fileExists(documentsDir)) {
    const docFiles = await readdir(documentsDir);
    for (const file of docFiles) {
      await cp(join(documentsDir, file), join(archiveDir, file));
      archivedFiles.documents.push(file);
    }
  }

  // Copy diagrams
  if (await fileExists(diagramsDir)) {
    const diagramFiles = await readdir(diagramsDir);
    for (const file of diagramFiles) {
      await cp(join(diagramsDir, file), join(archiveDir, file));
      archivedFiles.diagrams.push(file);
    }
  }

  // Delete session directory if requested
  if (deleteSession) {
    await rm(sessionDir, { recursive: true, force: true });
  }

  return {
    success: true,
    archivePath: archiveDir,
    archivedFiles,
  };
}
