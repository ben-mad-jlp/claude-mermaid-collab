/**
 * Tests for DocumentEditor.wysiwyg diff-mode branching.
 *
 * When a `diff` prop is provided, the wysiwyg wrapper should render the
 * MarkdownPreview in diff mode instead of the live Milkdown editor.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DocumentEditorWysiwyg } from '../DocumentEditor.wysiwyg';

// --- MarkdownPreview stub --------------------------------------------------

vi.mock('../MarkdownPreview', () => ({
  MarkdownPreview: (props: any) => (
    <div data-testid="mock-markdown-preview" data-diff={JSON.stringify(props.diff ?? null)} />
  ),
}));

// --- MilkdownEditor stub ---------------------------------------------------

vi.mock('../milkdown/MilkdownEditor', () => ({
  MilkdownEditor: (_props: any) => <div data-testid="mock-milkdown" />,
}));

// --- HistoryModal stub -----------------------------------------------------

vi.mock('../HistoryModal', () => ({
  HistoryModal: () => null,
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

describe('DocumentEditorWysiwyg diff mode', () => {
  it('renders MarkdownPreview when diff prop is provided', () => {
    render(
      <DocumentEditorWysiwyg
        diff={{ oldContent: 'a', newContent: 'b' }}
      />
    );
    expect(screen.getByTestId('document-editor-wysiwyg-diff')).toBeInTheDocument();
    expect(screen.getByTestId('mock-markdown-preview')).toBeInTheDocument();
    expect(screen.queryByTestId('mock-milkdown')).not.toBeInTheDocument();
  });

  it('renders Milkdown path when diff prop is absent', () => {
    render(<DocumentEditorWysiwyg />);
    expect(screen.getByTestId('mock-milkdown')).toBeInTheDocument();
    expect(screen.queryByTestId('mock-markdown-preview')).not.toBeInTheDocument();
  });
});
