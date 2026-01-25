import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import type { TerminalSession, CreateSessionResult } from '../types/terminal';

export interface UseTerminalTabsOptions {
  project: string;
  session: string;
}

export interface UseTerminalTabsReturn {
  tabs: TerminalSession[];
  activeTabId: string | null;
  activeTab: TerminalSession | null;
  isLoading: boolean;
  error: Error | null;
  addTab: () => Promise<void>;
  removeTab: (id: string) => Promise<void>;
  renameTab: (id: string, name: string) => Promise<void>;
  setActiveTab: (id: string) => void;
  reorderTabs: (fromIndex: number, toIndex: number) => Promise<void>;
  refresh: () => Promise<void>;
}

// Helper to generate localStorage key for active tab persistence
const getStorageKey = (project: string, session: string) =>
  `terminal-active-tab:${project}:${session}`;

export function useTerminalTabs({ project, session }: UseTerminalTabsOptions): UseTerminalTabsReturn {
  const [tabs, setTabs] = useState<TerminalSession[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Fetch sessions from API
  const refresh = useCallback(async () => {
    // Skip API call if project or session is empty
    if (!project || !session) {
      setTabs([]);
      setActiveTabId(null);
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);
      const sessions = await api.getTerminalSessions(project, session);
      setTabs(sessions);
      // Restore active tab from localStorage, or default to first session
      const savedTabId = localStorage.getItem(getStorageKey(project, session));
      if (savedTabId && sessions.some(s => s.id === savedTabId)) {
        setActiveTabId(savedTabId);
      } else if (sessions.length > 0) {
        setActiveTabId(sessions[0].id);
      } else {
        setActiveTabId(null);
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      setTabs([]);
      setActiveTabId(null);
    } finally {
      setIsLoading(false);
    }
  }, [project, session]);

  // Load on mount and when project/session changes
  useEffect(() => {
    refresh();
  }, [refresh]);

  const addTab = useCallback(async () => {
    try {
      const result = await api.createTerminalSession(project, session);
      // Refresh to get the updated list
      await refresh();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      throw error;
    }
  }, [project, session, refresh]);

  const removeTab = useCallback(async (id: string) => {
    try {
      await api.deleteTerminalSession(project, session, id);
      // Refresh to get the updated list
      await refresh();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      throw error;
    }
  }, [project, session, refresh]);

  const renameTab = useCallback(async (id: string, name: string) => {
    try {
      await api.renameTerminalSession(project, session, id, name);
      // Refresh to get the updated list
      await refresh();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      throw error;
    }
  }, [project, session, refresh]);

  const reorderTabs = useCallback(async (fromIndex: number, toIndex: number) => {
    // Validate indices
    if (
      fromIndex < 0 ||
      fromIndex >= tabs.length ||
      toIndex < 0 ||
      toIndex >= tabs.length ||
      fromIndex === toIndex
    ) {
      throw new Error('Invalid reorder indices');
    }

    // Perform optimistic update
    const originalTabs = tabs;
    const newTabs = [...tabs];
    const [removed] = newTabs.splice(fromIndex, 1);
    newTabs.splice(toIndex, 0, removed);
    setTabs(newTabs);

    try {
      // Create ordered IDs array for API call
      const orderedIds = newTabs.map(t => t.id);
      await api.reorderTerminalSessions(project, session, orderedIds);
    } catch (err) {
      // Revert optimistic update on error
      setTabs(originalTabs);
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      throw error;
    }
  }, [tabs, project, session]);

  const handleSetActiveTab = useCallback((id: string) => {
    // Verify tab exists before setting
    if (tabs.some(t => t.id === id)) {
      setActiveTabId(id);
      // Persist active tab selection to localStorage
      localStorage.setItem(getStorageKey(project, session), id);
    }
  }, [tabs, project, session]);

  const activeTab = tabs.find(t => t.id === activeTabId) || null;

  return {
    tabs,
    activeTabId,
    activeTab,
    isLoading,
    error,
    addTab,
    removeTab,
    renameTab,
    setActiveTab: handleSetActiveTab,
    reorderTabs,
    refresh,
  };
}
