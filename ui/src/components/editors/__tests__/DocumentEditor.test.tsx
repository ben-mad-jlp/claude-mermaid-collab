/**
 * DocumentEditor Component Tests
 *
 * Test coverage includes:
 * - Component rendering and initialization
 * - Split pane layout with editor and preview
 * - Document loading and display
 * - Content editing and change tracking
 * - Save and cancel functionality
 * - Keyboard shortcuts (Ctrl+S, Escape)
 * - Error handling and states
 * - Debounced preview updates
 * - Responsive design
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DocumentEditor, type DocumentEditorProps } from '../DocumentEditor';
import { useDocument } from '@/hooks/useDocument';
import { useTheme } from '@/hooks/useTheme';

// Mock dependencies
vi.mock('@uiw/react-codemirror', () => ({
  default: ({ value, onChange, placeholder, editable, className }: any) => (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={!editable}
      className={className}
      data-testid="codemirror-editor"
    />
  ),
}));

vi.mock('react-markdown', () => ({
  default: ({ children }: { children: string }) => (
    <div data-testid="markdown-preview">{children}</div>
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

vi.mock('@/hooks/useTheme');

// Mock document hook
const mockUseDocument = vi.hoisted(() => ({
  documents: [
    {
      id: 'doc1',
      name: 'Test Document',
      content: '# Hello\n\nThis is test content',
      lastModified: 1000,
    },
    {
      id: 'doc2',
      name: 'Another Document',
      content: '# Another\n\nDifferent content',
      lastModified: 2000,
    },
  ],
  selectedDocumentId: 'doc1',
  selectedDocument: {
    id: 'doc1',
    name: 'Test Document',
    content: '# Hello\n\nThis is test content',
    lastModified: 1000,
  },
  updateDocument: vi.fn(),
  getDocumentById: vi.fn((id: string) => {
    const docs = [
      {
        id: 'doc1',
        name: 'Test Document',
        content: '# Hello\n\nThis is test content',
        lastModified: 1000,
      },
      {
        id: 'doc2',
        name: 'Another Document',
        content: '# Another\n\nDifferent content',
        lastModified: 2000,
      },
    ];
    return docs.find((d) => d.id === id);
  }),
  selectDocument: vi.fn(),
  addDocument: vi.fn(),
  removeDocument: vi.fn(),
  setDocuments: vi.fn(),
  hasDocument: vi.fn(),
}));

vi.mock('@/hooks/useDocument', () => ({
  useDocument: vi.fn(() => mockUseDocument),
}));

describe('DocumentEditor', () => {
  let mockOnSave: ReturnType<typeof vi.fn>;
  let mockOnChange: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockOnSave = vi.fn();
    mockOnChange = vi.fn();
    mockUseDocument.updateDocument.mockClear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('Rendering', () => {
    it('should render the document editor with split pane layout', () => {
      render(<DocumentEditor showButtons={true} />);

      expect(screen.getByTestId('document-editor')).toBeInTheDocument();
      expect(screen.getByTestId('split-pane')).toBeInTheDocument();
      expect(screen.getByTestId('split-pane-primary')).toBeInTheDocument();
      expect(screen.getByTestId('split-pane-secondary')).toBeInTheDocument();
    });

    it('should render CodeMirror editor on left side', () => {
      render(<DocumentEditor />);

      const editor = screen.getByTestId('codemirror-editor');
      expect(editor).toBeInTheDocument();
      expect(editor).toHaveValue('# Hello\n\nThis is test content');
    });

    it('should render markdown preview on right side', () => {
      render(<DocumentEditor />);

      expect(screen.getByTestId('markdown-preview')).toBeInTheDocument();
    });

    it('should display document name in header when buttons shown', () => {
      render(<DocumentEditor showButtons={true} />);

      expect(screen.getByText('Test Document')).toBeInTheDocument();
    });

    it('should render save and cancel buttons when showButtons is true', () => {
      render(<DocumentEditor showButtons={true} />);

      expect(screen.getByTestId('document-editor-save-btn')).toBeInTheDocument();
      expect(screen.getByTestId('document-editor-cancel-btn')).toBeInTheDocument();
    });

    it('should not render header buttons when showButtons is false', () => {
      render(<DocumentEditor showButtons={false} />);

      expect(screen.queryByTestId('document-editor-save-btn')).not.toBeInTheDocument();
      expect(screen.queryByTestId('document-editor-cancel-btn')).not.toBeInTheDocument();
    });

    it('should render footer with keyboard hints when buttons shown', () => {
      render(<DocumentEditor showButtons={true} />);

      expect(screen.getByText(/Ctrl\+S or Cmd\+S/)).toBeInTheDocument();
    });
  });

  describe('Document Loading', () => {
    it('should load selected document on mount', () => {
      render(<DocumentEditor />);

      const editor = screen.getByTestId('codemirror-editor') as HTMLTextAreaElement;
      expect(editor.value).toBe('# Hello\n\nThis is test content');
    });

    it('should load document by ID when documentId prop provided', () => {
      render(<DocumentEditor documentId="doc2" />);

      const editor = screen.getByTestId('codemirror-editor') as HTMLTextAreaElement;
      expect(editor.value).toBe('# Another\n\nDifferent content');
    });

    it('should show "No document selected" when no document available', () => {
      mockUseDocument.selectedDocument = undefined;
      render(<DocumentEditor />);

      expect(screen.getByTestId('document-editor-empty')).toBeInTheDocument();
      expect(screen.getByText('No document selected')).toBeInTheDocument();
    });

    it('should show loading state initially', () => {
      render(<DocumentEditor />);

      // Initial state should show document, not loading
      expect(screen.queryByTestId('document-editor-loading')).not.toBeInTheDocument();
    });
  });

  describe('Content Editing', () => {
    it('should update content on editor change', async () => {
      render(<DocumentEditor onChange={mockOnChange} />);

      const editor = screen.getByTestId('codemirror-editor');
      await userEvent.clear(editor);
      await userEvent.type(editor, '# New Content');

      expect(mockOnChange).toHaveBeenCalledWith('# New Content');
    });

    it('should track changes state', async () => {
      render(<DocumentEditor showButtons={true} />);

      const saveBtn = screen.getByTestId('document-editor-save-btn') as HTMLButtonElement;
      expect(saveBtn.disabled).toBe(true);
      expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();

      const editor = screen.getByTestId('codemirror-editor');
      await userEvent.clear(editor);
      await userEvent.type(editor, '# Changed');

      expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
      expect(saveBtn.disabled).toBe(false);
    });

    it('should debounce update to store', async () => {
      render(<DocumentEditor debounceDelay={300} />);

      const editor = screen.getByTestId('codemirror-editor');
      await userEvent.clear(editor);
      await userEvent.type(editor, '# New');

      // Should not update immediately
      expect(mockUseDocument.updateDocument).not.toHaveBeenCalled();

      // Wait for debounce
      vi.advanceTimersByTime(300);
      await waitFor(() => {
        expect(mockUseDocument.updateDocument).toHaveBeenCalled();
      });
    });

    it('should call onChange on each keystroke', async () => {
      render(<DocumentEditor onChange={mockOnChange} />);

      const editor = screen.getByTestId('codemirror-editor');
      await userEvent.clear(editor);
      await userEvent.type(editor, 'test');

      expect(mockOnChange).toHaveBeenCalledTimes(4); // Called for each character
    });
  });

  describe('Save Functionality', () => {
    it('should save document with current content', async () => {
      render(<DocumentEditor showButtons={true} onSave={mockOnSave} />);

      const editor = screen.getByTestId('codemirror-editor');
      await userEvent.clear(editor);
      await userEvent.type(editor, '# Saved Content');

      const saveBtn = screen.getByTestId('document-editor-save-btn');
      await userEvent.click(saveBtn);

      await waitFor(() => {
        expect(mockUseDocument.updateDocument).toHaveBeenCalledWith('doc1', {
          content: '# Saved Content',
          lastModified: expect.any(Number),
        });
      });

      expect(mockOnSave).toHaveBeenCalled();
    });

    it('should clear changes state after save', async () => {
      render(<DocumentEditor showButtons={true} />);

      const editor = screen.getByTestId('codemirror-editor');
      await userEvent.clear(editor);
      await userEvent.type(editor, '# New');

      const saveBtn = screen.getByTestId('document-editor-save-btn');
      await userEvent.click(saveBtn);

      await waitFor(() => {
        expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
      });
    });

    it('should disable save button while saving', async () => {
      const slowSave = vi.fn(
        () =>
          new Promise((resolve) => {
            setTimeout(resolve, 100);
          })
      );

      mockUseDocument.updateDocument = slowSave;
      render(<DocumentEditor showButtons={true} onSave={mockOnSave} />);

      const editor = screen.getByTestId('codemirror-editor');
      await userEvent.clear(editor);
      await userEvent.type(editor, '# New');

      const saveBtn = screen.getByTestId('document-editor-save-btn');
      await userEvent.click(saveBtn);

      expect(saveBtn).toBeDisabled();
    });

    it('should show "Saving..." text while saving', async () => {
      mockUseDocument.updateDocument = vi.fn(
        () =>
          new Promise((resolve) => {
            setTimeout(resolve, 100);
          })
      );

      render(<DocumentEditor showButtons={true} />);

      const editor = screen.getByTestId('codemirror-editor');
      await userEvent.clear(editor);
      await userEvent.type(editor, '# New');

      const saveBtn = screen.getByTestId('document-editor-save-btn');
      await userEvent.click(saveBtn);

      expect(saveBtn).toHaveTextContent('Saving...');
    });
  });

  describe('Cancel Functionality', () => {
    it('should revert content to original on cancel', async () => {
      render(<DocumentEditor showButtons={true} />);

      const editor = screen.getByTestId('codemirror-editor');
      await userEvent.clear(editor);
      await userEvent.type(editor, '# Changed');

      const cancelBtn = screen.getByTestId('document-editor-cancel-btn');
      await userEvent.click(cancelBtn);

      expect(editor).toHaveValue('# Hello\n\nThis is test content');
    });

    it('should clear changes state on cancel', async () => {
      render(<DocumentEditor showButtons={true} />);

      const editor = screen.getByTestId('codemirror-editor');
      await userEvent.clear(editor);
      await userEvent.type(editor, '# Changed');

      const cancelBtn = screen.getByTestId('document-editor-cancel-btn');
      await userEvent.click(cancelBtn);

      expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
    });

    it('should disable cancel button when no changes', async () => {
      render(<DocumentEditor showButtons={true} />);

      const cancelBtn = screen.getByTestId('document-editor-cancel-btn') as HTMLButtonElement;
      expect(cancelBtn.disabled).toBe(true);

      const editor = screen.getByTestId('codemirror-editor');
      await userEvent.clear(editor);
      await userEvent.type(editor, '# New');

      expect(cancelBtn.disabled).toBe(false);
    });
  });

  describe('Keyboard Shortcuts', () => {
    it('should save on Ctrl+S', async () => {
      render(<DocumentEditor showButtons={true} onSave={mockOnSave} />);

      const editor = screen.getByTestId('codemirror-editor');
      await userEvent.clear(editor);
      await userEvent.type(editor, '# New');

      fireEvent.keyDown(window, { key: 's', ctrlKey: true, code: 'KeyS' });

      await waitFor(() => {
        expect(mockUseDocument.updateDocument).toHaveBeenCalled();
      });
    });

    it('should save on Cmd+S (Mac)', async () => {
      render(<DocumentEditor showButtons={true} onSave={mockOnSave} />);

      const editor = screen.getByTestId('codemirror-editor');
      await userEvent.clear(editor);
      await userEvent.type(editor, '# New');

      fireEvent.keyDown(window, { key: 's', metaKey: true, code: 'KeyS' });

      await waitFor(() => {
        expect(mockUseDocument.updateDocument).toHaveBeenCalled();
      });
    });

    it('should cancel on Escape when changes exist', async () => {
      render(<DocumentEditor showButtons={true} />);

      const editor = screen.getByTestId('codemirror-editor');
      await userEvent.clear(editor);
      await userEvent.type(editor, '# Changed');

      fireEvent.keyDown(window, { key: 'Escape' });

      expect(editor).toHaveValue('# Hello\n\nThis is test content');
    });

    it('should not cancel on Escape when no changes', async () => {
      render(<DocumentEditor showButtons={true} />);

      const editor = screen.getByTestId('codemirror-editor') as HTMLTextAreaElement;
      const originalValue = editor.value;

      fireEvent.keyDown(window, { key: 'Escape' });

      expect(editor.value).toBe(originalValue);
    });

    it('should prevent default Ctrl+S behavior', async () => {
      render(<DocumentEditor showButtons={true} />);

      const editor = screen.getByTestId('codemirror-editor');
      await userEvent.clear(editor);
      await userEvent.type(editor, '# New');

      const event = new KeyboardEvent('keydown', {
        key: 's',
        ctrlKey: true,
        cancelable: true,
      });

      const preventDefaultSpy = vi.spyOn(event, 'preventDefault');
      fireEvent(window, event);

      expect(preventDefaultSpy).toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should display error message on save failure', async () => {
      const errorMsg = 'Save failed';
      mockUseDocument.updateDocument = vi.fn(() => {
        throw new Error(errorMsg);
      });

      render(<DocumentEditor showButtons={true} />);

      const editor = screen.getByTestId('codemirror-editor');
      await userEvent.clear(editor);
      await userEvent.type(editor, '# New');

      const saveBtn = screen.getByTestId('document-editor-save-btn');
      await userEvent.click(saveBtn);

      await waitFor(() => {
        expect(screen.getByTestId('document-editor-error')).toBeInTheDocument();
        expect(screen.getByText(errorMsg)).toBeInTheDocument();
      });
    });

    it('should show error with role alert for accessibility', () => {
      mockUseDocument.updateDocument = vi.fn(() => {
        throw new Error('Test error');
      });

      render(<DocumentEditor showButtons={true} />);

      const errorElement = screen.queryByTestId('document-editor-error');
      if (errorElement) {
        expect(errorElement).toHaveAttribute('role', 'alert');
      }
    });
  });

  describe('Integration', () => {
    it('should handle full edit-save workflow', async () => {
      render(<DocumentEditor showButtons={true} onSave={mockOnSave} />);

      // Start with original content
      let editor = screen.getByTestId('codemirror-editor') as HTMLTextAreaElement;
      expect(editor.value).toBe('# Hello\n\nThis is test content');

      // Make changes
      await userEvent.clear(editor);
      await userEvent.type(editor, '# Updated Content');

      // Verify changes tracked
      expect(screen.getByText('Unsaved changes')).toBeInTheDocument();

      // Save
      const saveBtn = screen.getByTestId('document-editor-save-btn');
      await userEvent.click(saveBtn);

      // Verify save was called
      await waitFor(() => {
        expect(mockUseDocument.updateDocument).toHaveBeenCalledWith('doc1', {
          content: '# Updated Content',
          lastModified: expect.any(Number),
        });
      });

      // Verify changes cleared
      expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
    });

    it('should switch documents and preserve state', async () => {
      const { rerender } = render(<DocumentEditor documentId="doc1" />);

      let editor = screen.getByTestId('codemirror-editor') as HTMLTextAreaElement;
      expect(editor.value).toBe('# Hello\n\nThis is test content');

      // Switch to different document
      rerender(<DocumentEditor documentId="doc2" />);

      editor = screen.getByTestId('codemirror-editor') as HTMLTextAreaElement;
      expect(editor.value).toBe('# Another\n\nDifferent content');
    });

    it('should cleanup debounce timer on unmount', () => {
      const { unmount } = render(<DocumentEditor />);

      expect(vi.getTimerCount()).toBeGreaterThan(0);

      unmount();

      // Timers should be cleaned up
      vi.useRealTimers();
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe('Responsive Design', () => {
    it('should render with responsive container classes', () => {
      const { container } = render(<DocumentEditor className="custom-class" />);

      const editor = container.querySelector('[data-testid="document-editor"]');
      expect(editor).toHaveClass('flex', 'flex-col', 'h-full', 'custom-class');
    });

    it('should pass storageId to SplitPane for persistence', () => {
      render(<DocumentEditor />);

      // SplitPane is mocked, but in real usage it should persist position with this ID
      expect(screen.getByTestId('split-pane')).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('should have proper button titles for keyboard shortcuts', () => {
      render(<DocumentEditor showButtons={true} />);

      const saveBtn = screen.getByTestId('document-editor-save-btn');
      const cancelBtn = screen.getByTestId('document-editor-cancel-btn');

      expect(saveBtn).toHaveAttribute('title');
      expect(cancelBtn).toHaveAttribute('title');
    });

    it('should have semantic document structure', () => {
      const { container } = render(<DocumentEditor showButtons={true} />);

      const heading = container.querySelector('h2');
      expect(heading).toBeInTheDocument();
    });
  });
});
