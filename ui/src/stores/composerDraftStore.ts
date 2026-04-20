// Per-session composer draft store (v2).
// In-memory map of { [sessionId]: { editorStateJson, plain, attachments } } with
// 300ms debounced localStorage persistence. Synchronous flush on clearDraft
// and beforeunload. Migrates v1 { prompt, attachments } on init.

import { create } from 'zustand';

export interface ChatMessageAttachment {
  attachmentId: string;
  mimeType: string;
  url: string;
  sizeBytes: number;
}

export interface ComposerDraftV2 {
  editorStateJson: string | null; // Lexical serialized state
  plain: string; // plain-text fallback (also used when Lexical flag off)
  attachments: ChatMessageAttachment[];
}

// Back-compat alias so existing imports of `ComposerDraft` keep working.
export type ComposerDraft = ComposerDraftV2;

interface ComposerDraftV1 {
  prompt: string;
  attachments: ChatMessageAttachment[];
}

const STORAGE_KEY_V1 = 'cmc:composer-draft:v1';
const STORAGE_KEY_V2 = 'cmc:composer-draft:v2';
const DEBOUNCE_MS = 300;
const EMPTY_DRAFT: ComposerDraftV2 = Object.freeze({
  editorStateJson: null,
  plain: '',
  attachments: [],
}) as ComposerDraftV2;

let flushTimer: ReturnType<typeof setTimeout> | null = null;

function flushNow(): void {
  if (flushTimer != null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (typeof window === 'undefined') return;
  try {
    const drafts = useComposerDraftStore.getState().drafts;
    window.localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(drafts));
  } catch (err) {
    console.warn('[composerDraftStore] failed to persist drafts', err);
  }
}

function scheduleFlush(): void {
  if (typeof window === 'undefined') return;
  if (flushTimer != null) clearTimeout(flushTimer);
  flushTimer = setTimeout(flushNow, DEBOUNCE_MS);
}

function parseV2Entry(v: unknown): ComposerDraftV2 | null {
  if (!v || typeof v !== 'object') return null;
  const d = v as Partial<ComposerDraftV2>;
  return {
    editorStateJson:
      typeof d.editorStateJson === 'string' ? d.editorStateJson : null,
    plain: typeof d.plain === 'string' ? d.plain : '',
    attachments: Array.isArray(d.attachments)
      ? (d.attachments as ChatMessageAttachment[])
      : [],
  };
}

function parseV1EntryAsV2(v: unknown): ComposerDraftV2 | null {
  if (!v || typeof v !== 'object') return null;
  const d = v as Partial<ComposerDraftV1>;
  return {
    editorStateJson: null,
    plain: typeof d.prompt === 'string' ? d.prompt : '',
    attachments: Array.isArray(d.attachments)
      ? (d.attachments as ChatMessageAttachment[])
      : [],
  };
}

export function hydrate(): Record<string, ComposerDraftV2> {
  if (typeof window === 'undefined') return {};
  // Try v2 first.
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_V2);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const out: Record<string, ComposerDraftV2> = {};
        for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
          const entry = parseV2Entry(v);
          if (entry) out[k] = entry;
        }
        return out;
      }
    }
  } catch {
    // fall through to v1 migration attempt
  }

  // v2 missing/invalid: try to migrate from v1.
  try {
    const rawV1 = window.localStorage.getItem(STORAGE_KEY_V1);
    if (!rawV1) return {};
    const parsed = JSON.parse(rawV1) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    const migrated: Record<string, ComposerDraftV2> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      const entry = parseV1EntryAsV2(v);
      if (entry) migrated[k] = entry;
    }
    try {
      window.localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(migrated));
      window.localStorage.removeItem(STORAGE_KEY_V1);
    } catch (err) {
      console.warn('[composerDraftStore] failed to write migrated v2 drafts', err);
    }
    return migrated;
  } catch {
    return {};
  }
}

interface ComposerDraftState {
  drafts: Record<string, ComposerDraftV2>;
  setDraft: (sessionId: string, partial: Partial<ComposerDraftV2>) => void;
  getDraft: (sessionId: string) => ComposerDraftV2;
  clearDraft: (sessionId: string) => void;
  _flushNow: () => void;
}

export const useComposerDraftStore = create<ComposerDraftState>((set, get) => ({
  drafts: hydrate(),
  setDraft: (sessionId, partial) => {
    const current = get().drafts[sessionId] ?? EMPTY_DRAFT;
    const merged: ComposerDraftV2 = {
      editorStateJson:
        partial.editorStateJson !== undefined
          ? partial.editorStateJson
          : current.editorStateJson,
      plain: partial.plain !== undefined ? partial.plain : current.plain,
      attachments:
        partial.attachments !== undefined
          ? partial.attachments
          : current.attachments,
    };
    set({ drafts: { ...get().drafts, [sessionId]: merged } });
    scheduleFlush();
  },
  getDraft: (sessionId) => get().drafts[sessionId] ?? EMPTY_DRAFT,
  clearDraft: (sessionId) => {
    const { [sessionId]: _, ...rest } = get().drafts;
    set({ drafts: rest });
    flushNow();
  },
  _flushNow: flushNow,
}));

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    flushNow();
  });
}
