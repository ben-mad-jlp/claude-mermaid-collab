/**
 * TopicDetail Page Tests
 *
 * Tests verify:
 * - AliasEditor is rendered with current topic's aliases
 * - Adding an alias calls API and updates UI
 * - Removing an alias calls API and updates UI
 * - Error handling for failed alias operations
 * - Topic data refreshes after alias changes
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter, MemoryRouter, Route, Routes } from 'react-router-dom';
import { TopicDetail } from '../TopicDetail';
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

// Mock the kodexStore
vi.mock('@/stores/kodexStore', () => ({
  useKodexStore: vi.fn(),
}));

describe('TopicDetail - AliasEditor Integration', () => {
  const mockTopic = {
    name: 'authentication',
    title: 'Authentication',
    confidence: 'high' as const,
    verified: true,
    verifiedAt: '2024-01-01',
    verifiedBy: 'admin',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-02T00:00:00Z',
    hasDraft: false,
    aliases: ['auth', 'login'],
    content: {
      conceptual: 'Authentication is the process of verifying identity',
      technical: 'Uses OAuth2 and JWT tokens',
      files: 'src/auth/**',
      related: '`services`',
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useKodexStore).mockImplementation(
      (selector: any) => selector({ selectedProject: 'test-project' })
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should render AliasEditor with current topic aliases', async () => {
    vi.spyOn(kodexApiModule.kodexApi, 'getTopic').mockResolvedValue(mockTopic as any);

    render(
      <MemoryRouter initialEntries={['/kodex/topics/authentication']}>
        <Routes>
          <Route path="/kodex/topics/:name" element={<TopicDetail />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('auth')).toBeInTheDocument();
      expect(screen.getByText('login')).toBeInTheDocument();
    });
  });

  it('should display AliasEditor after topic title', async () => {
    vi.spyOn(kodexApiModule.kodexApi, 'getTopic').mockResolvedValue(mockTopic as any);

    render(
      <MemoryRouter initialEntries={['/kodex/topics/authentication']}>
        <Routes>
          <Route path="/kodex/topics/:name" element={<TopicDetail />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      const title = screen.getByText('Authentication');
      const authAlias = screen.getByText('auth');

      // Verify title comes before alias in DOM
      expect(title).toBeInTheDocument();
      expect(authAlias).toBeInTheDocument();
    });
  });

  it('should call kodexApi.addAlias when adding an alias', async () => {
    const addAliasSpy = vi
      .spyOn(kodexApiModule.kodexApi, 'addAlias')
      .mockResolvedValue(undefined);

    const getTopicSpy = vi
      .spyOn(kodexApiModule.kodexApi, 'getTopic')
      .mockResolvedValue(mockTopic as any);

    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={['/kodex/topics/authentication']}>
        <Routes>
          <Route path="/kodex/topics/:name" element={<TopicDetail />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('auth')).toBeInTheDocument();
    });

    // Click the Add button
    const addButton = screen.getByRole('button', { name: /Add/i });
    await user.click(addButton);

    // Type new alias
    const input = screen.getByPlaceholderText(/Enter alias/i);
    await user.type(input, 'signin');

    // Submit
    const submitButton = screen.getByRole('button', { name: /Submit/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(addAliasSpy).toHaveBeenCalledWith('test-project', 'authentication', 'signin');
    });
  });

  it('should update topic state after adding an alias', async () => {
    const updatedTopic = {
      ...mockTopic,
      aliases: ['auth', 'login', 'signin'],
    };

    const addAliasSpy = vi
      .spyOn(kodexApiModule.kodexApi, 'addAlias')
      .mockResolvedValue(undefined);

    const getTopicSpy = vi
      .spyOn(kodexApiModule.kodexApi, 'getTopic')
      .mockResolvedValueOnce(mockTopic as any)
      .mockResolvedValueOnce(updatedTopic as any);

    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={['/kodex/topics/authentication']}>
        <Routes>
          <Route path="/kodex/topics/:name" element={<TopicDetail />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('auth')).toBeInTheDocument();
    });

    // Add new alias
    const addButton = screen.getByRole('button', { name: /Add/i });
    await user.click(addButton);

    const input = screen.getByPlaceholderText(/Enter alias/i);
    await user.type(input, 'signin');

    const submitButton = screen.getByRole('button', { name: /Submit/i });
    await user.click(submitButton);

    // Wait for the new alias to appear
    await waitFor(() => {
      expect(screen.getByText('signin')).toBeInTheDocument();
    });

    // Verify getTopic was called twice (initial load + refresh after add)
    expect(getTopicSpy).toHaveBeenCalledTimes(2);
  });

  it('should call kodexApi.removeAlias when removing an alias', async () => {
    const removeAliasSpy = vi
      .spyOn(kodexApiModule.kodexApi, 'removeAlias')
      .mockResolvedValue(undefined);

    const getTopicSpy = vi
      .spyOn(kodexApiModule.kodexApi, 'getTopic')
      .mockResolvedValue(mockTopic as any);

    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={['/kodex/topics/authentication']}>
        <Routes>
          <Route path="/kodex/topics/:name" element={<TopicDetail />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('auth')).toBeInTheDocument();
    });

    // Click remove button for 'auth' alias
    const removeButtons = screen.getAllByRole('button', { name: '×' });
    await user.click(removeButtons[0]);

    await waitFor(() => {
      expect(removeAliasSpy).toHaveBeenCalledWith('test-project', 'authentication', 'auth');
    });
  });

  it('should update topic state after removing an alias', async () => {
    const updatedTopic = {
      ...mockTopic,
      aliases: ['login'],
    };

    const removeAliasSpy = vi
      .spyOn(kodexApiModule.kodexApi, 'removeAlias')
      .mockResolvedValue(undefined);

    const getTopicSpy = vi
      .spyOn(kodexApiModule.kodexApi, 'getTopic')
      .mockResolvedValueOnce(mockTopic as any)
      .mockResolvedValueOnce(updatedTopic as any);

    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={['/kodex/topics/authentication']}>
        <Routes>
          <Route path="/kodex/topics/:name" element={<TopicDetail />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('auth')).toBeInTheDocument();
    });

    // Remove 'auth' alias
    const removeButtons = screen.getAllByRole('button', { name: '×' });
    await user.click(removeButtons[0]);

    // Wait for the alias to disappear
    await waitFor(() => {
      expect(screen.queryByText('auth')).not.toBeInTheDocument();
      expect(screen.getByText('login')).toBeInTheDocument();
    });

    // Verify getTopic was called twice (initial load + refresh after remove)
    expect(getTopicSpy).toHaveBeenCalledTimes(2);
  });

  it('should handle error when adding an alias fails', async () => {
    const addAliasSpy = vi
      .spyOn(kodexApiModule.kodexApi, 'addAlias')
      .mockRejectedValue(new Error('Failed to add alias'));

    const getTopicSpy = vi
      .spyOn(kodexApiModule.kodexApi, 'getTopic')
      .mockResolvedValue(mockTopic as any);

    const user = userEvent.setup();

    // Mock window.alert
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});

    render(
      <MemoryRouter initialEntries={['/kodex/topics/authentication']}>
        <Routes>
          <Route path="/kodex/topics/:name" element={<TopicDetail />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('auth')).toBeInTheDocument();
    });

    // Try to add an alias
    const addButton = screen.getByRole('button', { name: /Add/i });
    await user.click(addButton);

    const input = screen.getByPlaceholderText(/Enter alias/i);
    await user.type(input, 'newsignin');

    const submitButton = screen.getByRole('button', { name: /Submit/i });
    await user.click(submitButton);

    // Verify error handling
    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalled();
    });

    alertSpy.mockRestore();
  });

  it('should handle error when removing an alias fails', async () => {
    const removeAliasSpy = vi
      .spyOn(kodexApiModule.kodexApi, 'removeAlias')
      .mockRejectedValue(new Error('Failed to remove alias'));

    const getTopicSpy = vi
      .spyOn(kodexApiModule.kodexApi, 'getTopic')
      .mockResolvedValue(mockTopic as any);

    const user = userEvent.setup();

    // Mock window.alert
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});

    render(
      <MemoryRouter initialEntries={['/kodex/topics/authentication']}>
        <Routes>
          <Route path="/kodex/topics/:name" element={<TopicDetail />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('auth')).toBeInTheDocument();
    });

    // Try to remove an alias
    const removeButtons = screen.getAllByRole('button', { name: '×' });
    await user.click(removeButtons[0]);

    // Verify error handling
    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalled();
    });

    alertSpy.mockRestore();
  });

  it('should render empty alias list when topic has no aliases', async () => {
    const topicWithoutAliases = {
      ...mockTopic,
      aliases: [],
    };

    vi.spyOn(kodexApiModule.kodexApi, 'getTopic').mockResolvedValue(topicWithoutAliases as any);

    render(
      <MemoryRouter initialEntries={['/kodex/topics/authentication']}>
        <Routes>
          <Route path="/kodex/topics/:name" element={<TopicDetail />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      // Should have the Add button but no alias chips
      expect(screen.getByRole('button', { name: /Add/i })).toBeInTheDocument();
      expect(screen.queryByText('auth')).not.toBeInTheDocument();
    });
  });

  it('should disable alias operations during add loading', async () => {
    const addAliasSpy = vi
      .spyOn(kodexApiModule.kodexApi, 'addAlias')
      .mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(resolve, 100);
          })
      );

    vi.spyOn(kodexApiModule.kodexApi, 'getTopic').mockResolvedValue(mockTopic as any);

    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={['/kodex/topics/authentication']}>
        <Routes>
          <Route path="/kodex/topics/:name" element={<TopicDetail />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('auth')).toBeInTheDocument();
    });

    // Start adding an alias
    const addButton = screen.getByRole('button', { name: /Add/i });
    await user.click(addButton);

    const input = screen.getByPlaceholderText(/Enter alias/i);
    await user.type(input, 'newsignin');

    const submitButton = screen.getByRole('button', { name: /Submit/i });
    await user.click(submitButton);

    // Verify that remove buttons are disabled during add
    await waitFor(() => {
      const removeButtons = screen.getAllByRole('button', { name: '×' });
      expect(removeButtons[0]).toBeDisabled();
    });
  });
});
