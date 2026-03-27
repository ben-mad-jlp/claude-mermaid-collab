/**
 * Data Loader Integration Examples
 *
 * This file demonstrates how to integrate the data loader into your
 * React components and hooks. It shows practical examples of:
 *
 * - Loading session artifacts when navigating to a session
 * - Listening to loading progress for UI feedback
 * - Error handling and retry logic
 * - Performance optimizations for parallel loading
 *
 * Note: This is an example file and should be used as reference when
 * integrating data loading into components.
 */

import { useEffect, useState } from 'react';
import { loadAllArtifacts, onLoadingProgress, type LoadingProgress } from './data-loader';
import { useSessionStore } from '../stores/sessionStore';

/**
 * Example 1: Hook for loading session artifacts on mount
 *
 * This hook automatically loads all artifacts for a session
 * and manages loading states.
 */
export function useLoadSessionArtifacts(project: string | null, session: string | null) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalArtifacts, setTotalArtifacts] = useState(0);
  const [loadedCount, setLoadedCount] = useState(0);

  useEffect(() => {
    if (!project || !session) return;

    const loadArtifacts = async () => {
      setIsLoading(true);
      setError(null);
      setLoadedCount(0);

      try {
        const result = await loadAllArtifacts(project, session);
        setTotalArtifacts(result.totalArtifacts);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load artifacts';
        setError(message);
      } finally {
        setIsLoading(false);
      }
    };

    loadArtifacts();

    // Listen to progress events for real-time feedback
    const cleanup = onLoadingProgress((progress) => {
      if (progress.type === 'artifact_loaded') {
        setLoadedCount((prev) => prev + (progress.loaded ?? 0));
      } else if (progress.type === 'error') {
        setError(progress.error || 'Unknown error occurred');
      }
    });

    return cleanup;
  }, [project, session]);

  return { isLoading, error, totalArtifacts, loadedCount };
}

/**
 * Example 2: Hook for showing loading progress
 *
 * This hook provides loading progress data for UI feedback components.
 */
export function useLoadingProgress() {
  const [progress, setProgress] = useState<LoadingProgress | null>(null);
  const [loaded, setLoaded] = useState(0);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    const cleanup = onLoadingProgress((p) => {
      setProgress(p);

      if (p.type === 'start') {
        setLoaded(0);
        setTotal(0);
      } else if (p.type === 'artifact_loaded' && p.loaded !== undefined) {
        setLoaded((prev) => prev + (p.loaded ?? 0));
        setTotal((prev) => prev + (p.total ?? 0));
      } else if (p.type === 'complete') {
        setLoaded(p.loaded ?? 0);
        setTotal(p.total ?? 0);
      }
    });

    return cleanup;
  }, []);

  return { progress, loaded, total };
}

/**
 * Example 3: Hook that syncs loading state with store
 *
 * This effect can be used in a layout component to show a global
 * loading indicator while artifacts are being loaded.
 */
export function useLoadingStateEffect() {
  const setLoading = useSessionStore((state) => state.setLoading);

  useEffect(() => {
    const cleanup = onLoadingProgress((progress) => {
      if (progress.type === 'start') {
        setLoading(true);
      } else if (progress.type === 'complete' || progress.type === 'error') {
        setLoading(false);
      }
    });

    return cleanup;
  }, [setLoading]);
}

/**
 * Example 4: Hook for listening to specific artifact type loading
 *
 * This hook allows listening to progress updates for specific artifact types.
 */
export function useArtifactTypeProgress(artifactType: string) {
  const [isLoading, setIsLoading] = useState(false);
  const [count, setCount] = useState(0);

  useEffect(() => {
    const cleanup = onLoadingProgress((progress) => {
      if (progress.artifactType === artifactType) {
        if (progress.type === 'artifact_loaded') {
          setIsLoading(false);
          setCount(progress.loaded ?? 0);
        } else if (progress.type === 'error') {
          setIsLoading(false);
        }
      } else if (progress.type === 'start') {
        setIsLoading(true);
        setCount(0);
      }
    });

    return cleanup;
  }, [artifactType]);

  return { isLoading, count };
}

/**
 * Example 5: Manual artifact loading with error recovery
 *
 * Shows how to manually trigger artifact loading with custom error handling.
 */
export async function handleSessionChange(project: string, session: string) {
  try {
    const result = await loadAllArtifacts(project, session);
    console.log(`Loaded ${result.totalArtifacts} artifacts`);

    // Check if any artifact type failed to load
    if (result.diagrams.length === 0) {
      console.warn('No diagrams found in session');
    }
    if (result.documents.length === 0) {
      console.warn('No documents found in session');
    }

    return result;
  } catch (error) {
    console.error('Failed to load artifacts:', error);
    throw error;
  }
}

/**
 * Example 6: Direct event listener usage
 *
 * Shows how to listen to loading events without React hooks.
 */
export function setupLoadingListener() {
  const cleanup = onLoadingProgress((progress) => {
    switch (progress.type) {
      case 'start':
        console.log('Starting artifact load');
        break;
      case 'artifact_loaded':
        console.log(`Loaded ${progress.loaded} ${progress.artifactType}`);
        break;
      case 'complete':
        console.log('All artifacts loaded');
        break;
      case 'error':
        console.error('Loading error:', progress.error);
        break;
    }
  });

  return cleanup;
}

/**
 * Example 7: Selective artifact loading
 *
 * Shows how to load only specific artifact types.
 */
import {
  loadDiagrams,
  loadDocuments,
  loadDesigns,
  loadSpreadsheets,
  loadSnippets,
} from './data-loader';

export async function loadOnlyDiagrams(project: string, session: string) {
  try {
    const diagrams = await loadDiagrams(project, session);
    console.log('Loaded diagrams:', diagrams);
    return diagrams;
  } catch (error) {
    console.error('Failed to load diagrams:', error);
    return [];
  }
}

export async function loadOnlyDocuments(project: string, session: string) {
  try {
    const documents = await loadDocuments(project, session);
    console.log('Loaded documents:', documents);
    return documents;
  } catch (error) {
    console.error('Failed to load documents:', error);
    return [];
  }
}
