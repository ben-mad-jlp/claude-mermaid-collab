import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useQuickReplyStore } from '@/stores/quickReplyStore';
import { useTerminalPalette } from './terminalTheme';
import { registerComposerDrop } from './composerDrop';

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
  const p = useTerminalPalette();

  const [value, setValue] = useState('');
  // When text file(s) are dropped, hold them here and offer a choice: paste their
  // CONTENTS into the box, or insert their PATH. Non-text drops skip the chooser.
  const [pendingDrop, setPendingDrop] = useState<{ files: File[]; paths: string[] } | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

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

  // Auto-grow: reset to auto to measure scrollHeight, then clamp to MAX_HEIGHT.
  useLayoutEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, MAX_HEIGHT)}px`;
    ta.style.overflowY = ta.scrollHeight > MAX_HEIGHT ? 'auto' : 'hidden';
  }, [value]);

  const send = () => {
    if (disabled) return;
    const text = value;
    if (!text.trim()) return;
    const mc = (window as any).mc;

    // grok-build lane: there is no tmux pane. Route the steer to the in-process
    // loop's inject queue (lands as a user turn at the next step boundary).
    if (injectMode) {
      const injectBody = { project, session, text };
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
      setValue('');
      requestAnimationFrame(() => taRef.current?.focus());
      return;
    }

    // quiet:true — a user typing into their own session is not a supervisor nudge,
    // so suppress the nudge toast (the chips do the same).
    const body = { project, session, text, submit: true, quiet: true };
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
    setValue('');
    // Keep focus in the composer so the user can keep typing.
    requestAnimationFrame(() => taRef.current?.focus());
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
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
      <textarea
        ref={taRef}
        value={value}
        rows={1}
        disabled={disabled}
        placeholder={sendOnEnter ? 'Type a message…  (Enter to send, Shift+Enter for newline)' : 'Type a message…  (⌘/Ctrl+Enter to send)'}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        title={disabled ? undefined : 'Drag a file anywhere in the terminal to insert its path (or paste its contents)'}
        style={{
          flex: '1 1 auto', minWidth: 0, width: '100%', resize: 'none',
          minHeight: 56, maxHeight: MAX_HEIGHT, padding: '6px 8px',
          fontSize: 13, lineHeight: 1.4, fontFamily: 'var(--font-mono, ui-monospace, monospace)',
          color: p.fg, background: p.inputBg,
          border: `1px solid ${p.border}`, borderRadius: 6,
          outline: 'none', transition: 'background 120ms, border-color 120ms',
        }}
        onFocus={(e) => { e.currentTarget.style.borderColor = p.accent; }}
        onBlur={(e) => { e.currentTarget.style.borderColor = p.border; }}
      />
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
