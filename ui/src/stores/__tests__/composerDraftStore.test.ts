import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Blueprint v1 spec (`w1-draft-store-v1`) required tests for the v1 shape and
// the beforeunload flush. The store has since migrated to v2, but we retain
// coverage of the v1→v2 migrator and the synchronous beforeunload flush here
// so future v1-shape regressions stay caught.

const STORAGE_KEY_V1 = 'cmc:composer-draft:v1';
const STORAGE_KEY_V2 = 'cmc:composer-draft:v2';

beforeEach(() => {
  vi.resetModules();
  window.localStorage.clear();
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('composerDraftStore (v1 legacy coverage)', () => {
  it('migrates a v1 payload lacking editorStateJson into the v2 shape', async () => {
    window.localStorage.setItem(
      STORAGE_KEY_V1,
      JSON.stringify({
        legacyA: {
          prompt: 'old-style draft',
          attachments: [
            { attachmentId: 'att1', mimeType: 'image/png', url: '/x', sizeBytes: 12 },
          ],
        },
        legacyB: { prompt: '', attachments: [] },
      })
    );

    const { useComposerDraftStore } = await import('../composerDraftStore');

    // v1 key is cleared after migration.
    expect(window.localStorage.getItem(STORAGE_KEY_V1)).toBeNull();

    const v2Raw = window.localStorage.getItem(STORAGE_KEY_V2);
    expect(v2Raw).not.toBeNull();
    const v2 = JSON.parse(v2Raw!);

    // Migrator fills in editorStateJson:null and preserves prompt as plain.
    expect(v2.legacyA).toEqual({
      editorStateJson: null,
      plain: 'old-style draft',
      attachments: [
        { attachmentId: 'att1', mimeType: 'image/png', url: '/x', sizeBytes: 12 },
      ],
    });
    expect(v2.legacyB).toEqual({
      editorStateJson: null,
      plain: '',
      attachments: [],
    });

    // In-memory state mirrors the migrated payload.
    expect(useComposerDraftStore.getState().getDraft('legacyA').plain).toBe(
      'old-style draft'
    );
    expect(useComposerDraftStore.getState().getDraft('legacyA').editorStateJson).toBeNull();
  });

  it('skips migration when the v1 key is missing and no v2 data is present', async () => {
    const { useComposerDraftStore } = await import('../composerDraftStore');
    expect(useComposerDraftStore.getState().getDraft('missing')).toEqual({
      editorStateJson: null,
      plain: '',
      attachments: [],
    });
    // Nothing should have been written.
    expect(window.localStorage.getItem(STORAGE_KEY_V1)).toBeNull();
    expect(window.localStorage.getItem(STORAGE_KEY_V2)).toBeNull();
  });

  it('ignores malformed v1 JSON rather than throwing', async () => {
    window.localStorage.setItem(STORAGE_KEY_V1, 'not-json-at-all');
    const { useComposerDraftStore } = await import('../composerDraftStore');
    expect(useComposerDraftStore.getState().getDraft('x')).toEqual({
      editorStateJson: null,
      plain: '',
      attachments: [],
    });
  });

  it('flushes pending drafts synchronously on beforeunload', async () => {
    vi.useFakeTimers();
    const { useComposerDraftStore } = await import('../composerDraftStore');

    useComposerDraftStore.getState().setDraft('sess-unload', {
      plain: 'unsaved-text',
    });

    // The debounce has not elapsed yet, so persistence is pending.
    vi.advanceTimersByTime(50);
    expect(window.localStorage.getItem(STORAGE_KEY_V2)).toBeNull();

    // Dispatch beforeunload — the listener is expected to flush synchronously.
    window.dispatchEvent(new Event('beforeunload'));

    const raw = window.localStorage.getItem(STORAGE_KEY_V2);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed['sess-unload']).toEqual({
      editorStateJson: null,
      plain: 'unsaved-text',
      attachments: [],
    });
  });
});
