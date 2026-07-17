/**
 * composerStage — a tiny singleton bridge so a suggestion chip ANYWHERE in the
 * terminal can stage text into the message composer's draft WITHOUT sending it.
 * Mirrors composerDrop.ts's registration pattern.
 */

type StageHandler = (text: string, mode: 'replace' | 'append') => void;

let current: StageHandler | null = null;

/** The composer calls this on mount; returns an unregister fn for cleanup. */
export function registerComposerStage(handler: StageHandler): () => void {
  current = handler;
  return () => { if (current === handler) current = null; };
}

/** Stage `text` into the registered composer. mode 'replace' overwrites the draft
 *  (single-select / free-form chip); 'append' space-joins onto the existing draft,
 *  toggling the token off if it's already present (multiSelect chip). Returns
 *  whether a composer was registered. NEVER sends — no network call happens here. */
export function stageIntoComposer(text: string, mode: 'replace' | 'append' = 'replace'): boolean {
  if (!current) return false;
  current(text, mode);
  return true;
}
