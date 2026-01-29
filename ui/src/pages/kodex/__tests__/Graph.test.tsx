/**
 * Graph Page Tests
 *
 * Tests verify:
 * - Loading state on mount
 * - Successful data fetch and graph generation
 * - Error handling for failed fetch
 * - Graph rendering with Mermaid syntax
 * - Navigation on node click
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import { Graph } from '../Graph';
import * as kodexApiModule from '@/lib/kodex-api';
import { useKodexStore } from '@/stores/kodexStore';

// Mock useNavigate
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// Mock DiagramEmbed component
vi.mock('@/components/ai-ui/mermaid', () => ({
  DiagramEmbed: ({ content, onNodeClick }: any) => (
    <div data-testid="diagram-embed">
      <div data-testid="diagram-content">{content}</div>
      {onNodeClick && (
        <button
          data-testid="test-node-button"
          onClick={() => onNodeClick('test-topic')}
        >
          Test Node
        </button>
      )}
    </div>
  ),
}));

describe('Graph Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should show loading spinner on mount', async () => {
    // Mock the API to never resolve
    vi.spyOn(kodexApiModule, 'kodexApi', 'get').mockReturnValue({
      listTopicsWithContent: vi.fn(() => new Promise(() => {})),
    } as any);

    // Mock store to have a selected project
    vi.spyOn(useKodexStore, 'getState', 'get').mockReturnValue({
      selectedProject: 'test-project',
    } as any);

    render(
      <BrowserRouter>
        <Graph />
      </BrowserRouter>
    );

    // Look for loading indicator
    expect(screen.getByText(/loading|rendering/i)).toBeInTheDocument();
  });

  it('should fetch topics with content on mount', async () => {
    const mockListTopicsWithContent = vi.fn().mockResolvedValue([]);

    vi.spyOn(kodexApiModule, 'kodexApi', 'get').mockReturnValue({
      listTopicsWithContent: mockListTopicsWithContent,
    } as any);

    vi.spyOn(useKodexStore, 'getState', 'get').mockReturnValue({
      selectedProject: 'test-project',
    } as any);

    render(
      <BrowserRouter>
        <Graph />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(mockListTopicsWithContent).toHaveBeenCalledWith('test-project');
    });
  });

  it('should display error message on fetch failure', async () => {
    const mockError = new Error('Network error');
    vi.spyOn(kodexApiModule, 'kodexApi', 'get').mockReturnValue({
      listTopicsWithContent: vi.fn().mockRejectedValue(mockError),
    } as any);

    vi.spyOn(useKodexStore, 'getState', 'get').mockReturnValue({
      selectedProject: 'test-project',
    } as any);

    render(
      <BrowserRouter>
        <Graph />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/error|failed/i)).toBeInTheDocument();
    });
  });

  it('should generate Mermaid graph with fetched topics', async () => {
    const mockTopics = [
      {
        name: 'auth',
        title: 'Authentication',
        content: {
          related: '- `services`',
        },
      },
      {
        name: 'services',
        title: 'Services',
        content: {
          related: '- `auth`',
        },
      },
    ];

    vi.spyOn(kodexApiModule, 'kodexApi', 'get').mockReturnValue({
      listTopicsWithContent: vi.fn().mockResolvedValue(mockTopics),
    } as any);

    vi.spyOn(useKodexStore, 'getState', 'get').mockReturnValue({
      selectedProject: 'test-project',
    } as any);

    render(
      <BrowserRouter>
        <Graph />
      </BrowserRouter>
    );

    await waitFor(() => {
      const diagramContent = screen.getByTestId('diagram-content');
      const content = diagramContent.textContent;

      // Verify Mermaid syntax is generated
      expect(content).toContain('graph LR');
      expect(content).toContain('auth["Authentication"]');
      expect(content).toContain('services["Services"]');
      expect(content).toContain('auth --> services');
    });
  });

  it('should render DiagramEmbed component with generated content', async () => {
    const mockTopics = [
      {
        name: 'topic-a',
        title: 'Topic A',
        content: {
          related: '- `topic-b`',
        },
      },
      {
        name: 'topic-b',
        title: 'Topic B',
        content: {
          related: '',
        },
      },
    ];

    vi.spyOn(kodexApiModule, 'kodexApi', 'get').mockReturnValue({
      listTopicsWithContent: vi.fn().mockResolvedValue(mockTopics),
    } as any);

    vi.spyOn(useKodexStore, 'getState', 'get').mockReturnValue({
      selectedProject: 'test-project',
    } as any);

    render(
      <BrowserRouter>
        <Graph />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('diagram-embed')).toBeInTheDocument();
    });
  });

  it('should navigate to topic detail on node click', async () => {
    const mockTopics = [
      {
        name: 'auth',
        title: 'Authentication',
        content: {
          related: '- `services`',
        },
      },
      {
        name: 'services',
        title: 'Services',
        content: {
          related: '- `auth`',
        },
      },
    ];

    vi.spyOn(kodexApiModule, 'kodexApi', 'get').mockReturnValue({
      listTopicsWithContent: vi.fn().mockResolvedValue(mockTopics),
    } as any);

    vi.spyOn(useKodexStore, 'getState', 'get').mockReturnValue({
      selectedProject: 'test-project',
    } as any);

    render(
      <BrowserRouter>
        <Graph />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('test-node-button')).toBeInTheDocument();
    });

    const button = screen.getByTestId('test-node-button');
    await userEvent.click(button);

    expect(mockNavigate).toHaveBeenCalledWith('/kodex/topics/test-topic');
  });

  it('should handle empty graph (no topics with relationships)', async () => {
    const mockTopics = [
      {
        name: 'orphan-topic',
        title: 'Orphan Topic',
        content: {
          related: '',
        },
      },
    ];

    vi.spyOn(kodexApiModule, 'kodexApi', 'get').mockReturnValue({
      listTopicsWithContent: vi.fn().mockResolvedValue(mockTopics),
    } as any);

    vi.spyOn(useKodexStore, 'getState', 'get').mockReturnValue({
      selectedProject: 'test-project',
    } as any);

    render(
      <BrowserRouter>
        <Graph />
      </BrowserRouter>
    );

    await waitFor(() => {
      const diagramContent = screen.getByTestId('diagram-content');
      const content = diagramContent.textContent;

      // Should still render valid Mermaid, just with no nodes/edges
      expect(content).toContain('graph LR');
    });
  });

  it('should not fetch if no project is selected', async () => {
    const mockListTopicsWithContent = vi.fn();

    vi.spyOn(kodexApiModule, 'kodexApi', 'get').mockReturnValue({
      listTopicsWithContent: mockListTopicsWithContent,
    } as any);

    vi.spyOn(useKodexStore, 'getState', 'get').mockReturnValue({
      selectedProject: null,
    } as any);

    render(
      <BrowserRouter>
        <Graph />
      </BrowserRouter>
    );

    // Wait a bit to ensure no fetch is made
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(mockListTopicsWithContent).not.toHaveBeenCalled();
  });

  it('should display page title', async () => {
    const mockTopics: any[] = [];

    vi.spyOn(kodexApiModule, 'kodexApi', 'get').mockReturnValue({
      listTopicsWithContent: vi.fn().mockResolvedValue(mockTopics),
    } as any);

    vi.spyOn(useKodexStore, 'getState', 'get').mockReturnValue({
      selectedProject: 'test-project',
    } as any);

    render(
      <BrowserRouter>
        <Graph />
      </BrowserRouter>
    );

    expect(screen.getByText(/topic.*graph/i)).toBeInTheDocument();
  });
});
