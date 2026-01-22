/**
 * DiagramEditor Component Tests
 *
 * Tests for the DiagramEditor component covering:
 * - Component rendering and layout
 * - State management (loading, validation, saving)
 * - User interactions (editing, saving, discarding)
 * - Keyboard shortcuts (Cmd+S, Escape)
 * - Error handling
 * - Split pane functionality
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DiagramEditor } from '../DiagramEditor';
import * as useDiagramHook from '@/hooks/useDiagram';
import * as useSessionHook from '@/hooks/useSession';
import mermaid from 'mermaid';

// Mock dependencies
vi.mock('@/hooks/useDiagram');
vi.mock('@/hooks/useSession');
vi.mock('mermaid');
vi.mock('../CodeMirrorWrapper', () => ({
  default: ({ value, onChange, language, placeholder }: any) => (
    <textarea
      data-testid="code-mirror-wrapper"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      data-language={language}
    />
  ),
}));
vi.mock('../MermaidPreview', () => ({
  default: ({ content, onError, onRender }: any) => (
    <div data-testid="mermaid-preview">
      {content ? (
        <div data-testid="mermaid-content">{content}</div>
      ) : (
        <div data-testid="mermaid-empty">Enter Mermaid syntax</div>
      )}
    </div>
  ),
}));
vi.mock('@/components/layout/SplitPane', () => ({
  SplitPane: ({ primaryContent, secondaryContent }: any) => (
    <div data-testid="split-pane">
      <div data-testid="split-pane-primary">{primaryContent}</div>
      <div data-testid="split-pane-secondary">{secondaryContent}</div>
    </div>
  ),
}));

describe('DiagramEditor', () => {
  const mockDiagram = {
    id: 'diagram-1',
    name: 'My Diagram',
    content: 'graph TD; A-->B;',
    lastModified: Date.now(),
  };

  const mockValidResult = {
    valid: true,
  };

  const mockInvalidResult = {
    valid: false,
    error: 'Invalid syntax',
    line: 1,
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup default mocks
    (useDiagramHook.useDiagram as any).mockReturnValue({
      diagrams: [mockDiagram],
      selectedDiagramId: 'diagram-1',
      selectedDiagram: mockDiagram,
      getDiagramById: vi.fn((id) => (id === 'diagram-1' ? mockDiagram : undefined)),
      updateDiagram: vi.fn(),
      removeDiagram: vi.fn(),
      selectDiagram: vi.fn(),
      addDiagram: vi.fn(),
      setDiagrams: vi.fn(),
      hasDiagram: vi.fn(),
    });

    (useSessionHook.useSession as any).mockReturnValue({
      currentSession: { name: 'test-session', project: '/test' },
      isLoading: false,
      error: null,
    });

    // Mock mermaid.parse to resolve successfully by default
    (mermaid.parse as any).mockResolvedValue(undefined);
  });

  describe('Rendering', () => {
    it('should render the component with diagram name', () => {
      render(<DiagramEditor diagramId="diagram-1" />);

      expect(screen.getByText('My Diagram')).toBeInTheDocument();
    });

    it('should render split pane with primary and secondary content', () => {
      render(<DiagramEditor diagramId="diagram-1" />);

      expect(screen.getByTestId('split-pane')).toBeInTheDocument();
      expect(screen.getByTestId('split-pane-primary')).toBeInTheDocument();
      expect(screen.getByTestId('split-pane-secondary')).toBeInTheDocument();
    });

    it('should render code editor in primary pane', () => {
      render(<DiagramEditor diagramId="diagram-1" />);

      const editor = screen.getByTestId('code-mirror-wrapper');
      expect(editor).toBeInTheDocument();
      expect(editor).toHaveValue('graph TD; A-->B;');
    });

    it('should render preview in secondary pane', () => {
      render(<DiagramEditor diagramId="diagram-1" />);

      const preview = screen.getByTestId('mermaid-preview');
      expect(preview).toBeInTheDocument();
      expect(screen.getByTestId('mermaid-content')).toHaveTextContent('graph TD; A-->B;');
    });

    it('should render header with title, buttons', () => {
      render(<DiagramEditor diagramId="diagram-1" />);

      expect(screen.getByRole('button', { name: /Discard/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Save/i })).toBeInTheDocument();
    });

    it('should show loading state when diagram is not loaded', () => {
      (useDiagramHook.useDiagram as any).mockReturnValue({
        diagrams: [],
        selectedDiagramId: null,
        selectedDiagram: undefined,
        getDiagramById: vi.fn(() => undefined),
        updateDiagram: vi.fn(),
        removeDiagram: vi.fn(),
        selectDiagram: vi.fn(),
        addDiagram: vi.fn(),
        setDiagrams: vi.fn(),
        hasDiagram: vi.fn(),
      });

      render(<DiagramEditor diagramId="diagram-1" />);

      expect(screen.getByText(/Loading diagram/i)).toBeInTheDocument();
    });
  });

  describe('Editing', () => {
    it('should update editor content when user types', async () => {
      const user = userEvent.setup();
      render(<DiagramEditor diagramId="diagram-1" />);

      const editor = screen.getByTestId('code-mirror-wrapper') as HTMLTextAreaElement;

      // Clear and type new content
      await user.clear(editor);
      await user.type(editor, 'graph LR; X-->Y;');

      expect(editor.value).toBe('graph LR; X-->Y;');
    });

    it('should mark document as changed when content differs from original', async () => {
      const user = userEvent.setup();
      render(<DiagramEditor diagramId="diagram-1" />);

      const editor = screen.getByTestId('code-mirror-wrapper') as HTMLTextAreaElement;

      // Initially, no unsaved indicator
      expect(screen.queryByTitle('Unsaved changes')).not.toBeInTheDocument();

      // Make a change
      await user.clear(editor);
      await user.type(editor, 'graph LR; X-->Y;');

      // Unsaved indicator should appear
      await waitFor(() => {
        expect(screen.getByTitle('Unsaved changes')).toBeInTheDocument();
      });
    });

    it('should show validation status while validating', async () => {
      const user = userEvent.setup();

      // Mock mermaid.parse to never resolve (simulating a slow validation)
      (mermaid.parse as any).mockImplementation(() => new Promise(() => {}));

      render(<DiagramEditor diagramId="diagram-1" />);

      const editor = screen.getByTestId('code-mirror-wrapper') as HTMLTextAreaElement;

      // Make a change to trigger validation
      await user.clear(editor);
      await user.type(editor, 'graph LR; X-->Y;');

      // Wait for validation to start (debounced)
      await waitFor(
        () => {
          expect(screen.getByText(/Validating/i)).toBeInTheDocument();
        },
        { timeout: 500 }
      );
    });

    it('should show validation error when diagram is invalid', async () => {
      const user = userEvent.setup();

      // Mock mermaid.parse to reject with an error
      (mermaid.parse as any).mockRejectedValue(new Error('Invalid syntax at line 1'));

      render(<DiagramEditor diagramId="diagram-1" />);

      const editor = screen.getByTestId('code-mirror-wrapper') as HTMLTextAreaElement;

      // Make a change
      await user.clear(editor);
      await user.type(editor, 'invalid syntax');

      // Wait for validation error
      await waitFor(() => {
        expect(screen.getByText('Invalid syntax')).toBeInTheDocument();
        expect(screen.getByText(/Line 1/)).toBeInTheDocument();
      });
    });

    it('should show valid status when diagram is valid', async () => {
      const user = userEvent.setup();

      render(<DiagramEditor diagramId="diagram-1" />);

      // Diagram is already valid on render
      // Just verify the editor has content
      const editor = screen.getByTestId('code-mirror-wrapper');
      expect(editor).toHaveValue('graph TD; A-->B;');

      // After a moment, valid status should appear
      await waitFor(() => {
        expect(screen.getByText('Valid diagram syntax')).toBeInTheDocument();
      });
    });
  });

  describe('Saving', () => {
    it('should disable save button when there are no changes', () => {
      render(<DiagramEditor diagramId="diagram-1" />);

      const saveButton = screen.getByRole('button', { name: /Save/i });
      expect(saveButton).toBeDisabled();
    });

    it('should disable save button when diagram is invalid', async () => {
      const user = userEvent.setup();

      // Mock mermaid.parse to reject with an error
      (mermaid.parse as any).mockRejectedValue(new Error('Invalid syntax'));

      render(<DiagramEditor diagramId="diagram-1" />);

      const editor = screen.getByTestId('code-mirror-wrapper') as HTMLTextAreaElement;

      // Make an invalid change
      await user.clear(editor);
      await user.type(editor, 'invalid');

      // Wait for validation
      await waitFor(() => {
        expect(screen.getByText('Invalid syntax')).toBeInTheDocument();
      });

      // Save button should be disabled
      const saveButton = screen.getByRole('button', { name: /Save/i });
      expect(saveButton).toBeDisabled();
    });

    it('should enable save button when there are valid changes', async () => {
      const user = userEvent.setup();

      render(<DiagramEditor diagramId="diagram-1" />);

      const editor = screen.getByTestId('code-mirror-wrapper') as HTMLTextAreaElement;

      // Make a valid change
      await user.clear(editor);
      await user.type(editor, 'graph LR; X-->Y;');

      // Wait for valid status
      await waitFor(() => {
        expect(screen.getByText('Valid diagram syntax')).toBeInTheDocument();
      });

      // Save button should be enabled
      const saveButton = screen.getByRole('button', { name: /Save/i });
      expect(saveButton).toBeEnabled();
    });

    it('should call updateDiagram when save is clicked', async () => {
      const user = userEvent.setup();
      const updateDiagramMock = vi.fn();

      (useDiagramHook.useDiagram as any).mockReturnValue({
        diagrams: [mockDiagram],
        selectedDiagramId: 'diagram-1',
        selectedDiagram: mockDiagram,
        getDiagramById: vi.fn((id) => (id === 'diagram-1' ? mockDiagram : undefined)),
        updateDiagram: updateDiagramMock,
        removeDiagram: vi.fn(),
        selectDiagram: vi.fn(),
        addDiagram: vi.fn(),
        setDiagrams: vi.fn(),
        hasDiagram: vi.fn(),
      });

      render(<DiagramEditor diagramId="diagram-1" />);

      const editor = screen.getByTestId('code-mirror-wrapper') as HTMLTextAreaElement;

      // Make a change
      await user.clear(editor);
      await user.type(editor, 'graph LR; X-->Y;');

      // Wait for valid status
      await waitFor(() => {
        expect(screen.getByText('Valid diagram syntax')).toBeInTheDocument();
      });

      // Click save
      const saveButton = screen.getByRole('button', { name: /Save/i });
      await user.click(saveButton);

      // Verify updateDiagram was called
      expect(updateDiagramMock).toHaveBeenCalledWith('diagram-1', {
        content: 'graph LR; X-->Y;',
        lastModified: expect.any(Number),
      });
    });

    it('should show saved indicator after successful save', async () => {
      const user = userEvent.setup();

      render(<DiagramEditor diagramId="diagram-1" />);

      const editor = screen.getByTestId('code-mirror-wrapper') as HTMLTextAreaElement;

      // Make a change
      await user.clear(editor);
      await user.type(editor, 'graph LR; X-->Y;');

      // Wait for valid status
      await waitFor(() => {
        expect(screen.getByText('Valid diagram syntax')).toBeInTheDocument();
      });

      // Click save
      const saveButton = screen.getByRole('button', { name: /Save/i });
      await user.click(saveButton);

      // Check for saved indicator
      await waitFor(() => {
        expect(screen.getByText('Saved')).toBeInTheDocument();
      });
    });
  });

  describe('Discarding', () => {
    it('should disable discard button when there are no changes', () => {
      render(<DiagramEditor diagramId="diagram-1" />);

      const discardButton = screen.getByRole('button', { name: /Discard/i });
      expect(discardButton).toBeDisabled();
    });

    it('should enable discard button when there are changes', async () => {
      const user = userEvent.setup();

      render(<DiagramEditor diagramId="diagram-1" />);

      const editor = screen.getByTestId('code-mirror-wrapper') as HTMLTextAreaElement;

      // Make a change
      await user.clear(editor);
      await user.type(editor, 'graph LR; X-->Y;');

      // Wait for changes to be detected
      await waitFor(() => {
        expect(screen.getByTitle('Unsaved changes')).toBeInTheDocument();
      });

      // Discard button should be enabled
      const discardButton = screen.getByRole('button', { name: /Discard/i });
      expect(discardButton).toBeEnabled();
    });

    it('should restore original content when discard is clicked', async () => {
      const user = userEvent.setup();

      render(<DiagramEditor diagramId="diagram-1" />);

      const editor = screen.getByTestId('code-mirror-wrapper') as HTMLTextAreaElement;

      // Make a change
      await user.clear(editor);
      await user.type(editor, 'graph LR; X-->Y;');

      expect(editor.value).toBe('graph LR; X-->Y;');

      // Click discard
      const discardButton = screen.getByRole('button', { name: /Discard/i });
      await user.click(discardButton);

      // Content should be restored
      expect(editor.value).toBe('graph TD; A-->B;');
    });

    it('should clear unsaved indicator after discard', async () => {
      const user = userEvent.setup();

      render(<DiagramEditor diagramId="diagram-1" />);

      const editor = screen.getByTestId('code-mirror-wrapper') as HTMLTextAreaElement;

      // Make a change
      await user.clear(editor);
      await user.type(editor, 'graph LR; X-->Y;');

      // Unsaved indicator should appear
      await waitFor(() => {
        expect(screen.getByTitle('Unsaved changes')).toBeInTheDocument();
      });

      // Click discard
      const discardButton = screen.getByRole('button', { name: /Discard/i });
      await user.click(discardButton);

      // Unsaved indicator should disappear
      await waitFor(() => {
        expect(screen.queryByTitle('Unsaved changes')).not.toBeInTheDocument();
      });
    });
  });

  describe('Keyboard Shortcuts', () => {
    it('should save on Cmd+S when there are valid changes', async () => {
      const user = userEvent.setup();
      const updateDiagramMock = vi.fn();

      (useDiagramHook.useDiagram as any).mockReturnValue({
        diagrams: [mockDiagram],
        selectedDiagramId: 'diagram-1',
        selectedDiagram: mockDiagram,
        getDiagramById: vi.fn((id) => (id === 'diagram-1' ? mockDiagram : undefined)),
        updateDiagram: updateDiagramMock,
        removeDiagram: vi.fn(),
        selectDiagram: vi.fn(),
        addDiagram: vi.fn(),
        setDiagrams: vi.fn(),
        hasDiagram: vi.fn(),
      });

      render(<DiagramEditor diagramId="diagram-1" />);

      const editor = screen.getByTestId('code-mirror-wrapper') as HTMLTextAreaElement;

      // Make a change
      await user.clear(editor);
      await user.type(editor, 'graph LR; X-->Y;');

      // Wait for valid status
      await waitFor(() => {
        expect(screen.getByText('Valid diagram syntax')).toBeInTheDocument();
      });

      // Press Cmd+S (simulated with metaKey)
      fireEvent.keyDown(window, { key: 's', metaKey: true });

      // Verify updateDiagram was called
      expect(updateDiagramMock).toHaveBeenCalled();
    });

    it('should save on Ctrl+S when there are valid changes', async () => {
      const user = userEvent.setup();
      const updateDiagramMock = vi.fn();

      (useDiagramHook.useDiagram as any).mockReturnValue({
        diagrams: [mockDiagram],
        selectedDiagramId: 'diagram-1',
        selectedDiagram: mockDiagram,
        getDiagramById: vi.fn((id) => (id === 'diagram-1' ? mockDiagram : undefined)),
        updateDiagram: updateDiagramMock,
        removeDiagram: vi.fn(),
        selectDiagram: vi.fn(),
        addDiagram: vi.fn(),
        setDiagrams: vi.fn(),
        hasDiagram: vi.fn(),
      });

      render(<DiagramEditor diagramId="diagram-1" />);

      const editor = screen.getByTestId('code-mirror-wrapper') as HTMLTextAreaElement;

      // Make a change
      await user.clear(editor);
      await user.type(editor, 'graph LR; X-->Y;');

      // Wait for valid status
      await waitFor(() => {
        expect(screen.getByText('Valid diagram syntax')).toBeInTheDocument();
      });

      // Press Ctrl+S
      fireEvent.keyDown(window, { key: 's', ctrlKey: true });

      // Verify updateDiagram was called
      expect(updateDiagramMock).toHaveBeenCalled();
    });

    it('should not save on Cmd+S when there are no changes', () => {
      const updateDiagramMock = vi.fn();

      (useDiagramHook.useDiagram as any).mockReturnValue({
        diagrams: [mockDiagram],
        selectedDiagramId: 'diagram-1',
        selectedDiagram: mockDiagram,
        getDiagramById: vi.fn((id) => (id === 'diagram-1' ? mockDiagram : undefined)),
        updateDiagram: updateDiagramMock,
        removeDiagram: vi.fn(),
        selectDiagram: vi.fn(),
        addDiagram: vi.fn(),
        setDiagrams: vi.fn(),
        hasDiagram: vi.fn(),
      });

      render(<DiagramEditor diagramId="diagram-1" />);

      // Press Cmd+S without making changes
      fireEvent.keyDown(window, { key: 's', metaKey: true });

      // updateDiagram should not be called
      expect(updateDiagramMock).not.toHaveBeenCalled();
    });

    it('should call onExit when Escape is pressed with no unsaved changes', () => {
      const onExitMock = vi.fn();

      render(<DiagramEditor diagramId="diagram-1" onExit={onExitMock} />);

      // Press Escape
      fireEvent.keyDown(window, { key: 'Escape' });

      expect(onExitMock).toHaveBeenCalled();
    });
  });

  describe('Preview Integration', () => {
    it('should pass diagram content to preview', () => {
      render(<DiagramEditor diagramId="diagram-1" />);

      const preview = screen.getByTestId('mermaid-preview');
      expect(within(preview).getByTestId('mermaid-content')).toHaveTextContent('graph TD; A-->B;');
    });

    it('should update preview when editor content changes', async () => {
      const user = userEvent.setup();

      render(<DiagramEditor diagramId="diagram-1" />);

      const editor = screen.getByTestId('code-mirror-wrapper') as HTMLTextAreaElement;

      // Make a change
      await user.clear(editor);
      await user.type(editor, 'graph LR; X-->Y;');

      // Preview should be updated
      await waitFor(() => {
        expect(screen.getByTestId('mermaid-content')).toHaveTextContent('graph LR; X-->Y;');
      });
    });
  });

  describe('Error Handling', () => {
    it('should show error when validation fails', async () => {
      const user = userEvent.setup();

      // Mock mermaid.parse to reject with an error
      (mermaid.parse as any).mockRejectedValue(new Error('Validation service error'));

      render(<DiagramEditor diagramId="diagram-1" />);

      const editor = screen.getByTestId('code-mirror-wrapper') as HTMLTextAreaElement;

      // Make a change to trigger validation
      await user.clear(editor);
      await user.type(editor, 'new content');

      // Wait for error to appear
      await waitFor(() => {
        expect(screen.getByText('Validation service error')).toBeInTheDocument();
      });
    });
  });

  describe('Responsive Design', () => {
    it('should render with full width and height', () => {
      const { container } = render(<DiagramEditor diagramId="diagram-1" />);

      const root = container.firstChild as HTMLElement;
      expect(root).toHaveClass('w-full', 'h-full');
    });

    it('should use flex layout for responsive sizing', () => {
      const { container } = render(<DiagramEditor diagramId="diagram-1" />);

      const root = container.firstChild as HTMLElement;
      expect(root).toHaveClass('flex', 'flex-col');
    });
  });
});
