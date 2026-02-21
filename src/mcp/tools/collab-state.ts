/**
 * Collab State Management Tools
 *
 * Provides MCP tools for managing collab session state.
 * Skills use these tools instead of direct file I/O.
 */

import { readFile, writeFile, mkdir, access, readdir, rm, cp } from 'fs/promises';
import { join } from 'path';
import { getDisplayName } from '../workflow/state-machine.js';
import type { WebSocketHandler } from '../../websocket/handler.js';
import type { TaskBatch, WorkItem, WorkItemType, SessionType } from '../workflow/types.js';

// ============= Type Definitions =============

export interface CollabState {
  state?: string; // Current state machine state ID
  sessionType?: SessionType; // Session type: 'structured' (guided) or 'vibe' (freeform)
  lastActivity: string;
  currentItem: number | null;
  currentItemType?: WorkItemType; // Type of current item for routing
  displayName?: string; // User-friendly display name for current state
  workItems?: WorkItem[]; // Work items for the session
  batches?: TaskBatch[]; // Execution batches
  currentBatch?: number; // Index of current batch
  completedTasks?: string[];
  pendingTasks?: string[];
  totalItems?: number;
  documentedItems?: number;
  autoAllowRoughDraft?: boolean; // User preference for auto-allowing rough-draft proposals
  useRenderUI?: boolean; // Whether to use browser UI for questions (default: true)
  nextSkill?: string | null; // Next skill to invoke after context clear
}

export interface StateUpdateParams {
  state?: string; // Current state machine state ID
  sessionType?: SessionType; // Session type: 'structured' (guided) or 'vibe' (freeform)
  currentItem?: number | null;
  currentItemType?: WorkItemType; // Type of current item for routing
  workItems?: WorkItem[]; // Work items for the session
  batches?: TaskBatch[]; // Execution batches
  currentBatch?: number; // Index of current batch
  completedTasks?: string[];
  pendingTasks?: string[];
  totalItems?: number;
  documentedItems?: number;
  autoAllowRoughDraft?: boolean; // User preference for auto-allowing rough-draft proposals
  useRenderUI?: boolean; // Whether to use browser UI for questions (default: true)
  nextSkill?: string | null; // Next skill to invoke after context clear
}

// ============= Helper Functions =============

function getStatePath(project: string, session: string): string {
  return join(project, '.collab', 'sessions', session, 'collab-state.json');
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
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
    lastActivity: new Date().toISOString(),
    currentItem: updates.currentItem !== undefined ? updates.currentItem : (currentState.currentItem ?? null),
    // State machine field - primary control mechanism
    ...(updates.state && { state: updates.state }),
    ...(currentState.state && !updates.state && { state: currentState.state }),
    // Session type
    ...(updates.sessionType && { sessionType: updates.sessionType }),
    ...(currentState.sessionType && !updates.sessionType && { sessionType: currentState.sessionType }),
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
    // Use browser UI for questions preference
    ...(updates.useRenderUI !== undefined && { useRenderUI: updates.useRenderUI }),
    ...(currentState.useRenderUI !== undefined && updates.useRenderUI === undefined && { useRenderUI: currentState.useRenderUI }),
    // Next skill to invoke after context clear
    ...(updates.nextSkill !== undefined && { nextSkill: updates.nextSkill }),
    ...(currentState.nextSkill !== undefined && updates.nextSkill === undefined && { nextSkill: currentState.nextSkill }),
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
        lastActivity: newState.lastActivity,
        currentItem: newState.currentItem,
        ...(newState.state && { state: newState.state }),
        ...(displayName && { displayName }),
        ...(newState.sessionType && { sessionType: newState.sessionType }),
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
    wireframes: string[];
    lessons: boolean; // Whether LESSONS.md was archived
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
  const wireframesDir = join(sessionDir, 'wireframes');

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

  const archivedFiles: { documents: string[]; diagrams: string[]; wireframes: string[]; lessons: boolean } = {
    documents: [],
    diagrams: [],
    wireframes: [],
    lessons: false,
  };

  // Copy documents (includes LESSONS.md if present)
  if (await fileExists(documentsDir)) {
    const docFiles = await readdir(documentsDir);
    for (const file of docFiles) {
      await cp(join(documentsDir, file), join(archiveDir, file));
      archivedFiles.documents.push(file);
      if (file === 'LESSONS.md') {
        archivedFiles.lessons = true;
      }
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

  // Copy wireframes
  if (await fileExists(wireframesDir)) {
    const wireframeFiles = await readdir(wireframesDir);
    for (const file of wireframeFiles) {
      await cp(join(wireframesDir, file), join(archiveDir, file));
      archivedFiles.wireframes.push(file);
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
