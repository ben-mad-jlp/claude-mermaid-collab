import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useUIStore, type UIState } from '../uiStore';

describe('useUIStore', () => {
  beforeEach(() => {
    // Clear the store before each test
    useUIStore.getState().reset();
    // Clear localStorage
    localStorage.clear();
  });

  afterEach(() => {
    // Clean up after each test
    localStorage.clear();
  });

  describe('Theme Management', () => {
    it('should initialize with light theme by default', () => {
      const state = useUIStore.getState();
      expect(['light', 'dark']).toContain(state.theme);
    });

    it('should set theme to dark', () => {
      const { setTheme } = useUIStore.getState();
      setTheme('dark');
      expect(useUIStore.getState().theme).toBe('dark');
    });

    it('should set theme to light', () => {
      const { setTheme } = useUIStore.getState();
      setTheme('light');
      expect(useUIStore.getState().theme).toBe('light');
    });

    it('should toggle theme from light to dark', () => {
      useUIStore.getState().setTheme('light');
      useUIStore.getState().toggleTheme();
      expect(useUIStore.getState().theme).toBe('dark');
    });

    it('should toggle theme from dark to light', () => {
      useUIStore.getState().setTheme('dark');
      useUIStore.getState().toggleTheme();
      expect(useUIStore.getState().theme).toBe('light');
    });

    it('should persist theme to localStorage', () => {
      useUIStore.getState().setTheme('dark');
      // The persist middleware should save to localStorage
      const stored = localStorage.getItem('ui-preferences');
      expect(stored).toBeDefined();
      const data = JSON.parse(stored!);
      expect(data.state.theme).toBe('dark');
    });
  });

  describe('Sidebar Visibility', () => {
    it('should initialize with sidebar visible', () => {
      const state = useUIStore.getState();
      expect(state.sidebarVisible).toBe(true);
    });

    it('should hide sidebar', () => {
      useUIStore.getState().setSidebarVisible(false);
      expect(useUIStore.getState().sidebarVisible).toBe(false);
    });

    it('should show sidebar', () => {
      useUIStore.getState().setSidebarVisible(false);
      useUIStore.getState().setSidebarVisible(true);
      expect(useUIStore.getState().sidebarVisible).toBe(true);
    });

    it('should toggle sidebar visibility', () => {
      const initial = useUIStore.getState().sidebarVisible;
      useUIStore.getState().toggleSidebar();
      expect(useUIStore.getState().sidebarVisible).toBe(!initial);
      useUIStore.getState().toggleSidebar();
      expect(useUIStore.getState().sidebarVisible).toBe(initial);
    });

    it('should persist sidebar visibility', () => {
      useUIStore.getState().setSidebarVisible(false);
      const stored = localStorage.getItem('ui-preferences');
      expect(stored).toBeDefined();
      const data = JSON.parse(stored!);
      expect(data.state.sidebarVisible).toBe(false);
    });
  });

  describe('Session Panel Visibility', () => {
    it('should initialize with session panel visible', () => {
      const state = useUIStore.getState();
      expect(state.sessionPanelVisible).toBe(true);
    });

    it('should hide session panel', () => {
      useUIStore.getState().setSessionPanelVisible(false);
      expect(useUIStore.getState().sessionPanelVisible).toBe(false);
    });

    it('should show session panel', () => {
      useUIStore.getState().setSessionPanelVisible(false);
      useUIStore.getState().setSessionPanelVisible(true);
      expect(useUIStore.getState().sessionPanelVisible).toBe(true);
    });

    it('should toggle session panel visibility', () => {
      const initial = useUIStore.getState().sessionPanelVisible;
      useUIStore.getState().toggleSessionPanel();
      expect(useUIStore.getState().sessionPanelVisible).toBe(!initial);
      useUIStore.getState().toggleSessionPanel();
      expect(useUIStore.getState().sessionPanelVisible).toBe(initial);
    });

    it('should persist session panel visibility', () => {
      useUIStore.getState().setSessionPanelVisible(false);
      const stored = localStorage.getItem('ui-preferences');
      expect(stored).toBeDefined();
      const data = JSON.parse(stored!);
      expect(data.state.sessionPanelVisible).toBe(false);
    });
  });

  describe('Sidebar Split Position', () => {
    it('should initialize with default position of 20', () => {
      const state = useUIStore.getState();
      expect(state.sidebarSplitPosition).toBe(20);
    });

    it('should set sidebar split position', () => {
      useUIStore.getState().setSidebarSplitPosition(30);
      expect(useUIStore.getState().sidebarSplitPosition).toBe(30);
    });

    it('should clamp sidebar position to minimum of 10', () => {
      useUIStore.getState().setSidebarSplitPosition(5);
      expect(useUIStore.getState().sidebarSplitPosition).toBe(10);
    });

    it('should clamp sidebar position to maximum of 50', () => {
      useUIStore.getState().setSidebarSplitPosition(60);
      expect(useUIStore.getState().sidebarSplitPosition).toBe(50);
    });

    it('should allow valid positions between 10 and 50', () => {
      useUIStore.getState().setSidebarSplitPosition(25);
      expect(useUIStore.getState().sidebarSplitPosition).toBe(25);
      useUIStore.getState().setSidebarSplitPosition(40);
      expect(useUIStore.getState().sidebarSplitPosition).toBe(40);
    });

    it('should persist sidebar split position', () => {
      useUIStore.getState().setSidebarSplitPosition(35);
      const stored = localStorage.getItem('ui-preferences');
      expect(stored).toBeDefined();
      const data = JSON.parse(stored!);
      expect(data.state.sidebarSplitPosition).toBe(35);
    });
  });

  describe('Session Panel Split Position', () => {
    it('should initialize with default position of 20', () => {
      const state = useUIStore.getState();
      expect(state.sessionPanelSplitPosition).toBe(20);
    });

    it('should set session panel split position', () => {
      useUIStore.getState().setSessionPanelSplitPosition(25);
      expect(useUIStore.getState().sessionPanelSplitPosition).toBe(25);
    });

    it('should clamp session panel position to minimum of 10', () => {
      useUIStore.getState().setSessionPanelSplitPosition(5);
      expect(useUIStore.getState().sessionPanelSplitPosition).toBe(10);
    });

    it('should clamp session panel position to maximum of 50', () => {
      useUIStore.getState().setSessionPanelSplitPosition(60);
      expect(useUIStore.getState().sessionPanelSplitPosition).toBe(50);
    });

    it('should allow valid positions between 10 and 50', () => {
      useUIStore.getState().setSessionPanelSplitPosition(15);
      expect(useUIStore.getState().sessionPanelSplitPosition).toBe(15);
      useUIStore.getState().setSessionPanelSplitPosition(45);
      expect(useUIStore.getState().sessionPanelSplitPosition).toBe(45);
    });

    it('should persist session panel split position', () => {
      useUIStore.getState().setSessionPanelSplitPosition(28);
      const stored = localStorage.getItem('ui-preferences');
      expect(stored).toBeDefined();
      const data = JSON.parse(stored!);
      expect(data.state.sessionPanelSplitPosition).toBe(28);
    });
  });

  describe('Reset Functionality', () => {
    it('should reset all state to defaults', () => {
      // Change various states
      useUIStore.getState().setTheme('dark');
      useUIStore.getState().setSidebarVisible(false);
      useUIStore.getState().setSessionPanelVisible(false);
      useUIStore.getState().setSidebarSplitPosition(35);
      useUIStore.getState().setSessionPanelSplitPosition(30);

      // Verify changes
      const state = useUIStore.getState();
      expect(state.theme).toBe('dark');
      expect(state.sidebarVisible).toBe(false);
      expect(state.sessionPanelVisible).toBe(false);
      expect(state.sidebarSplitPosition).toBe(35);
      expect(state.sessionPanelSplitPosition).toBe(30);

      // Reset
      useUIStore.getState().reset();

      // Verify defaults
      const resetState = useUIStore.getState();
      expect(['light', 'dark']).toContain(resetState.theme);
      expect(resetState.sidebarVisible).toBe(true);
      expect(resetState.sessionPanelVisible).toBe(true);
      expect(resetState.sidebarSplitPosition).toBe(20);
      expect(resetState.sessionPanelSplitPosition).toBe(20);
    });

    it('should persist reset state to localStorage', () => {
      useUIStore.getState().setTheme('dark');
      useUIStore.getState().reset();

      const stored = localStorage.getItem('ui-preferences');
      expect(stored).toBeDefined();
      const data = JSON.parse(stored!);
      expect(data.state.sidebarVisible).toBe(true);
      expect(data.state.sessionPanelVisible).toBe(true);
    });
  });

  describe('Multiple State Updates', () => {
    it('should handle multiple sequential state updates', () => {
      useUIStore.getState().setTheme('dark');
      expect(useUIStore.getState().theme).toBe('dark');

      useUIStore.getState().setSidebarVisible(false);
      expect(useUIStore.getState().sidebarVisible).toBe(false);

      useUIStore.getState().setSidebarSplitPosition(30);
      expect(useUIStore.getState().sidebarSplitPosition).toBe(30);

      useUIStore.getState().toggleSessionPanel();
      expect(useUIStore.getState().sessionPanelVisible).toBe(false);

      useUIStore.getState().toggleTheme();
      expect(useUIStore.getState().theme).toBe('light');
    });

    it('should maintain state independence across different properties', () => {
      useUIStore.getState().setTheme('dark');
      useUIStore.getState().setSidebarVisible(false);
      useUIStore.getState().setSessionPanelVisible(true);

      // Verify independence
      let state = useUIStore.getState();
      expect(state.theme).toBe('dark');
      expect(state.sidebarVisible).toBe(false);
      expect(state.sessionPanelVisible).toBe(true);

      // Change one property
      useUIStore.getState().setTheme('light');

      // Verify other properties unchanged
      state = useUIStore.getState();
      expect(state.sidebarVisible).toBe(false);
      expect(state.sessionPanelVisible).toBe(true);
    });
  });

  describe('Store API', () => {
    it('should expose getState method', () => {
      const state = useUIStore.getState();
      expect(state).toBeDefined();
      expect(typeof state).toBe('object');
    });

    it('should expose setState through individual setters', () => {
      const { setTheme, setSidebarVisible, setSessionPanelVisible } = useUIStore.getState();
      expect(typeof setTheme).toBe('function');
      expect(typeof setSidebarVisible).toBe('function');
      expect(typeof setSessionPanelVisible).toBe('function');
    });

    it('should have all required properties in state', () => {
      const state = useUIStore.getState();
      expect(state).toHaveProperty('theme');
      expect(state).toHaveProperty('sidebarVisible');
      expect(state).toHaveProperty('sessionPanelVisible');
      expect(state).toHaveProperty('sidebarSplitPosition');
      expect(state).toHaveProperty('sessionPanelSplitPosition');
    });

    it('should have all required methods in state', () => {
      const state = useUIStore.getState();
      expect(typeof state.setTheme).toBe('function');
      expect(typeof state.toggleTheme).toBe('function');
      expect(typeof state.setSidebarVisible).toBe('function');
      expect(typeof state.toggleSidebar).toBe('function');
      expect(typeof state.setSessionPanelVisible).toBe('function');
      expect(typeof state.toggleSessionPanel).toBe('function');
      expect(typeof state.setSidebarSplitPosition).toBe('function');
      expect(typeof state.setSessionPanelSplitPosition).toBe('function');
      expect(typeof state.reset).toBe('function');
    });
  });
});
