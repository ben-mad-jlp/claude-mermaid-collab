import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useQuickReplyStore, type AutocorrectMode } from '@/stores/quickReplyStore';
import { useTerminalPalette } from './terminalTheme';
import { registerComposerDrop } from './composerDrop';
import { useAutocorrect } from '@/hooks/useAutocorrect';

/** A contiguous [start,end) span (in the CURRENT draft) that autocorrect changed —
 *  used to paint the green highlight in suggest mode. */
export type HighlightRange = { start: number; end: number };

/** How long the composer waits after the last keystroke before running the suggest
 *  pass (apply-inline + highlight). Long enough to mean "finished typing". */
const SUGGEST_DEBOUNCE_MS = 650;

/**
 * MessageComposer — a real multi-line input below the quick-reply chip bar.
 *
 * The chips are one-tap canned replies; this is for typing an actual message into
 * the live `claude` REPL. An auto-growing textarea (grows with content up to a max,
 * then scrolls), a Send button, and a persisted "send on Enter" toggle:
 *   - send-on-Enter ON  → Enter submits, Shift+Enter inserts a newline.
 *   - send-on-Enter OFF → Enter inserts a newline; the Send button (or ⌘/Ctrl+Enter)
 *     submits.
 *
 * Sends via the same /api/ide/tmux-send-keys path the chips use, with submit:true
 * (types the text, then Enter) — no backend change. After a send the box clears and
 * keeps focus so you can keep typing.
 */

const MAX_HEIGHT = 160; // px — ~8 rows, then the textarea scrolls internally.

interface MessageComposerProps {
  project: string;
  session: string;
  serverId: string;
  /** No attached/live console → greyed + non-interactive (no POST). */
  disabled?: boolean;
  /** When true, the lane is an in-process grok-build worker: submitting routes to
   *  POST /api/worker-inject (queued as a user turn at the next step boundary)
   *  INSTEAD of the tmux send-keys path. Claude lanes leave this false → unchanged. */
  injectMode?: boolean;
}

export function MessageComposer({ project, session, serverId, disabled = false, injectMode = false }: MessageComposerProps) {
  const sendOnEnter = useQuickReplyStore((s) => s.sendOnEnter);
  const setSendOnEnter = useQuickReplyStore((s) => s.setSendOnEnter);
  const autocorrectMode = useQuickReplyStore((s) => s.autocorrectMode);
  const setAutocorrectMode = useQuickReplyStore((s) => s.setAutocorrectMode);
  const p = useTerminalPalette();

  const { mode, correctMessage, vocabWords } = useAutocorrect(project);

  const [value, setValue] = useState('');
  // When text file(s) are dropped, hold them here and offer a choice: paste their
  // CONTENTS into the box, or insert their PATH. Non-text drops skip the chooser.
  const [pendingDrop, setPendingDrop] = useState<{ files: File[]; paths: string[] } | null>(null);
  // suggest mode: the spans (in the current draft) that the last suggest pass changed,
  // painted green via the backdrop overlay. Empty ⇒ no overlay, textarea shows normally.
  const [highlightRanges, setHighlightRanges] = useState<HighlightRange[]>([]);
  // suggest mode: the user pressed Undo (⌘Z / button) after a suggest pass — respect it,
  // don't re-apply on the next debounce or on send until they edit again.
  const [userReverted, setUserReverted] = useState(false);
  const [focused, setFocused] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const undoRef = useRef<{ before: string; after: string } | null>(null);
  const suggestTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sentSpellWordsRef = useRef<Set<string>>(new Set());

  /** Insert `insertText` at the textarea's caret (or replace the selection),
   *  surrounded by single spaces, and leave the caret right after it. */
  const insertAtCaret = (insertText: string) => {
    const ta = taRef.current;
    setValue((prev) => {
      const start = ta?.selectionStart ?? prev.length;
      const end = ta?.selectionEnd ?? prev.length;
      const before = prev.slice(0, start);
      const after = prev.slice(end);
      const lead = before && !before.endsWith(' ') ? ' ' : '';
      const trail = after && !after.startsWith(' ') ? ' ' : '';
      const next = before + lead + insertText + trail + after;
      const caret = (before + lead + insertText).length;
      requestAnimationFrame(() => {
        if (!ta) return;
        ta.focus();
        ta.setSelectionRange(caret, caret);
      });
      return next;
    });
  };

  /** Shell-quote a path that contains whitespace so it pastes into the REPL as one
   *  token. Leaves clean paths bare. */
  const quotePath = (p: string) => (/\s/.test(p) ? `'${p.replace(/'/g, `'\\''`)}'` : p);

  /** Heuristic: is this a text file we could paste the contents of? text/* MIME,
   *  or a known text/code/config extension (many code files report empty type). */
  const TEXT_EXT = /\.(txt|md|markdown|log|csv|tsv|json|jsonc|ya?ml|toml|ini|env|conf|xml|html?|css|scss|less|js|jsx|ts|tsx|mjs|cjs|py|rb|go|rs|java|kt|c|h|cpp|hpp|cs|php|swift|sh|bash|zsh|fish|sql|graphql|gql|svg|diff|patch|gitignore|dockerfile)$/i;
  const isTextFile = (f: File) => f.type.startsWith('text/') || TEXT_EXT.test(f.name) || /^(dockerfile|makefile|\.[\w.-]+rc)$/i.test(f.name);

  const resolvePath = (f: File): string | undefined =>
    (window as any).mc?.getPathForFile?.(f) ?? (f as any).path ?? undefined;

  /** A file:// URI → absolute path (decoded). */
  const fileUriToPath = (uri?: string): string | undefined => {
    const s = (uri ?? '').trim();
    if (!s) return undefined;
    const bare = s.replace(/^file:\/\//, '');
    try { return decodeURIComponent(bare); } catch { return bare; }
  };

  /** Resolve each dropped File to an absolute path. Preload getPathForFile first
   *  (Electron 32+); else the drag's text/uri-list (file:// URIs by index), which
   *  Electron populates for OS file drags even WITHOUT the preload bridge — so this
   *  works before the desktop rebuild ships getPathForFile. */
  const resolveDropPaths = (files: File[], dt: DataTransfer): string[] => {
    const uris = (dt.getData('text/uri-list') || dt.getData('text/plain') || '')
      .split('\n').map((s) => s.trim()).filter((s) => s && !s.startsWith('#'));
    return files
      .map((f, i) => resolvePath(f) ?? fileUriToPath(uris[i]))
      .filter((path): path is string => !!path);
  };

  /** Insert pre-resolved absolute paths (space-joined, shell-quoted). */
  const insertPaths = (paths: string[]) => {
    if (paths.length) insertAtCaret(paths.map(quotePath).join(' '));
    setPendingDrop(null);
  };

  /** Read the dropped files' contents and insert them (multiple files separated by
   *  a blank line). Standard File.text() — works without the preload bridge. */
  const insertContents = async (files: File[]) => {
    setPendingDrop(null);
    try {
      const parts = await Promise.all(files.map((f) => f.text().catch(() => '')));
      const joined = parts.filter(Boolean).join('\n\n');
      if (joined) insertAtCaret(joined);
    } catch { /* best-effort */ }
  };

  // Process a dropped DataTransfer (from the textarea OR the terminal-body drop
  // zone). Returns nothing; updates the composer in place.
  const processDrop = (dt: DataTransfer) => {
    if (disabled) return;
    const files = Array.from(dt.files ?? []);
    if (files.length) {
      const paths = resolveDropPaths(files, dt);
      // A text file could be either useful as a path OR pasted inline → ask.
      // Non-text (binary) files only make sense as a path, so insert it directly.
      if (files.some(isTextFile)) {
        setPendingDrop({ files, paths });
      } else if (paths.length) {
        insertPaths(paths);
      } else {
        // Last resort (no getPathForFile + no uri-list): insert the names so the
        // drop is never silently dead. The desktop rebuild's getPathForFile makes
        // this resolve to the absolute path instead.
        insertAtCaret(files.map((f) => quotePath(f.name)).join(' '));
      }
      return;
    }
    // No OS files (e.g. a path/URI dragged from another app) → fall back to text.
    const path = fileUriToPath(dt.getData('text/uri-list') || dt.getData('text/plain'));
    if (path) insertAtCaret(quotePath(path));
  };

  // Register this composer as the drop target for the whole terminal body, so a
  // file dropped anywhere in the terminal lands here (not just on the textarea).
  useEffect(() => registerComposerDrop(processDrop));

  // Raw-key dispatch to the live REPL (no nudge toast, no Enter unless asked).
  const postKeys = (text: string, submit: boolean) => {
    const body = { project, session, text, submit, quiet: true };
    const mc = (window as any).mc;
    if (mc?.invokeOnServer) {
      void mc.invokeOnServer(serverId, { path: '/api/ide/tmux-send-keys', method: 'POST', body })
        .catch(() => { /* ignore — 404s harmlessly into a just-closed pane */ });
    } else if (typeof fetch !== 'undefined') {
      void fetch('/api/ide/tmux-send-keys', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      }).catch(() => { /* ignore */ });
    }
  };

  // Global terminal shortcuts (work from anywhere in collab):
  //  - Ctrl+Space → jump focus to this composer.
  //  - Ctrl+Esc   → send a raw ESC into the terminal (interrupt/stop the agent).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.metaKey && !e.altKey && e.code === 'Space') {
        e.preventDefault();
        taRef.current?.focus();
        return;
      }
      if (e.ctrlKey && !e.metaKey && !e.altKey && e.key === 'Escape') {
        e.preventDefault();
        if (!disabled) postKeys("\u001b", false); // raw ESC byte, no Enter
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, session, serverId, disabled]);

  // Push new vocab words to the desktop spellchecker's custom dictionary.
  useEffect(() => {
    const add = (window as any).mc?.addSpellCheckWords;
    if (typeof add !== 'function') return; // non-Electron no-op
    const fresh = vocabWords.filter((w) => !sentSpellWordsRef.current.has(w));
    if (fresh.length === 0) return;
    for (const w of fresh) sentSpellWordsRef.current.add(w);
    add(fresh);
  }, [vocabWords]);

  // Auto-grow: reset to auto to measure scrollHeight, then clamp to MAX_HEIGHT.
  useLayoutEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, MAX_HEIGHT)}px`;
    ta.style.overflowY = ta.scrollHeight > MAX_HEIGHT ? 'auto' : 'hidden';
  }, [value]);

  // Suggest mode: after the typing pause, run one whole-message pass — apply the
  // corrections inline and record the changed spans so they paint green. Skipped once
  // the user has explicitly reverted (until they edit again, which clears the flag).
  useEffect(() => {
    if (mode !== 'suggest' || userReverted || disabled || !value.trim()) return;
    if (suggestTimerRef.current) clearTimeout(suggestTimerRef.current);
    suggestTimerRef.current = setTimeout(() => {
      const { corrected, ranges } = computeCorrected(value);
      if (ranges.length && corrected !== value) {
        undoRef.current = { before: value, after: corrected };
        setValue(corrected);
        setHighlightRanges(ranges);
      }
    }, SUGGEST_DEBOUNCE_MS);
    return () => {
      if (suggestTimerRef.current) clearTimeout(suggestTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, mode, userReverted, disabled]);

  // Keep the highlight backdrop scroll-aligned with the textarea (long messages scroll
  // internally past MAX_HEIGHT).
  useLayoutEffect(() => {
    const ta = taRef.current;
    const bd = backdropRef.current;
    if (ta && bd) bd.scrollTop = ta.scrollTop;
  }, [value, highlightRanges]);

  /** Apply every correctMessage hit to `text`, returning the corrected string AND the
   *  changed spans mapped into the NEW string (for the green highlight). Idempotent:
   *  already-corrected text yields no hits → returns the text unchanged with no ranges. */
  const computeCorrected = (text: string): { corrected: string; ranges: HighlightRange[] } => {
    const hits = correctMessage(text);
    if (!hits.length) return { corrected: text, ranges: [] };
    const sorted = [...hits].sort((a, b) => a.start - b.start);
    let out = '';
    let cursor = 0;
    let delta = 0;
    const ranges: HighlightRange[] = [];
    for (const h of sorted) {
      out += text.slice(cursor, h.start);
      const newStart = h.start + delta;
      out += h.to;
      ranges.push({ start: newStart, end: newStart + h.to.length });
      delta += h.to.length - (h.end - h.start);
      cursor = h.end;
    }
    out += text.slice(cursor);
    return { corrected: out, ranges };
  };

  /** Compose-then-submit invariant: the composer NEVER types keystroke-by-keystroke
   *  into tmux — it builds the whole message string and submits it in one POST
   *  (submit:true). That is what makes a batch autocorrect pass safe here: we correct
   *  the FINAL string once (covering the last, unspaced token) and send the result.
   *   - off:     send verbatim.
   *   - suggest: send verbatim after an explicit undo (respect the user's choice); else
   *              flush/idempotent-apply so a send BEFORE the debounce still corrects.
   *   - auto:    pre-send catch-all for the last, still-unspaced token. */
  const correctForSend = (raw: string): string => {
    if (mode === 'off') return raw;
    if (mode === 'suggest') return userReverted ? raw : computeCorrected(raw).corrected;
    const hits = correctMessage(raw);
    let out = raw;
    for (const h of [...hits].sort((a, b) => b.start - a.start)) {
      out = out.slice(0, h.start) + h.to + out.slice(h.end);
    }
    return out;
  };

  /** Revert a suggest-mode pass back to exactly what the user typed (⌘Z or button). */
  const revertCorrections = () => {
    const u = undoRef.current;
    if (!u) return;
    if (suggestTimerRef.current) clearTimeout(suggestTimerRef.current);
    setValue(u.before);
    setHighlightRanges([]);
    setUserReverted(true);
    undoRef.current = null;
    requestAnimationFrame(() => taRef.current?.focus());
  };

  /** Clear the draft and all suggest-mode overlay state after a send. */
  const resetDraft = () => {
    if (suggestTimerRef.current) clearTimeout(suggestTimerRef.current);
    setValue('');
    setHighlightRanges([]);
    setUserReverted(false);
    undoRef.current = null;
    requestAnimationFrame(() => taRef.current?.focus());
  };

  const send = () => {
    if (disabled) return;
    const text = value;
    if (!text.trim()) return;
    const outgoing = correctForSend(text);
    const mc = (window as any).mc;

    // grok-build lane: there is no tmux pane. Route the steer to the in-process
    // loop's inject queue (lands as a user turn at the next step boundary).
    if (injectMode) {
      const injectBody = { project, session, text: outgoing };
      if (mc?.invokeOnServer) {
        void mc
          .invokeOnServer(serverId, { path: '/api/worker-inject', method: 'POST', body: injectBody })
          .catch(() => { /* ignore — inject into a just-ended lane no-ops */ });
      } else if (typeof fetch !== 'undefined') {
        void fetch('/api/worker-inject', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(injectBody),
        }).catch(() => { /* ignore */ });
      }
      resetDraft();
      return;
    }

    // quiet:true — a user typing into their own session is not a supervisor nudge,
    // so suppress the nudge toast (the chips do the same).
    const body = { project, session, text: outgoing, submit: true, quiet: true };
    // Mirror InputRail.sendChip's dispatch: per-server invoke, fetch fallback.
    if (mc?.invokeOnServer) {
      void mc
        .invokeOnServer(serverId, { path: '/api/ide/tmux-send-keys', method: 'POST', body })
        .catch(() => { /* ignore — a send into a just-closed pane 404s harmlessly */ });
    } else if (typeof fetch !== 'undefined') {
      void fetch('/api/ide/tmux-send-keys', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }).catch(() => { /* ignore */ });
    }
    // Keep focus in the composer so the user can keep typing.
    resetDraft();
  };

  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const next = e.target.value;
    setValue(next);
    // suggest: the debounced effect runs the whole-message pass once typing pauses.
    // Editing clears any stale green + the reverted flag so a fresh pass can run.
    // auto/off: NEVER correct while typing — auto corrects only on send (correctForSend).
    if (mode === 'suggest') {
      if (highlightRanges.length) setHighlightRanges([]);
      if (userReverted) setUserReverted(false);
      undoRef.current = null;
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // suggest: ⌘/Ctrl+Z reverts the last debounced correction pass (no learning).
    const u = undoRef.current;
    if (u && value === u.after && e.key === 'z' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      revertCorrections();
      return;
    }
    // ⌘/Ctrl+Enter always sends, regardless of the toggle.
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      send();
      return;
    }
    // Plain Enter: send when the toggle is on (Shift+Enter always = newline).
    if (e.key === 'Enter' && !e.shiftKey && sendOnEnter) {
      e.preventDefault();
      send();
    }
  };

  const canSend = !disabled && value.trim().length > 0;
  const showHighlight = mode === 'suggest' && highlightRanges.length > 0;

  // Shared text-box metrics — the backdrop overlay MUST match the textarea exactly so
  // the green marks sit under the right glyphs (monospace + pre-wrap keeps it aligned).
  const boxFont: React.CSSProperties = {
    padding: '6px 8px',
    fontSize: 13,
    lineHeight: 1.4,
    fontFamily: 'var(--font-mono, ui-monospace, monospace)',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    letterSpacing: 'normal',
  };

  /** Split the draft into plain + <mark> segments for the green-highlight backdrop. */
  const renderHighlighted = (text: string, ranges: HighlightRange[]): React.ReactNode => {
    const sorted = [...ranges].sort((a, b) => a.start - b.start);
    const nodes: React.ReactNode[] = [];
    let cursor = 0;
    sorted.forEach((r, i) => {
      if (r.start > cursor) nodes.push(<span key={`t${i}`}>{text.slice(cursor, r.start)}</span>);
      nodes.push(
        <mark key={`m${i}`} style={{ background: 'rgba(46,160,67,0.38)', color: 'inherit', borderRadius: 2 }}>
          {text.slice(r.start, r.end)}
        </mark>,
      );
      cursor = r.end;
    });
    // A trailing '\n' collapses the last line in a block box — pad it so heights match.
    const tail = text.slice(cursor);
    nodes.push(<span key="tail">{tail.endsWith('\n') ? `${tail} ` : tail}</span>);
    return nodes;
  };

  return (
    <div
      style={{
        position: 'relative', display: 'flex', alignItems: 'flex-end', gap: 8,
        flex: '0 0 auto', padding: '12px 14px 16px',
        borderTop: `1px solid ${p.border}`, background: p.surface,
        opacity: disabled ? 0.5 : 1, pointerEvents: disabled ? 'none' : 'auto',
      }}
      title={disabled ? 'No console attached' : undefined}
    >
      {/* Drop chooser — a text file can be inserted as a path OR pasted inline. */}
      {pendingDrop && (
        <div
          style={{
            position: 'absolute', left: 14, right: 14, bottom: 'calc(100% - 2px)', zIndex: 20,
            display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
            padding: '8px 10px', fontSize: 12, color: p.fg,
            background: p.surface, border: `1px solid ${p.accent}`, borderRadius: 8,
            boxShadow: '0 6px 18px rgba(0,0,0,0.35)',
          }}
        >
          <span style={{ flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {pendingDrop.files.length === 1 ? pendingDrop.files[0].name : `${pendingDrop.files.length} files`}
          </span>
          <button type="button" onClick={() => void insertContents(pendingDrop.files)}
            style={btn(p.primary, p.primaryBorder, p.primaryFg)}>Paste contents</button>
          <button type="button" onClick={() => insertPaths(pendingDrop.paths)} disabled={pendingDrop.paths.length === 0}
            style={btn(p.chipBg, p.border, p.fg)}>Insert path{pendingDrop.files.length > 1 ? 's' : ''}</button>
          <button type="button" onClick={() => setPendingDrop(null)} title="Cancel"
            style={{ ...btn('transparent', 'transparent', p.mutedFg), padding: '4px 8px' }}>✕</button>
        </div>
      )}
      {/* Suggest mode: after the debounced pass applies corrections (painted green in the
          box), offer a one-tap revert. ⌘/Ctrl+Z does the same from the keyboard. */}
      {showHighlight && !pendingDrop && (
        <div
          style={{
            position: 'absolute', left: 14, bottom: 'calc(100% - 2px)', zIndex: 20,
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '4px 10px', fontSize: 12, color: p.fg,
            background: p.surface, border: `1px solid ${p.accent}`, borderRadius: 8,
            boxShadow: '0 6px 18px rgba(0,0,0,0.35)',
          }}
        >
          <span style={{ color: p.mutedFg }}>
            Autocorrected {highlightRanges.length} word{highlightRanges.length === 1 ? '' : 's'}
          </span>
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={revertCorrections}
            title="Undo the corrections (⌘/Ctrl+Z)"
            style={btn(p.chipBg, p.border, p.fg)}>Undo ⌘Z</button>
        </div>
      )}
      {/* Text box: a backdrop mirror paints the green marks; the textarea sits on top with
          transparent text (only while highlighting) so the marks show through, and keeps
          the caret/selection. The wrapper carries the visible box (bg + border). */}
      <div
        style={{
          position: 'relative', flex: '1 1 auto', minWidth: 0,
          background: p.inputBg, border: `1px solid ${focused ? p.accent : p.border}`,
          borderRadius: 6, transition: 'border-color 120ms',
        }}
      >
        <div
          ref={backdropRef}
          aria-hidden="true"
          style={{
            ...boxFont,
            position: 'absolute', inset: 0, margin: 0,
            overflow: 'hidden', pointerEvents: 'none',
            color: p.fg, opacity: showHighlight ? 1 : 0,
          }}
        >
          {showHighlight ? renderHighlighted(value, highlightRanges) : null}
        </div>
        <textarea
          ref={taRef}
          value={value}
          rows={1}
          spellCheck={true}
          disabled={disabled}
          placeholder={sendOnEnter ? 'Type a message…  (Enter to send, Shift+Enter for newline)' : 'Type a message…  (⌘/Ctrl+Enter to send)'}
          onChange={onChange}
          onKeyDown={onKeyDown}
          onScroll={(e) => { const bd = backdropRef.current; if (bd) bd.scrollTop = e.currentTarget.scrollTop; }}
          title={disabled ? undefined : 'Drag a file anywhere in the terminal to insert its path (or paste its contents)'}
          style={{
            ...boxFont,
            position: 'relative', display: 'block', width: '100%', resize: 'none',
            minHeight: 56, maxHeight: MAX_HEIGHT, margin: 0,
            color: showHighlight ? 'transparent' : p.fg,
            caretColor: p.fg, background: 'transparent',
            border: 'none', borderRadius: 6, outline: 'none',
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 4, flex: '0 0 auto' }}>
        <button
          type="button" disabled={!canSend} onClick={send} title="Send to the terminal"
          style={{
            padding: '5px 14px', fontSize: 13, lineHeight: 1.4, fontWeight: 600,
            cursor: canSend ? 'pointer' : 'default',
            color: canSend ? p.primaryFg : p.mutedFg,
            background: canSend ? p.primary : p.chipBg,
            border: `1px solid ${canSend ? p.primaryBorder : p.border}`,
            borderRadius: 6, transition: 'background 120ms, color 120ms',
          }}
        >
          Send
        </button>
        <label
          title="When on, Enter sends and Shift+Enter inserts a newline"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            fontSize: 11, lineHeight: 1.2, color: p.mutedFg,
            cursor: disabled ? 'default' : 'pointer', whiteSpace: 'nowrap', userSelect: 'none',
          }}
        >
          <input
            type="checkbox" checked={sendOnEnter} disabled={disabled}
            onChange={(e) => setSendOnEnter(e.target.checked)}
            style={{ cursor: disabled ? 'default' : 'pointer', margin: 0, accentColor: p.accent }}
          />
          Enter sends
        </label>
        <label
          title="Autocorrect for typed messages: off · suggest (preview corrections in green after you pause, ⌘Z/Undo to revert) · auto (corrects silently on send)"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            fontSize: 11, lineHeight: 1.2, color: p.mutedFg,
            cursor: disabled ? 'default' : 'pointer', whiteSpace: 'nowrap', userSelect: 'none',
          }}
        >
          Autocorrect
          <select
            data-testid="autocorrect-mode-select"
            value={autocorrectMode}
            disabled={disabled}
            onChange={(e) => setAutocorrectMode(e.target.value as AutocorrectMode)}
            style={{
              cursor: disabled ? 'default' : 'pointer', fontSize: 11, lineHeight: 1.2,
              color: p.mutedFg, background: 'transparent',
              border: `1px solid ${p.border}`, borderRadius: 4, padding: '1px 4px',
            }}
          >
            <option value="off">off</option>
            <option value="suggest">suggest</option>
            <option value="auto">auto</option>
          </select>
        </label>
      </div>
    </div>
  );
}

/** Shared inline style for the small composer buttons. */
function btn(bg: string, border: string, color: string): React.CSSProperties {
  return {
    flex: '0 0 auto', padding: '4px 10px', fontSize: 12, lineHeight: 1.3,
    fontWeight: 600, cursor: 'pointer', color,
    background: bg, border: `1px solid ${border}`, borderRadius: 6,
  };
}

export default MessageComposer;
