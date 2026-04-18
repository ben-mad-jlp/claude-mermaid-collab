/**
 * Tests for DocumentEditor.wysiwyg HistoryModal integration.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DocumentEditorWysiwyg } from '../DocumentEditor.wysiwyg';

// --- MilkdownEditor stub ---------------------------------------------------

vi.mock('../milkdown/MilkdownEditor', () => ({
  MilkdownEditor: () => <div data-testid="mock-milkdown" />,
}));

// --- HistoryModal stub -----------------------------------------------------

vi.mock('../HistoryModal', () => ({
  HistoryModal: ({ isOpen, onClose, historicalContent, timestamp }: any) =>
    isOpen ? (
      <div
        data-testid="history-modal"
        data-timestamp={timestamp ?? ''}
        data-historical-content={historicalContent ?? ''}
      >
        <button data-testid="history-modal-close" onClick={onClose}>
          close
        </button>
      </div>
    ) : null,
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
  state.selectedDocument = makeDoc();
  state.updateDocument = vi.fn(() => Promise.resolve());
  state.getDocumentById = vi.fn();
});

// --- Tests -----------------------------------------------------------------

describe('DocumentEditorWysiwyg — HistoryModal', () => {
  it('opens HistoryModal when the History button is clicked', () => {
    render(<DocumentEditorWysiwyg />);

    expect(screen.queryByTestId('history-modal')).toBeNull();

    fireEvent.click(screen.getByTestId('document-editor-history-btn'));

    expect(screen.getByTestId('history-modal')).toBeInTheDocument();
  });

  it('closes HistoryModal when onClose fires', () => {
    render(<DocumentEditorWysiwyg />);

    fireEvent.click(screen.getByTestId('document-editor-history-btn'));
    expect(screen.getByTestId('history-modal')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('history-modal-close'));

    expect(screen.queryByTestId('history-modal')).toBeNull();
  });
});
