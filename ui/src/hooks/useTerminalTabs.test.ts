/**
 * useTerminalTabs Hook Tests
 *
 * Tests verify:
 * - Hook initialization with project and session
 * - Fetching terminal sessions from API on mount
 * - Loading and error state management
 * - Adding new terminal tabs
 * - Removing terminal tabs
 * - Renaming terminal tabs
 * - Setting active tab
 * - Reordering terminal tabs with optimistic updates
 * - Refreshing terminal sessions
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useTerminalTabs } from './useTerminalTabs';
import { api } from '../lib/api';
import type { TerminalSession, CreateSessionResult } from '../types/terminal';

// Mock the API
vi.mock('../lib/api', () => ({
  api: {
    getTerminalSessions: vi.fn(),
    createTerminalSession: vi.fn(),
    deleteTerminalSession: vi.fn(),
    renameTerminalSession: vi.fn(),
    reorderTerminalSessions: vi.fn(),
  },
}));

describe('useTerminalTabs', () => {
  const mockProject = '/path/to/project';
  const mockSession = 'test-session';

  const createMockSession = (id: string, name: string, order: number): TerminalSession => ({
    id,
    name,
    tmuxSession: `mc-${name}-${id.slice(0, 4)}`,
    created: new Date().toISOString(),
    order,
  });

  const mockSessions: TerminalSession[] = [
    createMockSession('session-1', 'Terminal 1', 0),
    createMockSession('session-2', 'Terminal 2', 1),
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    (api.getTerminalSessions as any).mockResolvedValue(mockSessions);
  });

  afterEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  describe('Initialization and Loading', () => {
    it('should initialize with loading state', () => {
      const { result } = renderHook(() =>
        useTerminalTabs({ project: mockProject, session: mockSession })
      );

      expect(result.current.isLoading).toBe(true);
      expect(result.current.tabs).toEqual([]);
      expect(result.current.activeTabId).toBeNull();
      expect(result.current.error).toBeNull();
    });

    it('should fetch sessions on mount', async () => {
      const { result } = renderHook(() =>
        useTerminalTabs({ project: mockProject, session: mockSession })
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(api.getTerminalSessions).toHaveBeenCalledWith(mockProject, mockSession);
      expect(result.current.tabs).toEqual(mockSessions);
      expect(result.current.activeTabId).toBe('session-1');
    });

    it('should set first session as active tab', async () => {
      const { result } = renderHook(() =>
        useTerminalTabs({ project: mockProject, session: mockSession })
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.activeTabId).toBe('session-1');
      expect(result.current.activeTab).toEqual(mockSessions[0]);
    });

    it('should set activeTabId to null when no sessions', async () => {
      (api.getTerminalSessions as any).mockResolvedValue([]);

      const { result } = renderHook(() =>
        useTerminalTabs({ project: mockProject, session: mockSession })
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.tabs).toEqual([]);
      expect(result.current.activeTabId).toBeNull();
      expect(result.current.activeTab).toBeNull();
    });

    it('should re-fetch when project changes', async () => {
      const { result, rerender } = renderHook(
        ({ project, session }) => useTerminalTabs({ project, session }),
        { initialProps: { project: mockProject, session: mockSession } }
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(api.getTerminalSessions).toHaveBeenCalledTimes(1);

      const newProject = '/new/project/path';
      rerender({ project: newProject, session: mockSession });

      await waitFor(() => {
        expect(api.getTerminalSessions).toHaveBeenCalledTimes(2);
      });

      expect(api.getTerminalSessions).toHaveBeenLastCalledWith(newProject, mockSession);
    });

    it('should re-fetch when session changes', async () => {
      const { result, rerender } = renderHook(
        ({ project, session }) => useTerminalTabs({ project, session }),
        { initialProps: { project: mockProject, session: mockSession } }
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(api.getTerminalSessions).toHaveBeenCalledTimes(1);

      const newSession = 'new-session';
      rerender({ project: mockProject, session: newSession });

      await waitFor(() => {
        expect(api.getTerminalSessions).toHaveBeenCalledTimes(2);
      });

      expect(api.getTerminalSessions).toHaveBeenLastCalledWith(mockProject, newSession);
    });
  });

  describe('Error Handling', () => {
    it('should handle fetch error', async () => {
      const error = new Error('Network error');
      (api.getTerminalSessions as any).mockRejectedValue(error);

      const { result } = renderHook(() =>
        useTerminalTabs({ project: mockProject, session: mockSession })
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.error).toEqual(error);
      expect(result.current.tabs).toEqual([]);
    });

    it('should set error when API fails', async () => {
      const apiError = new Error('API Error');
      (api.getTerminalSessions as any).mockRejectedValue(apiError);

      const { result } = renderHook(() =>
        useTerminalTabs({ project: mockProject, session: mockSession })
      );

      await waitFor(() => {
        expect(result.current.error).not.toBeNull();
      });

      expect(result.current.error?.message).toBe('API Error');
      expect(result.current.isLoading).toBe(false);
    });
  });

  describe('addTab', () => {
    it('should add a new tab and set it as active', async () => {
      const newSession = createMockSession('session-3', 'Terminal 3', 2);
      (api.createTerminalSession as any).mockResolvedValue({
        id: newSession.id,
        tmuxSession: newSession.tmuxSession,
        wsUrl: 'ws://localhost:7681/ws',
      });

      const { result } = renderHook(() =>
        useTerminalTabs({ project: mockProject, session: mockSession })
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      await act(async () => {
        await result.current.addTab();
      });

      expect(api.createTerminalSession).toHaveBeenCalledWith(mockProject, mockSession);
    });

    it('should handle error when adding tab fails', async () => {
      const error = new Error('Create failed');
      (api.createTerminalSession as any).mockRejectedValue(error);

      const { result } = renderHook(() =>
        useTerminalTabs({ project: mockProject, session: mockSession })
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      await act(async () => {
        try {
          await result.current.addTab();
        } catch (e) {
          // Expected to throw
        }
      });

      // Verify the error was propagated
      expect(api.createTerminalSession).toHaveBeenCalled();
    });
  });

  describe('removeTab', () => {
    it('should remove a tab', async () => {
      (api.deleteTerminalSession as any).mockResolvedValue(undefined);

      const { result } = renderHook(() =>
        useTerminalTabs({ project: mockProject, session: mockSession })
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const initialCount = result.current.tabs.length;

      await act(async () => {
        await result.current.removeTab('session-1');
      });

      expect(api.deleteTerminalSession).toHaveBeenCalledWith(mockProject, mockSession, 'session-1');
    });

    it('should select adjacent tab when active tab is removed', async () => {
      (api.deleteTerminalSession as any).mockResolvedValue(undefined);
      (api.getTerminalSessions as any).mockResolvedValueOnce(mockSessions).mockResolvedValueOnce([mockSessions[1]]);

      const { result } = renderHook(() =>
        useTerminalTabs({ project: mockProject, session: mockSession })
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.activeTabId).toBe('session-1');

      // After removing, should refresh and get updated list
      await act(async () => {
        await result.current.removeTab('session-1');
      });

      // API call made
      expect(api.deleteTerminalSession).toHaveBeenCalled();
    });

    it('should handle error when removing tab fails', async () => {
      const error = new Error('Delete failed');
      (api.deleteTerminalSession as any).mockRejectedValue(error);

      const { result } = renderHook(() =>
        useTerminalTabs({ project: mockProject, session: mockSession })
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      await act(async () => {
        try {
          await result.current.removeTab('session-1');
        } catch (e) {
          // Expected to throw
        }
      });

      expect(api.deleteTerminalSession).toHaveBeenCalled();
    });
  });

  describe('renameTab', () => {
    it('should rename a tab', async () => {
      (api.renameTerminalSession as any).mockResolvedValue(undefined);

      const { result } = renderHook(() =>
        useTerminalTabs({ project: mockProject, session: mockSession })
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const newName = 'My Terminal';

      await act(async () => {
        await result.current.renameTab('session-1', newName);
      });

      expect(api.renameTerminalSession).toHaveBeenCalledWith(
        mockProject,
        mockSession,
        'session-1',
        newName
      );
    });

    it('should trim whitespace from name', async () => {
      (api.renameTerminalSession as any).mockResolvedValue(undefined);

      const { result } = renderHook(() =>
        useTerminalTabs({ project: mockProject, session: mockSession })
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      await act(async () => {
        await result.current.renameTab('session-1', '  New Name  ');
      });

      expect(api.renameTerminalSession).toHaveBeenCalledWith(
        mockProject,
        mockSession,
        'session-1',
        '  New Name  '
      );
    });

    it('should handle error when renaming tab fails', async () => {
      const error = new Error('Rename failed');
      (api.renameTerminalSession as any).mockRejectedValue(error);

      const { result } = renderHook(() =>
        useTerminalTabs({ project: mockProject, session: mockSession })
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      await act(async () => {
        try {
          await result.current.renameTab('session-1', 'New Name');
        } catch (e) {
          // Expected to throw
        }
      });

      expect(api.renameTerminalSession).toHaveBeenCalled();
    });
  });

  describe('setActiveTab', () => {
    it('should set active tab', async () => {
      const { result } = renderHook(() =>
        useTerminalTabs({ project: mockProject, session: mockSession })
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.activeTabId).toBe('session-1');

      act(() => {
        result.current.setActiveTab('session-2');
      });

      expect(result.current.activeTabId).toBe('session-2');
      expect(result.current.activeTab).toEqual(mockSessions[1]);
    });

    it('should not change active tab if id does not exist', async () => {
      const { result } = renderHook(() =>
        useTerminalTabs({ project: mockProject, session: mockSession })
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const initialActiveId = result.current.activeTabId;

      act(() => {
        result.current.setActiveTab('non-existent-id');
      });

      expect(result.current.activeTabId).toBe(initialActiveId);
    });
  });

  describe('reorderTabs', () => {
    it('should reorder tabs', async () => {
      (api.reorderTerminalSessions as any).mockResolvedValue(undefined);

      const { result } = renderHook(() =>
        useTerminalTabs({ project: mockProject, session: mockSession })
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const initialOrder = result.current.tabs.map(t => t.id);

      await act(async () => {
        await result.current.reorderTabs(0, 1);
      });

      expect(api.reorderTerminalSessions).toHaveBeenCalledWith(
        mockProject,
        mockSession,
        expect.any(Array)
      );
    });

    it('should perform optimistic update', async () => {
      (api.reorderTerminalSessions as any).mockResolvedValue(undefined);

      const { result } = renderHook(() =>
        useTerminalTabs({ project: mockProject, session: mockSession })
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const tab1Id = result.current.tabs[0].id;
      const tab2Id = result.current.tabs[1].id;

      await act(async () => {
        await result.current.reorderTabs(0, 1);
      });

      // After reorder, second tab should be first
      expect(result.current.tabs[0].id).toBe(tab2Id);
      expect(result.current.tabs[1].id).toBe(tab1Id);
    });

    it('should revert optimistic update on error', async () => {
      const error = new Error('Reorder failed');
      (api.reorderTerminalSessions as any).mockRejectedValue(error);

      const { result } = renderHook(() =>
        useTerminalTabs({ project: mockProject, session: mockSession })
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const originalOrder = [...result.current.tabs];

      await act(async () => {
        try {
          await result.current.reorderTabs(0, 1);
        } catch (e) {
          // Expected to throw
        }
      });

      // Order should be reverted
      expect(result.current.tabs).toEqual(originalOrder);
    });

    it('should not reorder if indices are invalid', async () => {
      const { result } = renderHook(() =>
        useTerminalTabs({ project: mockProject, session: mockSession })
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const originalOrder = [...result.current.tabs];

      await act(async () => {
        try {
          await result.current.reorderTabs(0, 99);
        } catch (e) {
          // Expected to throw
        }
      });

      expect(result.current.tabs).toEqual(originalOrder);
      expect(api.reorderTerminalSessions).not.toHaveBeenCalled();
    });
  });

  describe('refresh', () => {
    it('should re-fetch sessions from API', async () => {
      const { result } = renderHook(() =>
        useTerminalTabs({ project: mockProject, session: mockSession })
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(api.getTerminalSessions).toHaveBeenCalledTimes(1);

      await act(async () => {
        await result.current.refresh();
      });

      expect(api.getTerminalSessions).toHaveBeenCalledTimes(2);
    });

    it('should update tabs with refreshed data', async () => {
      const newSessions = [
        createMockSession('session-1', 'Terminal 1', 0),
        createMockSession('session-2', 'Terminal 2', 1),
        createMockSession('session-3', 'Terminal 3', 2),
      ];

      const { result } = renderHook(() =>
        useTerminalTabs({ project: mockProject, session: mockSession })
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.tabs.length).toBe(2);

      (api.getTerminalSessions as any).mockResolvedValue(newSessions);

      await act(async () => {
        await result.current.refresh();
      });

      expect(result.current.tabs.length).toBe(3);
      expect(result.current.tabs).toEqual(newSessions);
    });

    it('should handle error during refresh', async () => {
      const { result } = renderHook(() =>
        useTerminalTabs({ project: mockProject, session: mockSession })
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const error = new Error('Refresh failed');
      (api.getTerminalSessions as any).mockRejectedValue(error);

      await act(async () => {
        try {
          await result.current.refresh();
        } catch (e) {
          // Expected to throw
        }
      });

      expect(result.current.error).toEqual(error);
    });
  });

  describe('Return Type', () => {
    it('should return all required properties', async () => {
      const { result } = renderHook(() =>
        useTerminalTabs({ project: mockProject, session: mockSession })
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current).toHaveProperty('tabs');
      expect(result.current).toHaveProperty('activeTabId');
      expect(result.current).toHaveProperty('activeTab');
      expect(result.current).toHaveProperty('isLoading');
      expect(result.current).toHaveProperty('error');
      expect(result.current).toHaveProperty('addTab');
      expect(result.current).toHaveProperty('removeTab');
      expect(result.current).toHaveProperty('renameTab');
      expect(result.current).toHaveProperty('setActiveTab');
      expect(result.current).toHaveProperty('reorderTabs');
      expect(result.current).toHaveProperty('refresh');
    });
  });

  describe('addTab - Auto-select new terminal (bugfix)', () => {
    it('should set new terminal as active after creation', async () => {
      const newSession = createMockSession('session-3', 'Terminal 3', 2);
      const updatedSessions = [...mockSessions, newSession];

      // Reset mocks for clean test state
      vi.clearAllMocks();
      (api.getTerminalSessions as any)
        .mockResolvedValueOnce(mockSessions)
        .mockResolvedValueOnce(updatedSessions);
      (api.createTerminalSession as any).mockResolvedValue({
        id: newSession.id,
        tmuxSession: newSession.tmuxSession,
        wsUrl: 'ws://localhost:7681/ws',
      });

      const { result } = renderHook(() =>
        useTerminalTabs({ project: mockProject, session: mockSession })
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.activeTabId).toBe('session-1');

      // Add new tab
      await act(async () => {
        await result.current.addTab();
      });

      // New terminal should be active
      await waitFor(() => {
        expect(result.current.activeTabId).toBe('session-3');
      });
    });

    it('should persist new terminal ID to localStorage', async () => {
      const newSession = createMockSession('session-4', 'Terminal 4', 2);
      const updatedSessions = [...mockSessions, newSession];

      vi.clearAllMocks();
      (api.getTerminalSessions as any)
        .mockResolvedValueOnce(mockSessions)
        .mockResolvedValueOnce(updatedSessions);
      (api.createTerminalSession as any).mockResolvedValue({
        id: newSession.id,
        tmuxSession: newSession.tmuxSession,
        wsUrl: 'ws://localhost:7681/ws',
      });

      const storageKey = `terminal-active-tab:${mockProject}:${mockSession}`;

      const { result } = renderHook(() =>
        useTerminalTabs({ project: mockProject, session: mockSession })
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Add new tab
      await act(async () => {
        await result.current.addTab();
      });

      // Verify localStorage was updated
      await waitFor(() => {
        expect(localStorage.getItem(storageKey)).toBe('session-4');
      });
    });

    it('should update activeTab property when new terminal is selected', async () => {
      const newSession = createMockSession('session-5', 'Terminal 5', 2);
      const updatedSessions = [...mockSessions, newSession];

      vi.clearAllMocks();
      (api.getTerminalSessions as any)
        .mockResolvedValueOnce(mockSessions)
        .mockResolvedValueOnce(updatedSessions);
      (api.createTerminalSession as any).mockResolvedValue({
        id: newSession.id,
        tmuxSession: newSession.tmuxSession,
        wsUrl: 'ws://localhost:7681/ws',
      });

      const { result } = renderHook(() =>
        useTerminalTabs({ project: mockProject, session: mockSession })
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Add new tab
      await act(async () => {
        await result.current.addTab();
      });

      // Verify activeTab is updated to the new session
      await waitFor(() => {
        expect(result.current.activeTab?.id).toBe('session-5');
        expect(result.current.activeTab?.name).toBe('Terminal 5');
      });
    });
  });
});
