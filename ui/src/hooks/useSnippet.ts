/**
 * useSnippet Hook
 *
 * Provides React integration for snippet operations with:
 * - Access to snippets in current session
 * - Snippet selection management
 * - Snippet CRUD operations
 * - Selected snippet convenience getter
 */

import { useCallback } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Snippet } from '../types';
import { useSessionStore } from '../stores/sessionStore';
import { api } from '../lib/api';

export interface UseSnippetReturn {
  // Snippet state
  snippets: Snippet[];
  selectedSnippetId: string | null;
  selectedSnippet: Snippet | undefined;

  // Snippet operations
  addSnippet: (snippet: Snippet) => void;
  updateSnippet: (id: string, content: string) => Promise<void>;
  removeSnippet: (id: string) => void;
  selectSnippet: (id: string | null) => void;

  // Bulk operations
  setSnippets: (snippets: Snippet[]) => void;

  // Utility
  getSnippetById: (id: string) => Snippet | undefined;
  hasSnippet: (id: string) => boolean;
}

/**
 * Hook for accessing and managing snippets in the current session
 *
 * Provides convenient access to snippet state and operations from the session store
 *
 * @returns Snippet state and operation methods
 */
export function useSnippet(): UseSnippetReturn {
  const { snippets, selectedSnippetId, selectSnippet, addSnippet, removeSnippet, updateSnippet: storeUpdateSnippet, setSnippets, currentSession } = useSessionStore(
    useShallow((state) => ({
      snippets: state.snippets,
      selectedSnippetId: state.selectedSnippetId,
      selectSnippet: state.selectSnippet,
      addSnippet: state.addSnippet,
      removeSnippet: state.removeSnippet,
      updateSnippet: state.updateSnippet,
      setSnippets: state.setSnippets,
      currentSession: state.currentSession,
    }))
  );

  const selectedSnippet = snippets.find((s) => s.id === selectedSnippetId);

  const getSnippetById = useCallback(
    (id: string) => {
      return snippets.find((s) => s.id === id);
    },
    [snippets]
  );

  const hasSnippet = useCallback(
    (id: string) => {
      return snippets.some((s) => s.id === id);
    },
    [snippets]
  );

  const updateSnippet = useCallback(
    async (id: string, content: string) => {
      if (!currentSession) return;

      try {
        await api.updateSnippet(currentSession.project, currentSession.name, id, content);
        storeUpdateSnippet(id, { content, lastModified: Date.now() });
      } catch (error) {
        console.error('Failed to update snippet:', error);
        throw error;
      }
    },
    [currentSession, storeUpdateSnippet]
  );

  return {
    snippets,
    selectedSnippetId,
    selectedSnippet,
    addSnippet,
    updateSnippet,
    removeSnippet,
    selectSnippet,
    setSnippets,
    getSnippetById,
    hasSnippet,
  };
}
