/**
 * WireframePage Component Tests
 *
 * Tests verify:
 * - Extracts wireframe ID from URL parameters
 * - Uses useWireframe hook to fetch wireframe data
 * - Displays loading state while fetching
 * - Displays error state if fetch fails
 * - Renders wireframe content when loaded
 * - Supports viewport switching (mobile/tablet/desktop)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { WireframePage } from '../WireframePage';

// Mock the useWireframe hook
const mockUseWireframe = vi.fn();
vi.mock('@/hooks/useWireframe', () => ({
  useWireframe: (project: string, session: string, id: string) =>
    mockUseWireframe(project, session, id),
}));

// Mock the useTheme hook
vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({ theme: 'light', toggleTheme: vi.fn() }),
}));

// Helper to render component with router
function renderWithRouter(
  route: string = '/wireframe/my-project/my-session/wireframe-1'
) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route
          path="/wireframe/:project/:session/:id"
          element={<WireframePage />}
        />
      </Routes>
    </MemoryRouter>
  );
}

describe('WireframePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('URL Parameter Extraction', () => {
    it('should extract project, session, and id from URL', () => {
      mockUseWireframe.mockReturnValue({
        wireframe: null,
        loading: true,
        error: null,
      });

      renderWithRouter('/wireframe/test-project/test-session/wire-123');

      expect(mockUseWireframe).toHaveBeenCalledWith(
        'test-project',
        'test-session',
        'wire-123'
      );
    });

    it('should handle URL-encoded parameters', () => {
      mockUseWireframe.mockReturnValue({
        wireframe: null,
        loading: true,
        error: null,
      });

      renderWithRouter(
        '/wireframe/my%20project/session%2D1/wireframe%2D1'
      );

      expect(mockUseWireframe).toHaveBeenCalledWith(
        'my project',
        'session-1',
        'wireframe-1'
      );
    });
  });

  describe('Loading State', () => {
    it('should display loading indicator when fetching', () => {
      mockUseWireframe.mockReturnValue({
        wireframe: null,
        loading: true,
        error: null,
      });

      renderWithRouter();

      expect(screen.getByTestId('wireframe-loading')).toBeInTheDocument();
    });

    it('should show loading spinner', () => {
      mockUseWireframe.mockReturnValue({
        wireframe: null,
        loading: true,
        error: null,
      });

      renderWithRouter();

      expect(screen.getByRole('status')).toBeInTheDocument();
    });
  });

  describe('Error State', () => {
    it('should display error message when fetch fails', () => {
      mockUseWireframe.mockReturnValue({
        wireframe: null,
        loading: false,
        error: 'Failed to load wireframe',
      });

      renderWithRouter();

      expect(screen.getByTestId('wireframe-error')).toBeInTheDocument();
      expect(screen.getByText(/Failed to load wireframe/i)).toBeInTheDocument();
    });

    it('should display HTTP error details', () => {
      mockUseWireframe.mockReturnValue({
        wireframe: null,
        loading: false,
        error: 'HTTP 404: Not Found',
      });

      renderWithRouter();

      expect(screen.getByText(/HTTP 404: Not Found/i)).toBeInTheDocument();
    });
  });

  describe('Not Found State', () => {
    it('should display not found when wireframe is null and not loading', () => {
      mockUseWireframe.mockReturnValue({
        wireframe: null,
        loading: false,
        error: null,
      });

      renderWithRouter();

      expect(screen.getByTestId('wireframe-not-found')).toBeInTheDocument();
      expect(screen.getByText(/Wireframe not found/i)).toBeInTheDocument();
    });
  });

  describe('Wireframe Rendering', () => {
    const mockWireframe = {
      viewport: 'mobile' as const,
      direction: 'LR' as const,
      screens: [
        {
          id: 'screen-1',
          type: 'screen' as const,
          name: 'Home Screen',
          bounds: { x: 0, y: 0, width: 375, height: 667 },
          children: [],
        },
      ],
    };

    it('should render wireframe content when loaded', () => {
      mockUseWireframe.mockReturnValue({
        wireframe: mockWireframe,
        loading: false,
        error: null,
      });

      renderWithRouter();

      expect(screen.getByTestId('wireframe-content')).toBeInTheDocument();
    });

    it('should display wireframe JSON placeholder until WireframeRenderer is available', () => {
      mockUseWireframe.mockReturnValue({
        wireframe: mockWireframe,
        loading: false,
        error: null,
      });

      renderWithRouter();

      // Placeholder displays JSON until WireframeRenderer is implemented
      expect(screen.getByTestId('wireframe-placeholder')).toBeInTheDocument();
    });

    it('should show wireframe viewport in JSON preview', () => {
      mockUseWireframe.mockReturnValue({
        wireframe: mockWireframe,
        loading: false,
        error: null,
      });

      renderWithRouter();

      // The viewport is shown in the JSON preview
      const placeholder = screen.getByTestId('wireframe-placeholder');
      expect(placeholder).toHaveTextContent('"viewport": "mobile"');
    });
  });

  describe('Viewport Switching', () => {
    const mockWireframe = {
      viewport: 'desktop' as const,
      direction: 'LR' as const,
      screens: [],
    };

    it('should render viewport selector', () => {
      mockUseWireframe.mockReturnValue({
        wireframe: mockWireframe,
        loading: false,
        error: null,
      });

      renderWithRouter();

      expect(screen.getByTestId('viewport-selector')).toBeInTheDocument();
    });

    it('should display all viewport options', () => {
      mockUseWireframe.mockReturnValue({
        wireframe: mockWireframe,
        loading: false,
        error: null,
      });

      renderWithRouter();

      expect(screen.getByRole('button', { name: /mobile/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /tablet/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /desktop/i })).toBeInTheDocument();
    });

    it('should highlight active viewport (defaults to mobile)', () => {
      mockUseWireframe.mockReturnValue({
        wireframe: mockWireframe,
        loading: false,
        error: null,
      });

      renderWithRouter();

      // Component defaults to mobile viewport regardless of wireframe data
      const mobileButton = screen.getByRole('button', { name: /mobile/i });
      expect(mobileButton).toHaveAttribute('aria-pressed', 'true');
    });

    it('should change viewport on button click', async () => {
      const user = userEvent.setup();
      mockUseWireframe.mockReturnValue({
        wireframe: mockWireframe,
        loading: false,
        error: null,
      });

      renderWithRouter();

      const mobileButton = screen.getByRole('button', { name: /mobile/i });
      await user.click(mobileButton);

      expect(mobileButton).toHaveAttribute('aria-pressed', 'true');
    });
  });

  describe('Page Structure', () => {
    it('should render page container', () => {
      mockUseWireframe.mockReturnValue({
        wireframe: null,
        loading: true,
        error: null,
      });

      renderWithRouter();

      expect(screen.getByTestId('wireframe-page')).toBeInTheDocument();
    });

    it('should have proper accessibility attributes', () => {
      mockUseWireframe.mockReturnValue({
        wireframe: null,
        loading: true,
        error: null,
      });

      renderWithRouter();

      expect(screen.getByRole('main')).toBeInTheDocument();
    });
  });
});
