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
  createdSnippets?: string[]; // Snippet IDs created in this session
  updatedSnippets?: string[]; // Snippet IDs updated in this session
  deletedSnippets?: string[]; // Snippet IDs deleted in this session
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
  createdSnippets?: string[]; // Snippet IDs created in this session
  updatedSnippets?: string[]; // Snippet IDs updated in this session
  deletedSnippets?: string[]; // Snippet IDs deleted in this session
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
    // Snippet state tracking
    ...(updates.createdSnippets !== undefined && { createdSnippets: updates.createdSnippets }),
    ...(currentState.createdSnippets && updates.createdSnippets === undefined && { createdSnippets: currentState.createdSnippets }),
    ...(updates.updatedSnippets !== undefined && { updatedSnippets: updates.updatedSnippets }),
    ...(currentState.updatedSnippets && updates.updatedSnippets === undefined && { updatedSnippets: currentState.updatedSnippets }),
    ...(updates.deletedSnippets !== undefined && { deletedSnippets: updates.deletedSnippets }),
    ...(currentState.deletedSnippets && updates.deletedSnippets === undefined && { deletedSnippets: currentState.deletedSnippets }),
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
        ...(newState.createdSnippets !== undefined && { createdSnippets: newState.createdSnippets }),
        ...(newState.updatedSnippets !== undefined && { updatedSnippets: newState.updatedSnippets }),
        ...(newState.deletedSnippets !== undefined && { deletedSnippets: newState.deletedSnippets }),
      });
    } catch (error) {
      console.error('Failed to broadcast session state update:', error);
    }
  }

  return { success: true };
}

// ============= Snippet State Transition Functions =============

/**
 * Record a snippet creation in session state
 * Adds snippet ID to createdSnippets array (deduplicates)
 */
export async function recordSnippetCreated(
  project: string,
  session: string,
  snippetId: string,
  wsHandler?: WebSocketHandler
): Promise<{ success: boolean }> {
  const state = await getSessionState(project, session);
  const createdSnippets = [...(state.createdSnippets ?? [])];

  // Deduplicate: only add if not already present
  if (!createdSnippets.includes(snippetId)) {
    createdSnippets.push(snippetId);
  }

  return updateSessionState(project, session, { createdSnippets }, wsHandler);
}

/**
 * Record a snippet update in session state
 * Adds snippet ID to updatedSnippets array (deduplicates)
 */
export async function recordSnippetUpdated(
  project: string,
  session: string,
  snippetId: string,
  wsHandler?: WebSocketHandler
): Promise<{ success: boolean }> {
  const state = await getSessionState(project, session);
  const updatedSnippets = [...(state.updatedSnippets ?? [])];

  // Deduplicate: only add if not already present
  if (!updatedSnippets.includes(snippetId)) {
    updatedSnippets.push(snippetId);
  }

  return updateSessionState(project, session, { updatedSnippets }, wsHandler);
}

/**
 * Record a snippet deletion in session state
 * Adds snippet ID to deletedSnippets array (deduplicates)
 * Removes from created/updated arrays if present
 */
export async function recordSnippetDeleted(
  project: string,
  session: string,
  snippetId: string,
  wsHandler?: WebSocketHandler
): Promise<{ success: boolean }> {
  const state = await getSessionState(project, session);
  const deletedSnippets = [...(state.deletedSnippets ?? [])];
  const createdSnippets = state.createdSnippets ?? [];
  const updatedSnippets = state.updatedSnippets ?? [];

  // Add to deletedSnippets if not already present
  if (!deletedSnippets.includes(snippetId)) {
    deletedSnippets.push(snippetId);
  }

  // Remove from created/updated arrays
  const filteredCreated = createdSnippets.filter(id => id !== snippetId);
  const filteredUpdated = updatedSnippets.filter(id => id !== snippetId);

  const updates: any = {
    deletedSnippets,
  };

  // Only pass non-empty arrays, or explicitly set to empty array to clear
  if (filteredCreated.length > 0) {
    updates.createdSnippets = filteredCreated;
  } else if (createdSnippets.length > 0) {
    // We had created snippets but now they're all filtered out
    updates.createdSnippets = [];
  }

  if (filteredUpdated.length > 0) {
    updates.updatedSnippets = filteredUpdated;
  } else if (updatedSnippets.length > 0) {
    // We had updated snippets but now they're all filtered out
    updates.updatedSnippets = [];
  }

  return updateSessionState(project, session, updates, wsHandler);
}

/**
 * Get snippet state summary for a session
 * Useful for debugging and reporting
 */
export async function getSnippetStateSummary(
  project: string,
  session: string
): Promise<{
  created: number;
  updated: number;
  deleted: number;
  snippets: string[];
}> {
  const state = await getSessionState(project, session);
  const createdSnippets = state.createdSnippets ?? [];
  const updatedSnippets = state.updatedSnippets ?? [];
  const deletedSnippets = state.deletedSnippets ?? [];

  // Combine all snippet IDs (deduplicated)
  const allSnippets = Array.from(
    new Set([...createdSnippets, ...updatedSnippets, ...deletedSnippets])
  );

  return {
    created: createdSnippets.length,
    updated: updatedSnippets.length,
    deleted: deletedSnippets.length,
    snippets: allSnippets,
  };
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
    designs: string[];
    spreadsheets: string[];
    snippets: string[];
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
  const designsDir = join(sessionDir, 'designs');
  const spreadsheetsDir = join(sessionDir, 'spreadsheets');
  const snippetsDir = join(sessionDir, 'snippets');

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

  const archivedFiles: { documents: string[]; diagrams: string[]; designs: string[]; spreadsheets: string[]; snippets: string[]; lessons: boolean } = {
    documents: [],
    diagrams: [],
    designs: [],
    spreadsheets: [],
    snippets: [],
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

  // Copy designs
  if (await fileExists(designsDir)) {
    const designFiles = await readdir(designsDir);
    for (const file of designFiles) {
      await cp(join(designsDir, file), join(archiveDir, file));
      archivedFiles.designs.push(file);
    }
  }

  // Copy spreadsheets
  if (await fileExists(spreadsheetsDir)) {
    const spreadsheetFiles = await readdir(spreadsheetsDir);
    for (const file of spreadsheetFiles) {
      await cp(join(spreadsheetsDir, file), join(archiveDir, file));
      archivedFiles.spreadsheets.push(file);
    }
  }

  // Copy snippets (skip hidden dirs like .history)
  if (await fileExists(snippetsDir)) {
    const snippetFiles = await readdir(snippetsDir);
    for (const file of snippetFiles) {
      if (file.startsWith('.')) continue;
      await cp(join(snippetsDir, file), join(archiveDir, file));
      archivedFiles.snippets.push(file);
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
