import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

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

describe('composerDraftStore (v2)', () => {
  it('migrates v1 shape to v2 on init and deletes v1 key', async () => {
    window.localStorage.setItem(
      STORAGE_KEY_V1,
      JSON.stringify({
        s1: {
          prompt: 'legacy prompt',
          attachments: [
            { attachmentId: 'a1', mimeType: 'image/png', url: '/x', sizeBytes: 5 },
          ],
        },
        s2: { prompt: 'second', attachments: [] },
      })
    );
    const { useComposerDraftStore } = await import('../composerDraftStore');

    // v1 key removed
    expect(window.localStorage.getItem(STORAGE_KEY_V1)).toBeNull();

    // v2 key written with migrated contents
    const rawV2 = window.localStorage.getItem(STORAGE_KEY_V2);
    expect(rawV2).not.toBeNull();
    const parsed = JSON.parse(rawV2!);
    expect(parsed.s1).toEqual({
      editorStateJson: null,
      plain: 'legacy prompt',
      attachments: [
        { attachmentId: 'a1', mimeType: 'image/png', url: '/x', sizeBytes: 5 },
      ],
    });
    expect(parsed.s2).toEqual({
      editorStateJson: null,
      plain: 'second',
      attachments: [],
    });

    // In-memory state reflects v2 shape
    const draft = useComposerDraftStore.getState().getDraft('s1');
    expect(draft.plain).toBe('legacy prompt');
    expect(draft.editorStateJson).toBeNull();
    expect(draft.attachments).toHaveLength(1);
  });

  it('reads existing v2 contents and leaves v1 alone when v2 present', async () => {
    window.localStorage.setItem(
      STORAGE_KEY_V2,
      JSON.stringify({
        s1: {
          editorStateJson: '{"root":{}}',
          plain: 'hello',
          attachments: [],
        },
      })
    );
    const { useComposerDraftStore } = await import('../composerDraftStore');
    const draft = useComposerDraftStore.getState().getDraft('s1');
    expect(draft.editorStateJson).toBe('{"root":{}}');
    expect(draft.plain).toBe('hello');
  });

  it('getDraft returns empty v2 default for unknown session', async () => {
    const { useComposerDraftStore } = await import('../composerDraftStore');
    expect(useComposerDraftStore.getState().getDraft('nope')).toEqual({
      editorStateJson: null,
      plain: '',
      attachments: [],
    });
  });

  it('setDraft persists v2 shape after debounce', async () => {
    vi.useFakeTimers();
    const { useComposerDraftStore } = await import('../composerDraftStore');
    useComposerDraftStore.getState().setDraft('s1', {
      plain: 'draft text',
      editorStateJson: '{"x":1}',
    });

    // Before debounce fires, nothing persisted
    vi.advanceTimersByTime(299);
    expect(window.localStorage.getItem(STORAGE_KEY_V2)).toBeNull();

    // After 300ms, write occurs
    vi.advanceTimersByTime(1);
    const raw = window.localStorage.getItem(STORAGE_KEY_V2);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.s1).toEqual({
      editorStateJson: '{"x":1}',
      plain: 'draft text',
      attachments: [],
    });
  });

  it('partial patches preserve unchanged fields', async () => {
    const { useComposerDraftStore } = await import('../composerDraftStore');
    const { setDraft, getDraft } = useComposerDraftStore.getState();

    setDraft('s1', {
      plain: 'initial',
      editorStateJson: '{"a":1}',
      attachments: [
        { attachmentId: 'a1', mimeType: 'image/png', url: '/x', sizeBytes: 10 },
      ],
    });

    // Patch only plain
    setDraft('s1', { plain: 'updated' });
    let d = getDraft('s1');
    expect(d.plain).toBe('updated');
    expect(d.editorStateJson).toBe('{"a":1}');
    expect(d.attachments).toHaveLength(1);

    // Patch only editorStateJson
    setDraft('s1', { editorStateJson: '{"b":2}' });
    d = getDraft('s1');
    expect(d.plain).toBe('updated');
    expect(d.editorStateJson).toBe('{"b":2}');
    expect(d.attachments).toHaveLength(1);

    // Patch only attachments
    setDraft('s1', { attachments: [] });
    d = getDraft('s1');
    expect(d.plain).toBe('updated');
    expect(d.editorStateJson).toBe('{"b":2}');
    expect(d.attachments).toEqual([]);
  });

  it('setDraft can explicitly set editorStateJson back to null', async () => {
    const { useComposerDraftStore } = await import('../composerDraftStore');
    const { setDraft, getDraft } = useComposerDraftStore.getState();
    setDraft('s1', { editorStateJson: '{"a":1}' });
    expect(getDraft('s1').editorStateJson).toBe('{"a":1}');
    setDraft('s1', { editorStateJson: null });
    expect(getDraft('s1').editorStateJson).toBeNull();
  });

  it('clearDraft removes entry and flushes immediately', async () => {
    const { useComposerDraftStore } = await import('../composerDraftStore');
    useComposerDraftStore.getState().setDraft('s1', { plain: 'hello' });
    useComposerDraftStore.getState()._flushNow();
    useComposerDraftStore.getState().clearDraft('s1');
    expect(useComposerDraftStore.getState().getDraft('s1')).toEqual({
      editorStateJson: null,
      plain: '',
      attachments: [],
    });
    const raw = window.localStorage.getItem(STORAGE_KEY_V2);
    expect(JSON.parse(raw!).s1).toBeUndefined();
  });

  it('malformed v2 JSON falls back to v1 migration if present', async () => {
    window.localStorage.setItem(STORAGE_KEY_V2, 'not{json');
    window.localStorage.setItem(
      STORAGE_KEY_V1,
      JSON.stringify({ s1: { prompt: 'from v1', attachments: [] } })
    );
    const { useComposerDraftStore } = await import('../composerDraftStore');
    expect(useComposerDraftStore.getState().getDraft('s1').plain).toBe('from v1');
  });
});
