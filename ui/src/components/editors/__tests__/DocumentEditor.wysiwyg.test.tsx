/**
 * Tests for DocumentEditor.wysiwyg
 *
 * The MilkdownEditor child is stubbed out so we can assert on the props the
 * wysiwyg wrapper feeds it, and drive onChange/flushRef synchronously.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { DocumentEditorWysiwyg } from '../DocumentEditor.wysiwyg';

// --- MilkdownEditor stub ---------------------------------------------------

type MilkdownStubProps = {
  docId: string;
  initialMarkdown: string;
  onChange?: (md: string) => void;
  onPersist?: (md: string) => void;
  onFlushRef?: { current: (() => void) | null };
};

const milkdownState: { lastProps: MilkdownStubProps | null } = {
  lastProps: null,
};

vi.mock('../milkdown/MilkdownEditor', () => ({
  MilkdownEditor: (props: MilkdownStubProps) => {
    milkdownState.lastProps = props;
    // Wire up a trivial flush handler so the wysiwyg component can call it.
    if (props.onFlushRef) {
      props.onFlushRef.current = () => {
        // no-op for tests; tests drive onChange directly
      };
    }
    return <div data-testid="milkdown-editor" data-doc-id={props.docId} />;
  },
}));

// --- useDocument mock ------------------------------------------------------

type TestDoc = {
  id: string;
  name: string;
  content: string;
  lastModified: number;
};

const state: {
  selectedDocument: TestDoc | null;
  updateDocument: ReturnType<typeof vi.fn>;
  getDocumentById: ReturnType<typeof vi.fn>;
} = {
  selectedDocument: null,
  updateDocument: vi.fn(),
  getDocumentById: vi.fn(),
};

vi.mock('@/hooks/useDocument', () => ({
  useDocument: () => state,
}));

// --- HistoryModal stub (avoid pulling heavy deps) --------------------------

vi.mock('../HistoryModal', () => ({
  HistoryModal: () => null,
}));

// --- Helpers ---------------------------------------------------------------

function makeDoc(overrides: Partial<TestDoc> = {}): TestDoc {
  return {
    id: 'doc-1',
    name: 'My Doc',
    content: '# Hello',
    lastModified: 0,
    ...overrides,
  };
}

beforeEach(() => {
  milkdownState.lastProps = null;
  state.selectedDocument = null;
  state.updateDocument = vi.fn(() => Promise.resolve());
  state.getDocumentById = vi.fn();
});

// --- Tests -----------------------------------------------------------------

describe('DocumentEditorWysiwyg', () => {
  it('renders empty state when no document is selected', () => {
    render(<DocumentEditorWysiwyg />);
    expect(screen.getByTestId('document-editor-empty')).toBeInTheDocument();
  });

  it('renders container + milkdown editor when document is present', () => {
    state.selectedDocument = makeDoc();
    render(<DocumentEditorWysiwyg />);
    expect(screen.getByTestId('document-editor-wysiwyg')).toBeInTheDocument();
    expect(screen.getByTestId('milkdown-editor')).toBeInTheDocument();
  });

  it('passes docId and initialMarkdown to MilkdownEditor', () => {
    state.selectedDocument = makeDoc({ id: 'abc', content: '# X' });
    render(<DocumentEditorWysiwyg />);
    expect(milkdownState.lastProps?.docId).toBe('abc');
    expect(milkdownState.lastProps?.initialMarkdown).toBe('# X');
  });

  it('shows document name in the header', () => {
    state.selectedDocument = makeDoc({ name: 'Cool Title' });
    render(<DocumentEditorWysiwyg />);
    expect(screen.getByText('Cool Title')).toBeInTheDocument();
  });

  it('toggles the unsaved indicator after onChange fires', () => {
    state.selectedDocument = makeDoc();
    render(<DocumentEditorWysiwyg />);
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
    act(() => {
      milkdownState.lastProps?.onChange?.('# edited');
    });
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
  });

  it('Save flushes, calls updateDocument, and fires onSave', async () => {
    const doc = makeDoc();
    state.selectedDocument = doc;
    state.updateDocument = vi.fn(() => Promise.resolve());
    const onSave = vi.fn();
    render(<DocumentEditorWysiwyg onSave={onSave} />);

    act(() => {
      milkdownState.lastProps?.onChange?.('# edited');
    });

    // Replace stubbed flush with a spy to assert it ran
    const flushSpy = vi.fn();
    if (milkdownState.lastProps?.onFlushRef) {
      milkdownState.lastProps.onFlushRef.current = flushSpy;
    }

    await act(async () => {
      fireEvent.click(screen.getByTestId('document-editor-save-btn'));
    });

    expect(flushSpy).toHaveBeenCalled();
    expect(state.updateDocument).toHaveBeenCalledWith(
      doc.id,
      expect.objectContaining({ content: '# edited' })
    );
    await waitFor(() => expect(onSave).toHaveBeenCalled());
  });

  it('Cancel reverts the unsaved indicator to the document content', () => {
    state.selectedDocument = makeDoc({ content: '# original' });
    render(<DocumentEditorWysiwyg />);

    act(() => {
      milkdownState.lastProps?.onChange?.('# edited');
    });
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('document-editor-cancel-btn'));
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
  });

  it('Ctrl+S triggers save', () => {
    const doc = makeDoc();
    state.selectedDocument = doc;
    render(<DocumentEditorWysiwyg />);

    act(() => {
      milkdownState.lastProps?.onChange?.('# edited');
    });

    act(() => {
      fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    });

    expect(state.updateDocument).toHaveBeenCalledWith(
      doc.id,
      expect.objectContaining({ content: '# edited' })
    );
  });

  it('Escape is a no-op (does not revert changes)', () => {
    state.selectedDocument = makeDoc();
    render(<DocumentEditorWysiwyg />);

    act(() => {
      milkdownState.lastProps?.onChange?.('# edited');
    });

    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });

    // Still dirty after Escape — wysiwyg intentionally does nothing.
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
  });

  it('hides header buttons when showButtons is false', () => {
    state.selectedDocument = makeDoc();
    render(<DocumentEditorWysiwyg showButtons={false} />);
    expect(screen.queryByTestId('document-editor-save-btn')).not.toBeInTheDocument();
    expect(screen.queryByTestId('document-editor-cancel-btn')).not.toBeInTheDocument();
  });

  it('forwards className to the root container', () => {
    state.selectedDocument = makeDoc();
    render(<DocumentEditorWysiwyg className="my-custom-class" />);
    expect(screen.getByTestId('document-editor-wysiwyg').className).toContain('my-custom-class');
  });

  it('shows an error banner when updateDocument throws on save', () => {
    state.selectedDocument = makeDoc();
    state.updateDocument = vi.fn(() => {
      throw new Error('boom');
    });
    render(<DocumentEditorWysiwyg />);

    act(() => {
      milkdownState.lastProps?.onChange?.('# edited');
    });

    fireEvent.click(screen.getByTestId('document-editor-save-btn'));

    expect(screen.getByTestId('document-editor-error')).toHaveTextContent('boom');
  });

  it('resets state when the target document changes', () => {
    const docA = makeDoc({ id: 'a', content: '# A' });
    const docB = makeDoc({ id: 'b', content: '# B' });
    state.selectedDocument = docA;

    const { rerender } = render(<DocumentEditorWysiwyg />);

    act(() => {
      milkdownState.lastProps?.onChange?.('# dirty');
    });
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();

    // Swap selected doc under the hook and rerender
    state.selectedDocument = docB;
    rerender(<DocumentEditorWysiwyg />);

    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
    expect(milkdownState.lastProps?.docId).toBe('b');
    expect(milkdownState.lastProps?.initialMarkdown).toBe('# B');
  });
});
