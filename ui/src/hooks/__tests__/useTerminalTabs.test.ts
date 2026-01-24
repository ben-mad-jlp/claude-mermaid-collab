/**
 * useTerminalTabs Hook Tests
 *
 * Tests verify:
 * - Hook initialization with localStorage persistence
 * - Tab state management (add, remove, rename, reorder)
 * - Active tab tracking
 * - Port discovery and allocation
 * - Persistence across reload
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useTerminalTabs } from '../useTerminalTabs';
import type { TerminalTab } from '../../types/terminal';

describe('useTerminalTabs', () => {
  const DEFAULT_STORAGE_KEY = 'terminal-tabs';

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe('Initialization', () => {
    it('should initialize with one default tab if localStorage is empty', () => {
      const { result } = renderHook(() => useTerminalTabs());

      expect(result.current.tabs).toHaveLength(1);
      expect(result.current.tabs[0].name).toBe('Terminal 1');
      expect(result.current.tabs[0].wsUrl).toBe('ws://localhost:7681/ws');
      expect(result.current.activeTabId).toBe(result.current.tabs[0].id);
      expect(result.current.tabs[0].id).toBeDefined();
      expect(typeof result.current.tabs[0].id).toBe('string');
    });

    it('should initialize with correct activeTab reference', () => {
      const { result } = renderHook(() => useTerminalTabs());

      expect(result.current.activeTab).not.toBeNull();
      expect(result.current.activeTab).toEqual(result.current.tabs[0]);
      expect(result.current.activeTab?.id).toBe(result.current.activeTabId);
    });

    it('should use custom storage key if provided', () => {
      const customKey = 'custom-terminal-tabs';

      renderHook(() => useTerminalTabs({ storageKey: customKey }));

      const stored = localStorage.getItem(customKey);
      expect(stored).toBeDefined();
    });

    it('should use custom default port if provided', () => {
      const { result } = renderHook(() => useTerminalTabs({ defaultPort: 8000 }));

      expect(result.current.tabs[0].wsUrl).toBe('ws://localhost:8000/ws');
    });

    it('should restore state from localStorage', () => {
      const mockTab: TerminalTab = {
        id: 'tab-1',
        name: 'Saved Terminal',
        wsUrl: 'ws://localhost:7681/ws',
      };

      const mockState = {
        tabs: [mockTab],
        activeTabId: 'tab-1',
      };

      localStorage.setItem(DEFAULT_STORAGE_KEY, JSON.stringify(mockState));

      const { result } = renderHook(() => useTerminalTabs());

      expect(result.current.tabs).toEqual([mockTab]);
      expect(result.current.activeTabId).toBe('tab-1');
    });

    it('should handle corrupted localStorage gracefully', () => {
      localStorage.setItem(DEFAULT_STORAGE_KEY, 'invalid json{{{');

      const { result } = renderHook(() => useTerminalTabs());

      // Should fall back to default state
      expect(result.current.tabs).toHaveLength(1);
      expect(result.current.tabs[0].name).toBe('Terminal 1');
      expect(result.current.activeTabId).toBe(result.current.tabs[0].id);
    });
  });

  describe('addTab()', () => {
    it('should add a new tab with incremented name', async () => {
      const { result } = renderHook(() => useTerminalTabs());

      expect(result.current.tabs).toHaveLength(1);

      act(() => {
        result.current.addTab();
      });

      await waitFor(() => {
        expect(result.current.tabs).toHaveLength(2);
      });

      expect(result.current.tabs[1].name).toBe('Terminal 2');
    });

    it('should generate unique IDs for new tabs', async () => {
      const { result } = renderHook(() => useTerminalTabs());

      const firstId = result.current.tabs[0].id;

      act(() => {
        result.current.addTab();
      });

      await waitFor(() => {
        expect(result.current.tabs).toHaveLength(2);
      });

      const secondId = result.current.tabs[1].id;

      expect(firstId).not.toBe(secondId);
    });

    it('should find next available port starting from default', async () => {
      const { result } = renderHook(() => useTerminalTabs({ defaultPort: 7681 }));

      expect(result.current.tabs[0].wsUrl).toContain(':7681/ws');

      act(() => {
        result.current.addTab();
      });

      await waitFor(() => {
        expect(result.current.tabs).toHaveLength(2);
      });

      expect(result.current.tabs[1].wsUrl).toContain(':7682/ws');

      act(() => {
        result.current.addTab();
      });

      await waitFor(() => {
        expect(result.current.tabs).toHaveLength(3);
      });

      expect(result.current.tabs[2].wsUrl).toContain(':7683/ws');
    });

    it('should set new tab as active', async () => {
      const { result } = renderHook(() => useTerminalTabs());

      const firstTabId = result.current.activeTabId;

      act(() => {
        result.current.addTab();
      });

      await waitFor(() => {
        expect(result.current.tabs).toHaveLength(2);
      });

      expect(result.current.activeTabId).not.toBe(firstTabId);
      expect(result.current.activeTabId).toBe(result.current.tabs[1].id);
    });

    it('should update localStorage on add', () => {
      const { result } = renderHook(() => useTerminalTabs());

      act(() => {
        result.current.addTab();
      });

      const stored = localStorage.getItem(DEFAULT_STORAGE_KEY);
      expect(stored).toBeDefined();

      if (stored) {
        const data = JSON.parse(stored);
        expect(data.tabs).toHaveLength(2);
      }
    });

    it('should add multiple tabs sequentially', () => {
      const { result } = renderHook(() => useTerminalTabs());

      act(() => {
        result.current.addTab();
        result.current.addTab();
        result.current.addTab();
      });

      expect(result.current.tabs).toHaveLength(4);
      expect(result.current.tabs[0].name).toBe('Terminal 1');
      expect(result.current.tabs[1].name).toBe('Terminal 2');
      expect(result.current.tabs[2].name).toBe('Terminal 3');
      expect(result.current.tabs[3].name).toBe('Terminal 4');
    });
  });

  describe('removeTab(id)', () => {
    it('should remove a tab by id', async () => {
      const { result } = renderHook(() => useTerminalTabs());

      // Store the first tab
      const firstTab = result.current.tabs[0];

      act(() => {
        result.current.addTab();
      });

      await waitFor(() => {
        expect(result.current.tabs).toHaveLength(2);
      });

      const secondTab = result.current.tabs[1];

      act(() => {
        result.current.removeTab(secondTab.id);
      });

      await waitFor(() => {
        expect(result.current.tabs).toHaveLength(1);
      });

      expect(result.current.tabs[0]).toEqual(firstTab);
    });

    it('should not remove the last tab', () => {
      const { result } = renderHook(() => useTerminalTabs());

      const lastTab = result.current.tabs[0];

      act(() => {
        result.current.removeTab(lastTab.id);
      });

      expect(result.current.tabs).toHaveLength(1);
      expect(result.current.tabs[0]).toEqual(lastTab);
    });

    it('should set new active tab when removing active tab', async () => {
      const { result } = renderHook(() => useTerminalTabs());

      act(() => {
        result.current.addTab();
        result.current.addTab();
      });

      await waitFor(() => {
        expect(result.current.tabs).toHaveLength(3);
      });

      const middleTab = result.current.tabs[1];
      act(() => {
        result.current.setActiveTab(middleTab.id);
      });

      act(() => {
        result.current.removeTab(middleTab.id);
      });

      await waitFor(() => {
        expect(result.current.tabs).toHaveLength(2);
      });

      expect(result.current.activeTabId).not.toBe(middleTab.id);
    });

    it('should select previous tab when removing active middle tab', async () => {
      const { result } = renderHook(() => useTerminalTabs());

      act(() => {
        result.current.addTab();
        result.current.addTab();
      });

      await waitFor(() => {
        expect(result.current.tabs).toHaveLength(3);
      });

      const firstTab = result.current.tabs[0];
      const middleTab = result.current.tabs[1];

      act(() => {
        result.current.setActiveTab(middleTab.id);
      });

      act(() => {
        result.current.removeTab(middleTab.id);
      });

      await waitFor(() => {
        expect(result.current.tabs).toHaveLength(2);
      });

      // Should select previous tab
      expect(result.current.activeTabId).toBe(firstTab.id);
    });

    it('should select first tab when removing first active tab', async () => {
      const { result } = renderHook(() => useTerminalTabs());

      act(() => {
        result.current.addTab();
      });

      await waitFor(() => {
        expect(result.current.tabs).toHaveLength(2);
      });

      const firstTab = result.current.tabs[0];
      const secondTab = result.current.tabs[1];

      act(() => {
        result.current.removeTab(firstTab.id);
      });

      await waitFor(() => {
        expect(result.current.tabs).toHaveLength(1);
      });

      // Should select next tab (now first)
      expect(result.current.activeTabId).toBe(secondTab.id);
    });

    it('should handle removing non-existent tab gracefully', () => {
      const { result } = renderHook(() => useTerminalTabs());

      const initialLength = result.current.tabs.length;

      act(() => {
        result.current.removeTab('non-existent-id');
      });

      expect(result.current.tabs.length).toBe(initialLength);
    });

    it('should update localStorage on remove', () => {
      const { result } = renderHook(() => useTerminalTabs());

      let tabToRemove: TerminalTab;
      act(() => {
        result.current.addTab();
        tabToRemove = result.current.tabs[0];
      });

      act(() => {
        result.current.removeTab(tabToRemove!.id);
      });

      const stored = localStorage.getItem(DEFAULT_STORAGE_KEY);
      if (stored) {
        const data = JSON.parse(stored);
        expect(data.tabs).toHaveLength(1);
      }
    });
  });

  describe('renameTab(id, name)', () => {
    it('should rename a tab', () => {
      const { result } = renderHook(() => useTerminalTabs());

      const tabId = result.current.tabs[0].id;

      act(() => {
        result.current.renameTab(tabId, 'My Custom Terminal');
      });

      expect(result.current.tabs[0].name).toBe('My Custom Terminal');
    });

    it('should trim whitespace from name', () => {
      const { result } = renderHook(() => useTerminalTabs());

      const tabId = result.current.tabs[0].id;

      act(() => {
        result.current.renameTab(tabId, '  Trimmed Name  ');
      });

      expect(result.current.tabs[0].name).toBe('Trimmed Name');
    });

    it('should use default name "Terminal" if name is empty after trimming', () => {
      const { result } = renderHook(() => useTerminalTabs());

      const tabId = result.current.tabs[0].id;

      act(() => {
        result.current.renameTab(tabId, '   ');
      });

      expect(result.current.tabs[0].name).toBe('Terminal');
    });

    it('should use default name "Terminal" if name is empty string', () => {
      const { result } = renderHook(() => useTerminalTabs());

      const tabId = result.current.tabs[0].id;

      act(() => {
        result.current.renameTab(tabId, '');
      });

      expect(result.current.tabs[0].name).toBe('Terminal');
    });

    it('should handle renaming non-existent tab gracefully', () => {
      const { result } = renderHook(() => useTerminalTabs());

      const originalName = result.current.tabs[0].name;

      act(() => {
        result.current.renameTab('non-existent-id', 'New Name');
      });

      expect(result.current.tabs[0].name).toBe(originalName);
    });

    it('should update localStorage on rename', () => {
      const { result } = renderHook(() => useTerminalTabs());

      const tabId = result.current.tabs[0].id;

      act(() => {
        result.current.renameTab(tabId, 'Updated Name');
      });

      const stored = localStorage.getItem(DEFAULT_STORAGE_KEY);
      if (stored) {
        const data = JSON.parse(stored);
        expect(data.tabs[0].name).toBe('Updated Name');
      }
    });

    it('should rename multiple tabs independently', async () => {
      const { result } = renderHook(() => useTerminalTabs());

      act(() => {
        result.current.addTab();
      });

      await waitFor(() => {
        expect(result.current.tabs).toHaveLength(2);
      });

      const tab1Id = result.current.tabs[0].id;
      const tab2Id = result.current.tabs[1].id;

      act(() => {
        result.current.renameTab(tab1Id, 'First');
        result.current.renameTab(tab2Id, 'Second');
      });

      await waitFor(() => {
        expect(result.current.tabs[0].name).toBe('First');
      });

      expect(result.current.tabs[1].name).toBe('Second');
    });
  });

  describe('setActiveTab(id)', () => {
    it('should set active tab when tab exists', async () => {
      const { result } = renderHook(() => useTerminalTabs());

      act(() => {
        result.current.addTab();
      });

      await waitFor(() => {
        expect(result.current.tabs).toHaveLength(2);
      });

      const secondTabId = result.current.tabs[1].id;

      act(() => {
        result.current.setActiveTab(secondTabId);
      });

      expect(result.current.activeTabId).toBe(secondTabId);
    });

    it('should update activeTab reference when active tab changes', async () => {
      const { result } = renderHook(() => useTerminalTabs());

      act(() => {
        result.current.addTab();
      });

      await waitFor(() => {
        expect(result.current.tabs).toHaveLength(2);
      });

      const secondTab = result.current.tabs[1];

      act(() => {
        result.current.setActiveTab(secondTab.id);
      });

      expect(result.current.activeTab).toEqual(secondTab);
    });

    it('should not change active tab if id does not exist', () => {
      const { result } = renderHook(() => useTerminalTabs());

      const originalActiveId = result.current.activeTabId;

      act(() => {
        result.current.setActiveTab('non-existent-id');
      });

      expect(result.current.activeTabId).toBe(originalActiveId);
    });

    it('should update localStorage on active tab change', async () => {
      const { result } = renderHook(() => useTerminalTabs());

      act(() => {
        result.current.addTab();
      });

      await waitFor(() => {
        expect(result.current.tabs).toHaveLength(2);
      });

      const secondTabId = result.current.tabs[1].id;

      act(() => {
        result.current.setActiveTab(secondTabId);
      });

      const stored = localStorage.getItem(DEFAULT_STORAGE_KEY);
      if (stored) {
        const data = JSON.parse(stored);
        expect(data.activeTabId).toBe(secondTabId);
      }
    });

    it('should handle switching between multiple tabs', async () => {
      const { result } = renderHook(() => useTerminalTabs());

      act(() => {
        result.current.addTab();
        result.current.addTab();
      });

      await waitFor(() => {
        expect(result.current.tabs).toHaveLength(3);
      });

      const tab2Id = result.current.tabs[1].id;
      const tab3Id = result.current.tabs[2].id;

      act(() => {
        result.current.setActiveTab(tab2Id);
      });

      expect(result.current.activeTabId).toBe(tab2Id);

      act(() => {
        result.current.setActiveTab(tab3Id);
      });

      expect(result.current.activeTabId).toBe(tab3Id);

      act(() => {
        result.current.setActiveTab(tab2Id);
      });

      expect(result.current.activeTabId).toBe(tab2Id);
    });
  });

  describe('reorderTabs(fromIndex, toIndex)', () => {
    it('should reorder tabs by index', async () => {
      const { result } = renderHook(() => useTerminalTabs());

      act(() => {
        result.current.addTab();
        result.current.addTab();
      });

      await waitFor(() => {
        expect(result.current.tabs).toHaveLength(3);
      });

      const tab1 = result.current.tabs[0];
      const tab2 = result.current.tabs[1];
      const tab3 = result.current.tabs[2];

      act(() => {
        result.current.reorderTabs(0, 2);
      });

      // tab2 should now be first, tab3 second, tab1 third
      expect(result.current.tabs[0]).toEqual(tab2);
      expect(result.current.tabs[1]).toEqual(tab3);
      expect(result.current.tabs[2]).toEqual(tab1);
    });

    it('should move tab from end to beginning', async () => {
      const { result } = renderHook(() => useTerminalTabs());

      act(() => {
        result.current.addTab();
        result.current.addTab();
      });

      await waitFor(() => {
        expect(result.current.tabs).toHaveLength(3);
      });

      const tab1 = result.current.tabs[0];
      const tab2 = result.current.tabs[1];
      const tab3 = result.current.tabs[2];

      act(() => {
        result.current.reorderTabs(2, 0);
      });

      // tab3 should now be first
      expect(result.current.tabs[0]).toEqual(tab3);
      expect(result.current.tabs[1]).toEqual(tab1);
      expect(result.current.tabs[2]).toEqual(tab2);
    });

    it('should handle invalid indices gracefully', () => {
      const { result } = renderHook(() => useTerminalTabs());

      let tab1: TerminalTab;
      act(() => {
        result.current.addTab();
        tab1 = result.current.tabs[0];
      });

      const originalOrder = [...result.current.tabs];

      act(() => {
        result.current.reorderTabs(-1, 0);
      });

      expect(result.current.tabs).toEqual(originalOrder);

      act(() => {
        result.current.reorderTabs(0, 100);
      });

      expect(result.current.tabs).toEqual(originalOrder);
    });

    it('should handle same index (no-op)', () => {
      const { result } = renderHook(() => useTerminalTabs());

      let tab1: TerminalTab;
      act(() => {
        result.current.addTab();
        tab1 = result.current.tabs[0];
      });

      const originalOrder = [...result.current.tabs];

      act(() => {
        result.current.reorderTabs(0, 0);
      });

      expect(result.current.tabs).toEqual(originalOrder);
    });

    it('should update localStorage on reorder', () => {
      const { result } = renderHook(() => useTerminalTabs());

      act(() => {
        result.current.addTab();
        result.current.addTab();
      });

      act(() => {
        result.current.reorderTabs(0, 2);
      });

      const stored = localStorage.getItem(DEFAULT_STORAGE_KEY);
      if (stored) {
        const data = JSON.parse(stored);
        expect(data.tabs).toHaveLength(3);
      }
    });

    it('should maintain active tab reference after reorder', async () => {
      const { result } = renderHook(() => useTerminalTabs());

      act(() => {
        result.current.addTab();
        result.current.addTab();
      });

      await waitFor(() => {
        expect(result.current.tabs).toHaveLength(3);
      });

      const tab2Id = result.current.tabs[1].id;

      act(() => {
        result.current.setActiveTab(tab2Id);
      });

      act(() => {
        result.current.reorderTabs(0, 2);
      });

      // Active tab ID should remain the same even if position changed
      expect(result.current.activeTabId).toBe(tab2Id);
    });
  });

  describe('Persistence', () => {
    it('should persist state across hook unmount and remount', async () => {
      const { unmount } = renderHook(() => useTerminalTabs());

      const { result: result1 } = renderHook(() => useTerminalTabs());

      act(() => {
        result1.current.addTab();
      });

      await waitFor(() => {
        expect(result1.current.tabs).toHaveLength(2);
      });

      const tab2Id = result1.current.tabs[1].id;

      act(() => {
        result1.current.renameTab(tab2Id, 'Custom Name');
        result1.current.setActiveTab(tab2Id);
      });

      unmount();

      const { result: result2 } = renderHook(() => useTerminalTabs());

      expect(result2.current.tabs).toHaveLength(2);
      expect(result2.current.tabs[1].name).toBe('Custom Name');
      expect(result2.current.activeTabId).toBe(tab2Id);
    });

    it('should read shared localStorage state when multiple instances exist', async () => {
      // Setup first instance and add a tab
      const { result: result1 } = renderHook(() => useTerminalTabs());

      act(() => {
        result1.current.addTab();
      });

      await waitFor(() => {
        expect(result1.current.tabs).toHaveLength(2);
      });

      const tab2Id = result1.current.tabs[1].id;

      // Create a new hook instance - it should read from localStorage
      const { result: result2 } = renderHook(() => useTerminalTabs());

      // Second instance should see the state that was persisted by first instance
      expect(result2.current.tabs).toHaveLength(2);
      expect(result2.current.tabs[1].id).toBe(tab2Id);
    });
  });

  describe('Edge Cases', () => {
    it('should handle rapid operations', async () => {
      const { result } = renderHook(() => useTerminalTabs());

      act(() => {
        result.current.addTab();
        result.current.addTab();
        result.current.addTab();
      });

      await waitFor(() => {
        expect(result.current.tabs).toHaveLength(4);
      });

      const tabToRemoveId = result.current.tabs[1].id;
      const tab1Id = result.current.tabs[0].id;
      const tab3Id = result.current.tabs[2].id;

      act(() => {
        result.current.removeTab(tabToRemoveId);
        result.current.renameTab(tab1Id, 'Test');
        result.current.setActiveTab(tab3Id);
      });

      await waitFor(() => {
        expect(result.current.tabs).toHaveLength(3);
      });

      expect(result.current.tabs[0].name).toBe('Test');
    });

    it('should handle tab operations with special characters in names', () => {
      const { result } = renderHook(() => useTerminalTabs());

      const specialNames = [
        'Terminal "quoted"',
        "Terminal 'single'",
        'Terminal with\nnewline',
        'Terminal\twith\ttabs',
      ];

      act(() => {
        result.current.addTab();
        result.current.renameTab(result.current.tabs[0].id, specialNames[0]);
      });

      expect(result.current.tabs[0].name).toBe(specialNames[0]);
    });

    it('should maintain consistency with large number of tabs', () => {
      const { result } = renderHook(() => useTerminalTabs());

      act(() => {
        for (let i = 0; i < 10; i++) {
          result.current.addTab();
        }
      });

      expect(result.current.tabs).toHaveLength(11);

      const ports = new Set(result.current.tabs.map(t => t.wsUrl));
      expect(ports.size).toBe(11); // All unique ports
    });

    it('should handle activeTabId being null initially', () => {
      const { result } = renderHook(() => useTerminalTabs());

      // Default state should have an active tab
      expect(result.current.activeTabId).not.toBeNull();

      // But activeTab should gracefully handle null cases
      expect(result.current.activeTab).not.toBeNull();
    });
  });
});
