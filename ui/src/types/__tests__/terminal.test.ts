/**
 * Terminal Types Test Suite
 * Verifies that TerminalTab and TerminalTabsState types are properly defined and exported
 */

import type { TerminalTab, TerminalTabsState, TerminalConfig, TerminalState } from '../terminal';

describe('Terminal Types', () => {
  describe('TerminalConfig interface', () => {
    it('should have required properties', () => {
      const config: TerminalConfig = {
        wsUrl: 'ws://localhost:7681/ws',
      };

      expect(config.wsUrl).toBeDefined();
      expect(config.wsUrl).toBe('ws://localhost:7681/ws');
    });

    it('should support optional properties', () => {
      const config: TerminalConfig = {
        wsUrl: 'ws://localhost:7681/ws',
        fontSize: 14,
        fontFamily: 'monospace',
      };

      expect(config.fontSize).toBe(14);
      expect(config.fontFamily).toBe('monospace');
    });
  });

  describe('TerminalState interface', () => {
    it('should have required properties', () => {
      const state: TerminalState = {
        connected: true,
        error: null,
      };

      expect(state.connected).toBe(true);
      expect(state.error).toBeNull();
    });

    it('should support error state', () => {
      const state: TerminalState = {
        connected: false,
        error: 'Connection failed',
      };

      expect(state.connected).toBe(false);
      expect(state.error).toBe('Connection failed');
    });
  });

  describe('TerminalTab interface', () => {
    it('should have all required properties', () => {
      const tab: TerminalTab = {
        id: 'tab-1',
        name: 'Terminal 1',
        wsUrl: 'ws://localhost:7681/ws',
      };

      expect(tab.id).toBeDefined();
      expect(tab.name).toBeDefined();
      expect(tab.wsUrl).toBeDefined();
      expect(tab.id).toBe('tab-1');
      expect(tab.name).toBe('Terminal 1');
      expect(tab.wsUrl).toBe('ws://localhost:7681/ws');
    });

    it('should support multiple tabs', () => {
      const tabs: TerminalTab[] = [
        {
          id: 'tab-1',
          name: 'Terminal 1',
          wsUrl: 'ws://localhost:7681/ws',
        },
        {
          id: 'tab-2',
          name: 'Terminal 2',
          wsUrl: 'ws://localhost:7682/ws',
        },
      ];

      expect(tabs).toHaveLength(2);
      expect(tabs[0].id).toBe('tab-1');
      expect(tabs[1].id).toBe('tab-2');
    });

    it('should allow custom names', () => {
      const tab: TerminalTab = {
        id: 'custom-id',
        name: 'Custom Terminal Name',
        wsUrl: 'ws://localhost:7683/ws',
      };

      expect(tab.name).toBe('Custom Terminal Name');
    });

    it('should allow different port URLs', () => {
      const tab1: TerminalTab = {
        id: 'tab-1',
        name: 'Port 7681',
        wsUrl: 'ws://localhost:7681/ws',
      };

      const tab2: TerminalTab = {
        id: 'tab-2',
        name: 'Port 7682',
        wsUrl: 'ws://localhost:7682/ws',
      };

      expect(tab1.wsUrl).toBe('ws://localhost:7681/ws');
      expect(tab2.wsUrl).toBe('ws://localhost:7682/ws');
    });
  });

  describe('TerminalTabsState interface', () => {
    it('should have required properties', () => {
      const state: TerminalTabsState = {
        tabs: [],
        activeTabId: null,
      };

      expect(state.tabs).toBeDefined();
      expect(state.activeTabId).toBeDefined();
      expect(state.tabs).toEqual([]);
      expect(state.activeTabId).toBeNull();
    });

    it('should support array of tabs', () => {
      const state: TerminalTabsState = {
        tabs: [
          {
            id: 'tab-1',
            name: 'Terminal 1',
            wsUrl: 'ws://localhost:7681/ws',
          },
          {
            id: 'tab-2',
            name: 'Terminal 2',
            wsUrl: 'ws://localhost:7682/ws',
          },
        ],
        activeTabId: 'tab-1',
      };

      expect(state.tabs).toHaveLength(2);
      expect(state.activeTabId).toBe('tab-1');
      expect(state.tabs[0].id).toBe('tab-1');
      expect(state.tabs[1].id).toBe('tab-2');
    });

    it('should allow null activeTabId', () => {
      const state: TerminalTabsState = {
        tabs: [
          {
            id: 'tab-1',
            name: 'Terminal 1',
            wsUrl: 'ws://localhost:7681/ws',
          },
        ],
        activeTabId: null,
      };

      expect(state.activeTabId).toBeNull();
    });

    it('should track active tab correctly', () => {
      const state: TerminalTabsState = {
        tabs: [
          {
            id: 'tab-1',
            name: 'Terminal 1',
            wsUrl: 'ws://localhost:7681/ws',
          },
          {
            id: 'tab-2',
            name: 'Terminal 2',
            wsUrl: 'ws://localhost:7682/ws',
          },
          {
            id: 'tab-3',
            name: 'Terminal 3',
            wsUrl: 'ws://localhost:7683/ws',
          },
        ],
        activeTabId: 'tab-2',
      };

      const activeTab = state.tabs.find(t => t.id === state.activeTabId);
      expect(activeTab).toBeDefined();
      expect(activeTab?.name).toBe('Terminal 2');
    });

    it('should represent empty tabs with null active tab', () => {
      const state: TerminalTabsState = {
        tabs: [],
        activeTabId: null,
      };

      expect(state.tabs).toHaveLength(0);
      expect(state.activeTabId).toBeNull();
    });

    it('should support complex tab state', () => {
      const state: TerminalTabsState = {
        tabs: [
          {
            id: 'build',
            name: 'Build Output',
            wsUrl: 'ws://localhost:7681/ws',
          },
          {
            id: 'tests',
            name: 'Test Runner',
            wsUrl: 'ws://localhost:7682/ws',
          },
          {
            id: 'dev-server',
            name: 'Dev Server',
            wsUrl: 'ws://localhost:7683/ws',
          },
        ],
        activeTabId: 'tests',
      };

      expect(state.tabs).toHaveLength(3);
      expect(state.activeTabId).toBe('tests');
      expect(state.tabs.map(t => t.name)).toEqual([
        'Build Output',
        'Test Runner',
        'Dev Server',
      ]);
    });
  });

  describe('Type Exports', () => {
    it('should export TerminalTab type', () => {
      const tab: TerminalTab = {
        id: 'tab-1',
        name: 'Terminal 1',
        wsUrl: 'ws://localhost:7681/ws',
      };

      expect(tab).toBeDefined();
    });

    it('should export TerminalTabsState type', () => {
      const state: TerminalTabsState = {
        tabs: [],
        activeTabId: null,
      };

      expect(state).toBeDefined();
    });

    it('should export all terminal types', () => {
      const config: TerminalConfig = { wsUrl: 'ws://localhost:7681/ws' };
      const terminalState: TerminalState = { connected: true, error: null };
      const tab: TerminalTab = { id: 'tab-1', name: 'Terminal 1', wsUrl: 'ws://localhost:7681/ws' };
      const tabsState: TerminalTabsState = { tabs: [], activeTabId: null };

      expect(config).toBeDefined();
      expect(terminalState).toBeDefined();
      expect(tab).toBeDefined();
      expect(tabsState).toBeDefined();
    });
  });

  describe('Type Compatibility', () => {
    it('should allow array of TerminalTab objects', () => {
      const tabs: TerminalTab[] = [
        { id: 'tab-1', name: 'Terminal 1', wsUrl: 'ws://localhost:7681/ws' },
        { id: 'tab-2', name: 'Terminal 2', wsUrl: 'ws://localhost:7682/ws' },
      ];

      expect(tabs).toHaveLength(2);
      expect(tabs.every(t => typeof t.id === 'string')).toBe(true);
      expect(tabs.every(t => typeof t.name === 'string')).toBe(true);
      expect(tabs.every(t => typeof t.wsUrl === 'string')).toBe(true);
    });

    it('should allow finding tab in array', () => {
      const tabs: TerminalTab[] = [
        { id: 'tab-1', name: 'Terminal 1', wsUrl: 'ws://localhost:7681/ws' },
        { id: 'tab-2', name: 'Terminal 2', wsUrl: 'ws://localhost:7682/ws' },
      ];

      const found = tabs.find(t => t.id === 'tab-2');
      expect(found).toBeDefined();
      expect(found?.name).toBe('Terminal 2');
    });

    it('should support filtering tabs', () => {
      const tabs: TerminalTab[] = [
        { id: 'tab-1', name: 'Terminal 1', wsUrl: 'ws://localhost:7681/ws' },
        { id: 'tab-2', name: 'Terminal 2', wsUrl: 'ws://localhost:7682/ws' },
        { id: 'tab-3', name: 'Terminal 3', wsUrl: 'ws://localhost:7683/ws' },
      ];

      const filtered = tabs.filter(t => t.id.endsWith('2'));
      expect(filtered).toHaveLength(1);
      expect(filtered[0].id).toBe('tab-2');
    });
  });
});
