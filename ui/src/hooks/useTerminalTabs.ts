import { useState, useEffect, useCallback } from 'react';
import type { TerminalTab, TerminalTabsState } from '../types/terminal';

export interface UseTerminalTabsOptions {
  storageKey?: string;
  defaultPort?: number;
}

export interface UseTerminalTabsReturn {
  tabs: TerminalTab[];
  activeTabId: string | null;
  activeTab: TerminalTab | null;
  addTab: () => void;
  removeTab: (id: string) => void;
  renameTab: (id: string, name: string) => void;
  setActiveTab: (id: string) => void;
  reorderTabs: (fromIndex: number, toIndex: number) => void;
}

const DEFAULT_STORAGE_KEY = 'terminal-tabs';
const DEFAULT_PORT = 7681;

/**
 * Generate a unique tab ID using crypto.randomUUID if available,
 * otherwise fall back to timestamp-based ID
 */
function generateTabId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

/**
 * Initialize state from localStorage, with fallback to default state
 */
function initializeState(
  storageKey: string,
  defaultPort: number
): TerminalTabsState {
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      const data = JSON.parse(stored) as TerminalTabsState;
      // Validate that we have tabs and activeTabId
      if (data.tabs && Array.isArray(data.tabs) && data.activeTabId) {
        return data;
      }
    }
  } catch (error) {
    // If parsing fails, fall through to default
    console.warn(`Failed to parse localStorage for key "${storageKey}":`, error);
  }

  // Create default state with one tab
  const defaultTab: TerminalTab = {
    id: generateTabId(),
    name: 'Terminal 1',
    wsUrl: `ws://localhost:${defaultPort}/ws`,
  };

  return {
    tabs: [defaultTab],
    activeTabId: defaultTab.id,
  };
}

export function useTerminalTabs(options: UseTerminalTabsOptions = {}): UseTerminalTabsReturn {
  const { storageKey = DEFAULT_STORAGE_KEY, defaultPort = DEFAULT_PORT } = options;

  // Initialize both tabs and activeTabId from the same state
  const [{ tabs, activeTabId }, setTabsState] = useState<TerminalTabsState>(() => {
    return initializeState(storageKey, defaultPort);
  });


  // Sync to localStorage on state change
  useEffect(() => {
    const state: TerminalTabsState = {
      tabs,
      activeTabId,
    };
    localStorage.setItem(storageKey, JSON.stringify(state));
  }, [tabs, activeTabId, storageKey]);

  // Note: Storage events don't fire in the same tab, so we only listen for cross-tab updates
  // For same-tab updates, localStorage.setItem handles it through this hook's state

  const addTab = useCallback(() => {
    // All tabs connect to the same ttyd instance on the default port
    // Each WebSocket connection creates a new PTY session
    setTabsState(prevState => {
      const { tabs: prevTabs } = prevState;
      const newTab: TerminalTab = {
        id: generateTabId(),
        name: `Terminal ${prevTabs.length + 1}`,
        wsUrl: `ws://localhost:${defaultPort}/ws`,
      };

      return {
        tabs: [...prevTabs, newTab],
        activeTabId: newTab.id,
      };
    });
  }, [defaultPort]);

  const removeTab = useCallback((id: string) => {
    setTabsState(prevState => {
      const { tabs: prevTabs, activeTabId: prevActiveId } = prevState;

      // Don't remove if it's the last tab
      if (prevTabs.length === 1) {
        return prevState;
      }

      // Find the index of the tab to remove
      const indexToRemove = prevTabs.findIndex(t => t.id === id);
      if (indexToRemove === -1) {
        return prevState;
      }

      // Remove the tab
      const newTabs = prevTabs.filter((_, index) => index !== indexToRemove);

      // If the removed tab was active, select a new active tab
      let newActiveTabId = prevActiveId;
      if (prevActiveId === id) {
        // Removed tab was active, select adjacent tab
        if (indexToRemove > 0) {
          // Select previous tab
          newActiveTabId = newTabs[indexToRemove - 1].id;
        } else if (newTabs.length > 0) {
          // Select first tab (if removed was first)
          newActiveTabId = newTabs[0].id;
        } else {
          newActiveTabId = null;
        }
      }

      return {
        tabs: newTabs,
        activeTabId: newActiveTabId,
      };
    });
  }, []);

  const renameTab = useCallback((id: string, name: string) => {
    setTabsState(prevState => {
      const { tabs: prevTabs } = prevState;
      const tab = prevTabs.find(t => t.id === id);
      if (!tab) {
        return prevState;
      }

      // Trim the name and use default if empty
      const trimmedName = name.trim();
      const finalName = trimmedName.length === 0 ? 'Terminal' : trimmedName;

      return {
        ...prevState,
        tabs: prevTabs.map(t =>
          t.id === id ? { ...t, name: finalName } : t
        ),
      };
    });
  }, []);

  const setActiveTabCb = useCallback((id: string) => {
    setTabsState(prevState => {
      // Verify tab exists
      const tabExists = prevState.tabs.some(t => t.id === id);
      if (!tabExists) {
        return prevState;
      }
      return { ...prevState, activeTabId: id };
    });
  }, []);

  const reorderTabs = useCallback((fromIndex: number, toIndex: number) => {
    setTabsState(prevState => {
      const { tabs: prevTabs } = prevState;

      // Validate indices
      if (
        fromIndex < 0 ||
        fromIndex >= prevTabs.length ||
        toIndex < 0 ||
        toIndex >= prevTabs.length ||
        fromIndex === toIndex
      ) {
        return prevState;
      }

      // Create new array with reordered tabs
      const newTabs = [...prevTabs];
      const [removed] = newTabs.splice(fromIndex, 1);
      newTabs.splice(toIndex, 0, removed);

      return {
        ...prevState,
        tabs: newTabs,
      };
    });
  }, []);

  const activeTab = tabs.find(t => t.id === activeTabId) || null;

  return {
    tabs,
    activeTabId,
    activeTab,
    addTab,
    removeTab,
    renameTab,
    setActiveTab: setActiveTabCb,
    reorderTabs,
  };
}
