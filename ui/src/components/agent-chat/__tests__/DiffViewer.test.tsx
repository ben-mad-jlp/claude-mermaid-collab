import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import DiffViewer from '../DiffViewer';

const MOCK_FILES = [
  {
    path: 'src/foo.ts',
    status: 'M',
    patch: [
      'diff --git a/src/foo.ts b/src/foo.ts',
      '--- a/src/foo.ts',
      '+++ b/src/foo.ts',
      '@@ -1,2 +1,2 @@',
      '-old foo line',
      '+new foo line',
    ].join('\n'),
  },
  {
    path: 'src/bar.ts',
    status: 'A',
    patch: [
      'diff --git a/src/bar.ts b/src/bar.ts',
      '--- /dev/null',
      '+++ b/src/bar.ts',
      '@@ -0,0 +1,1 @@',
      '+brand new bar content',
    ].join('\n'),
  },
];

function mockFetchOnce(data: unknown, ok = true, status = 200) {
  const fn = vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => data,
  } as unknown as Response);
  // @ts-expect-error override global
  global.fetch = fn;
  return fn;
}

describe('DiffViewer', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('renders the list of files from the API response', async () => {
    const fetchMock = mockFetchOnce(MOCK_FILES);
    render(<DiffViewer sessionId="sess-1" />);

    await waitFor(() => {
      expect(screen.getByTestId('diff-viewer')).toBeInTheDocument();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain('/api/agent/worktree-diff');
    expect(calledUrl).toContain('sessionId=sess-1');

    expect(screen.getByTestId('diff-file-src/foo.ts')).toBeInTheDocument();
    expect(screen.getByTestId('diff-file-src/bar.ts')).toBeInTheDocument();
  });

  it('selects the first file by default and shows its patch', async () => {
    mockFetchOnce(MOCK_FILES);
    render(<DiffViewer sessionId="sess-1" />);

    await waitFor(() => {
      expect(screen.getByTestId('diff-patch')).toBeInTheDocument();
    });

    const patch = screen.getByTestId('diff-patch');
    expect(patch).toHaveTextContent('new foo line');
    expect(patch).toHaveTextContent('old foo line');
    expect(patch).not.toHaveTextContent('brand new bar content');
  });

  it('clicking a file shows its patch', async () => {
    mockFetchOnce(MOCK_FILES);
    render(<DiffViewer sessionId="sess-1" />);

    await waitFor(() => {
      expect(screen.getByTestId('diff-file-src/bar.ts')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('diff-file-src/bar.ts'));

    const patch = screen.getByTestId('diff-patch');
    expect(patch).toHaveTextContent('brand new bar content');
    expect(patch).not.toHaveTextContent('new foo line');
  });

  it('shows empty state when response is an empty array', async () => {
    mockFetchOnce([]);
    render(<DiffViewer sessionId="sess-empty" />);

    await waitFor(() => {
      expect(screen.getByTestId('diff-viewer-empty')).toBeInTheDocument();
    });
    expect(screen.getByText('No changes')).toBeInTheDocument();
  });
});
