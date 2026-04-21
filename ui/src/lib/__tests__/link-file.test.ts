import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../api', () => ({
  api: {
    createSnippet: vi.fn(),
    syncCodeFromDisk: vi.fn(),
  },
}));

vi.mock('../../stores/sessionStore', () => ({
  useSessionStore: {
    getState: vi.fn(),
  },
}));

import { linkFile } from '../link-file';
import { api } from '../api';
import { useSessionStore } from '../../stores/sessionStore';

describe('linkFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('dedupes when a linked snippet with matching filePath already exists', async () => {
    (useSessionStore.getState as any).mockReturnValue({
      currentSession: { project: 'proj', name: 'sess' },
      snippets: [
        {
          id: 'snip-existing',
          name: 'foo.ts',
          content: JSON.stringify({ filePath: '/abs/foo.ts', linked: true }),
          lastModified: 0,
        },
      ],
    });

    const result = await linkFile('proj', 'sess', '/abs/foo.ts');

    expect(result).toBe('snip-existing');
    expect(api.createSnippet).not.toHaveBeenCalled();
    expect(api.syncCodeFromDisk).not.toHaveBeenCalled();
  });

  it('creates a new linked snippet when no match exists', async () => {
    (useSessionStore.getState as any).mockReturnValue({
      currentSession: { project: 'proj', name: 'sess' },
      snippets: [
        { id: 'other', name: 'x', content: 'not-json', lastModified: 0 },
      ],
    });
    (api.createSnippet as any).mockResolvedValue({ id: 'new-id' });
    (api.syncCodeFromDisk as any).mockResolvedValue(undefined);

    const result = await linkFile('proj', 'sess', '/abs/bar.ts');

    expect(result).toBe('new-id');
    expect(api.createSnippet).toHaveBeenCalledTimes(1);

    const createCall = (api.createSnippet as any).mock.calls[0];
    const contentArg = createCall[3];
    const parsed = JSON.parse(contentArg);
    expect(parsed.filePath).toBe('/abs/bar.ts');
    expect(parsed.linked).toBe(true);

    expect(api.syncCodeFromDisk).toHaveBeenCalledWith('proj', 'sess', 'new-id');
  });
});
