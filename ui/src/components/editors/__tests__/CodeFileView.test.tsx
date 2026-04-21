import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';

// Mock the lazy-loaded PseudoViewer so Suspense resolves synchronously
vi.mock('@/pages/pseudo/PseudoViewer', () => ({
  PseudoViewer: () => <div data-testid="pseudo-viewer">Prose</div>,
}));

// Mock CodeMirrorWrapper to a simple textarea-like stand-in
vi.mock('../CodeMirrorWrapper', () => ({
  __esModule: true,
  default: ({ value }: { value: string }) => (
    <div data-testid="codemirror">{value}</div>
  ),
}));

// Mock perf-bus (no-op)
vi.mock('@/lib/perf-bus', () => ({
  mark: vi.fn(),
}));

// Mock auto-promote reporter
vi.mock('@/hooks/useEditorAutoPromote', () => ({
  reportEditorDirty: vi.fn(),
}));

// Mock pseudo-api to control fetch
vi.mock('@/lib/pseudo-api', () => {
  class CodeFileNotFoundError extends Error {
    constructor(message = 'File not found') {
      super(message);
      this.name = 'CodeFileNotFoundError';
    }
  }
  class CodeFilePathError extends Error {
    constructor(message = 'Invalid path') {
      super(message);
      this.name = 'CodeFilePathError';
    }
  }
  return {
    fetchCodeFile: vi.fn(),
    peekPseudoFile: vi.fn(() => null),
    CodeFileNotFoundError,
    CodeFilePathError,
  };
});


import { CodeFileView } from '../CodeFileView';
import { fetchCodeFile, CodeFileNotFoundError } from '@/lib/pseudo-api';

describe('CodeFileView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows Loading... while the fetch is pending', async () => {
    // Never resolves
    (fetchCodeFile as any).mockImplementation(() => new Promise(() => {}));
    render(<CodeFileView path="/abs/foo.ts" project="/p" editMode={false} tabId="t1" />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('renders CodeMirror on text success', async () => {
    (fetchCodeFile as any).mockResolvedValue({
      kind: 'text',
      content: 'hello world',
      language: 'ts',
      sizeBytes: 11,
      truncated: false,
      mtimeMs: 1000,
    });
    render(<CodeFileView path="/abs/foo.ts" project="/p" editMode={false} tabId="t1" />);
    await waitFor(() => {
      expect(screen.getByTestId('codemirror')).toHaveTextContent('hello world');
    });
  });

  it('renders "File not found." on CodeFileNotFoundError', async () => {
    (fetchCodeFile as any).mockRejectedValue(new CodeFileNotFoundError());
    render(<CodeFileView path="/abs/missing.ts" project="/p" editMode={false} tabId="t1" />);
    await waitFor(() => {
      expect(screen.getByText('File not found.')).toBeInTheDocument();
    });
  });

  it('renders "Fetch anyway" on truncated text and refetches with allowLarge', async () => {
    (fetchCodeFile as any).mockResolvedValueOnce({
      kind: 'text',
      content: '',
      language: 'ts',
      sizeBytes: 5_000_000,
      truncated: true,
      mtimeMs: 1000,
    });
    render(<CodeFileView path="/abs/big.ts" project="/p" editMode={false} tabId="t1" />);
    const btn = await screen.findByText('Fetch anyway');
    expect(btn).toBeInTheDocument();

    (fetchCodeFile as any).mockResolvedValueOnce({
      kind: 'text',
      content: 'full content',
      language: 'ts',
      sizeBytes: 5_000_000,
      truncated: false,
      mtimeMs: 1000,
    });
    fireEvent.click(btn);

    await waitFor(() => {
      expect((fetchCodeFile as any).mock.calls.length).toBeGreaterThanOrEqual(2);
    });
    const secondCallArgs = (fetchCodeFile as any).mock.calls[1];
    expect(secondCallArgs[2]?.allowLarge).toBe(true);
  });

  it('renders binary placeholder with size', async () => {
    (fetchCodeFile as any).mockResolvedValue({
      kind: 'binary',
      sizeBytes: 2048,
    });
    render(<CodeFileView path="/abs/blob.bin" project="/p" editMode={false} tabId="t1" />);
    await waitFor(() => {
      expect(screen.getByText(/Binary file/)).toBeInTheDocument();
    });
  });

  it('renders an image when kind is image', async () => {
    (fetchCodeFile as any).mockResolvedValue({
      kind: 'image',
      sizeBytes: 300,
      mimeType: 'image/png',
      dataUrl: 'data:image/png;base64,AAA',
    });
    render(<CodeFileView path="/abs/pic.png" project="/p" editMode={false} tabId="t1" />);
    const img = await screen.findByRole('img');
    expect(img).toHaveAttribute('src', 'data:image/png;base64,AAA');
  });
});
