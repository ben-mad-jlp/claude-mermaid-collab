/**
 * Data Loader - Initialize session artifacts on session load
 *
 * This module provides a comprehensive data loading system for initializing
 * all artifact types (diagrams, documents, designs, spreadsheets, snippets) when
 * a session is loaded. It includes:
 *
 * - Parallel loading of artifact types for performance
 * - Error handling and retry logic for resilient loading
 * - Progress tracking and event emission for UI feedback
 * - Integration with sessionStore for state management
 * - Graceful degradation if individual artifact loads fail
 */

import { api } from './api';
import { useSessionStore } from '../stores/sessionStore';
import type { Diagram, Document } from '../types';
import type { Design, Spreadsheet } from '../stores/sessionStore';
import type { Snippet } from '../types';

/**
 * Loading progress event detail
 */
export interface LoadingProgress {
  type: 'start' | 'artifact_loaded' | 'complete' | 'error';
  artifactType?: 'diagrams' | 'documents' | 'designs' | 'spreadsheets' | 'snippets';
  loaded?: number;
  total?: number;
  error?: string;
}

/**
 * Custom event for tracking loading progress
 */
export const LOADING_PROGRESS_EVENT = 'artifact-loading-progress';

/**
 * Dispatch a loading progress event to window
 */
export function dispatchLoadingProgress(progress: LoadingProgress): void {
  const event = new CustomEvent(LOADING_PROGRESS_EVENT, { detail: progress });
  window.dispatchEvent(event);
}

/**
 * Retry configuration for failed loads
 */
interface RetryConfig {
  maxRetries: number;
  delayMs: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 2,
  delayMs: 500,
};

/**
 * Retry a promise-returning function with exponential backoff
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < config.maxRetries) {
        const delayMs = config.delayMs * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  throw lastError;
}

/**
 * Load diagrams for a session
 */
export async function loadDiagrams(
  project: string,
  session: string
): Promise<Diagram[]> {
  try {
    const diagrams = await retryWithBackoff(() =>
      api.getDiagrams(project, session)
    );
    useSessionStore.getState().setDiagrams(diagrams);
    dispatchLoadingProgress({
      type: 'artifact_loaded',
      artifactType: 'diagrams',
      loaded: diagrams.length,
      total: diagrams.length,
    });
    return diagrams;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('Failed to load diagrams:', errorMsg);
    dispatchLoadingProgress({
      type: 'error',
      artifactType: 'diagrams',
      error: errorMsg,
    });
    // Set empty array in store and return empty array
    useSessionStore.getState().setDiagrams([]);
    return [];
  }
}

/**
 * Load documents for a session
 */
export async function loadDocuments(
  project: string,
  session: string
): Promise<Document[]> {
  try {
    const documents = await retryWithBackoff(() =>
      api.getDocuments(project, session)
    );
    useSessionStore.getState().setDocuments(documents);
    dispatchLoadingProgress({
      type: 'artifact_loaded',
      artifactType: 'documents',
      loaded: documents.length,
      total: documents.length,
    });
    return documents;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('Failed to load documents:', errorMsg);
    dispatchLoadingProgress({
      type: 'error',
      artifactType: 'documents',
      error: errorMsg,
    });
    useSessionStore.getState().setDocuments([]);
    return [];
  }
}

/**
 * Load designs for a session
 */
export async function loadDesigns(
  project: string,
  session: string
): Promise<Design[]> {
  try {
    const designs = await retryWithBackoff(() =>
      api.getDesigns(project, session)
    );
    useSessionStore.getState().setDesigns(designs);
    dispatchLoadingProgress({
      type: 'artifact_loaded',
      artifactType: 'designs',
      loaded: designs.length,
      total: designs.length,
    });
    return designs;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('Failed to load designs:', errorMsg);
    dispatchLoadingProgress({
      type: 'error',
      artifactType: 'designs',
      error: errorMsg,
    });
    useSessionStore.getState().setDesigns([]);
    return [];
  }
}

/**
 * Load spreadsheets for a session
 */
export async function loadSpreadsheets(
  project: string,
  session: string
): Promise<Spreadsheet[]> {
  try {
    const spreadsheets = await retryWithBackoff(() =>
      api.getSpreadsheets(project, session)
    );
    useSessionStore.getState().setSpreadsheets(spreadsheets);
    dispatchLoadingProgress({
      type: 'artifact_loaded',
      artifactType: 'spreadsheets',
      loaded: spreadsheets.length,
      total: spreadsheets.length,
    });
    return spreadsheets;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('Failed to load spreadsheets:', errorMsg);
    dispatchLoadingProgress({
      type: 'error',
      artifactType: 'spreadsheets',
      error: errorMsg,
    });
    useSessionStore.getState().setSpreadsheets([]);
    return [];
  }
}

/**
 * Load snippets for a session
 */
export async function loadSnippets(
  project: string,
  session: string
): Promise<Snippet[]> {
  try {
    const snippets = await retryWithBackoff(() =>
      api.getSnippets(project, session)
    );
    useSessionStore.getState().setSnippets(snippets);
    dispatchLoadingProgress({
      type: 'artifact_loaded',
      artifactType: 'snippets',
      loaded: snippets.length,
      total: snippets.length,
    });
    return snippets;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('Failed to load snippets:', errorMsg);
    dispatchLoadingProgress({
      type: 'error',
      artifactType: 'snippets',
      error: errorMsg,
    });
    useSessionStore.getState().setSnippets([]);
    return [];
  }
}

/**
 * Load all artifacts for a session in parallel
 *
 * This function loads diagrams, documents, designs, spreadsheets, and snippets
 * in parallel for maximum performance. If any individual load fails, it logs
 * the error and continues loading other artifacts.
 *
 * @param project - The project path
 * @param session - The session name
 * @returns A summary of loaded artifacts
 *
 * @example
 * ```typescript
 * const result = await loadAllArtifacts('/path/to/project', 'session-name');
 * console.log(`Loaded ${result.totalArtifacts} artifacts`);
 * ```
 */
export async function loadAllArtifacts(
  project: string,
  session: string
): Promise<{
  totalArtifacts: number;
  diagrams: Diagram[];
  documents: Document[];
  designs: Design[];
  spreadsheets: Spreadsheet[];
  snippets: Snippet[];
}> {
  // Dispatch loading start event
  dispatchLoadingProgress({
    type: 'start',
  });

  try {
    // Load all artifact types in parallel for performance
    const [diagrams, documents, designs, spreadsheets, snippets] = await Promise.all([
      loadDiagrams(project, session),
      loadDocuments(project, session),
      loadDesigns(project, session),
      loadSpreadsheets(project, session),
      loadSnippets(project, session),
    ]);

    const totalArtifacts =
      diagrams.length +
      documents.length +
      designs.length +
      spreadsheets.length +
      snippets.length;

    // Dispatch complete event
    dispatchLoadingProgress({
      type: 'complete',
      loaded: totalArtifacts,
      total: totalArtifacts,
    });

    return {
      totalArtifacts,
      diagrams,
      documents,
      designs,
      spreadsheets,
      snippets,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('Critical error during artifact loading:', errorMsg);
    dispatchLoadingProgress({
      type: 'error',
      error: `Failed to complete artifact loading: ${errorMsg}`,
    });

    // Return whatever was successfully loaded
    const store = useSessionStore.getState();
    return {
      totalArtifacts:
        store.diagrams.length +
        store.documents.length +
        store.designs.length +
        store.spreadsheets.length +
        store.snippets.length,
      diagrams: store.diagrams,
      documents: store.documents,
      designs: store.designs,
      spreadsheets: store.spreadsheets,
      snippets: store.snippets,
    };
  }
}

/**
 * Hook for listening to loading progress events
 *
 * @param callback - Function to call when loading progress changes
 * @returns Cleanup function to remove listener
 *
 * @example
 * ```typescript
 * useEffect(() => {
 *   const cleanup = onLoadingProgress((progress) => {
 *     if (progress.type === 'complete') {
 *       console.log('All artifacts loaded');
 *     }
 *   });
 *   return cleanup;
 * }, []);
 * ```
 */
export function onLoadingProgress(
  callback: (progress: LoadingProgress) => void
): () => void {
  const handler = (event: Event) => {
    if (event instanceof CustomEvent) {
      callback(event.detail as LoadingProgress);
    }
  };

  window.addEventListener(LOADING_PROGRESS_EVENT, handler);

  return () => {
    window.removeEventListener(LOADING_PROGRESS_EVENT, handler);
  };
}
