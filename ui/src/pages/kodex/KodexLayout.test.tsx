import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { KodexLayout } from './KodexLayout';
import { useKodexStore } from '@/stores/kodexStore';
import { useSessionStore } from '@/stores/sessionStore';
import * as React from 'react';

// Mock the components
vi.mock('@/components/kodex/KodexSidebar', () => ({
  KodexSidebar: () => <div data-testid="kodex-sidebar">Sidebar</div>,
}));

vi.mock('@/components/kodex/ProjectSelector', () => ({
  ProjectSelector: ({ className }: { className?: string }) => (
    <div data-testid="project-selector" className={className}>
      Project Selector
    </div>
  ),
}));

vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    theme: 'light',
    toggleTheme: vi.fn(),
  }),
}));

// Mock react-router-dom Outlet
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    Outlet: () => <div data-testid="outlet">Outlet Content</div>,
  };
});

describe('KodexLayout', () => {
  beforeEach(() => {
    // Reset stores before each test
    useKodexStore.setState({
      selectedProject: null,
      projects: [],
      isLoadingProjects: false,
      projectsError: null,
    });

    useSessionStore.setState({
      currentSession: null,
    });

    vi.clearAllMocks();
  });

  it('renders the layout with sidebar, header, and outlet', () => {
    render(
      <BrowserRouter>
        <KodexLayout />
      </BrowserRouter>
    );

    expect(screen.getByTestId('kodex-sidebar')).toBeInTheDocument();
    expect(screen.getByTestId('outlet')).toBeInTheDocument();
  });

  it('renders ProjectSelector in the header', () => {
    render(
      <BrowserRouter>
        <KodexLayout />
      </BrowserRouter>
    );

    expect(screen.getByTestId('project-selector')).toBeInTheDocument();
  });

  it('calls fetchProjects on mount', async () => {
    const fetchProjects = vi.fn();
    useKodexStore.setState({ fetchProjects });

    render(
      <BrowserRouter>
        <KodexLayout />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(fetchProjects).toHaveBeenCalled();
    });
  });

  it('sets default project from session on mount if no project selected', async () => {
    const setSelectedProject = vi.fn();
    const fetchProjects = vi.fn();

    useKodexStore.setState({
      setSelectedProject,
      fetchProjects,
      selectedProject: null,
    });

    useSessionStore.setState({
      currentSession: {
        id: 'session-1',
        name: 'Test Session',
        project: '/path/to/project',
        phase: 'exploring',
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
      } as any,
    });

    render(
      <BrowserRouter>
        <KodexLayout />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(setSelectedProject).toHaveBeenCalledWith('/path/to/project');
    });
  });

  it('does not change project if one is already selected', async () => {
    const setSelectedProject = vi.fn();
    const fetchProjects = vi.fn();

    useKodexStore.setState({
      setSelectedProject,
      fetchProjects,
      selectedProject: '/existing/project',
    });

    useSessionStore.setState({
      currentSession: {
        id: 'session-1',
        name: 'Test Session',
        project: '/path/to/project',
        phase: 'exploring',
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
      } as any,
    });

    render(
      <BrowserRouter>
        <KodexLayout />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(setSelectedProject).not.toHaveBeenCalled();
    });
  });

  it('does not set project if session does not have one', async () => {
    const setSelectedProject = vi.fn();
    const fetchProjects = vi.fn();

    useKodexStore.setState({
      setSelectedProject,
      fetchProjects,
      selectedProject: null,
    });

    useSessionStore.setState({
      currentSession: {
        id: 'session-1',
        name: 'Test Session',
        project: null,
        phase: 'exploring',
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
      } as any,
    });

    render(
      <BrowserRouter>
        <KodexLayout />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(setSelectedProject).not.toHaveBeenCalled();
    });
  });

  it('renders theme toggle button', () => {
    render(
      <BrowserRouter>
        <KodexLayout />
      </BrowserRouter>
    );

    // Should have a button for theme toggle
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThan(0);
  });

  it('has Kodex label in header', () => {
    render(
      <BrowserRouter>
        <KodexLayout />
      </BrowserRouter>
    );

    expect(screen.getByText('Kodex')).toBeInTheDocument();
  });

  it('only calls setSelectedProject once even with multiple renders', async () => {
    const setSelectedProject = vi.fn();
    const fetchProjects = vi.fn();

    useKodexStore.setState({
      setSelectedProject,
      fetchProjects,
      selectedProject: null,
    });

    useSessionStore.setState({
      currentSession: {
        id: 'session-1',
        name: 'Test Session',
        project: '/path/to/project',
        phase: 'exploring',
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
      } as any,
    });

    const { rerender } = render(
      <BrowserRouter>
        <KodexLayout />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(setSelectedProject).toHaveBeenCalledTimes(1);
    });

    // Rerender should not call setSelectedProject again
    rerender(
      <BrowserRouter>
        <KodexLayout />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(setSelectedProject).toHaveBeenCalledTimes(1);
    });
  });
});
