import { useLayoutEffect, useRef, useState } from 'react';
import { useQuickReplyStore } from '@/stores/quickReplyStore';

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
}

export function MessageComposer({ project, session, serverId, disabled = false }: MessageComposerProps) {
  const sendOnEnter = useQuickReplyStore((s) => s.sendOnEnter);
  const setSendOnEnter = useQuickReplyStore((s) => s.setSendOnEnter);

  const [value, setValue] = useState('');
  const taRef = useRef<HTMLTextAreaElement>(null);

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
    const body = { project, session, text, submit: true };
    const mc = (window as any).mc;
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
        display: 'flex', alignItems: 'flex-end', gap: 6,
        flex: '0 0 auto',
        padding: '6px',
        borderTop: '1px solid #30363d',
        background: '#161b22',
        opacity: disabled ? 0.5 : 1,
        pointerEvents: disabled ? 'none' : 'auto',
      }}
      title={disabled ? 'No console attached' : undefined}
    >
      <textarea
        ref={taRef}
        value={value}
        rows={1}
        disabled={disabled}
        placeholder={sendOnEnter ? 'Type a message…  (Enter to send, Shift+Enter for newline)' : 'Type a message…  (⌘/Ctrl+Enter to send)'}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        style={{
          flex: '1 1 auto',
          resize: 'none',
          minHeight: 28,
          maxHeight: MAX_HEIGHT,
          padding: '5px 8px',
          fontSize: 13,
          lineHeight: 1.4,
          fontFamily: 'inherit',
          color: '#c9d1d9',
          background: '#0d1117',
          border: '1px solid #30363d',
          borderRadius: 6,
          outline: 'none',
        }}
        onFocus={(e) => { e.currentTarget.style.borderColor = '#58a6ff'; }}
        onBlur={(e) => { e.currentTarget.style.borderColor = '#30363d'; }}
      />
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 4, flex: '0 0 auto' }}>
        <button
          type="button"
          disabled={!canSend}
          onClick={send}
          title="Send to the terminal"
          style={{
            padding: '5px 14px', fontSize: 13, lineHeight: 1.4, fontWeight: 600,
            cursor: canSend ? 'pointer' : 'default',
            color: canSend ? '#ffffff' : '#8b949e',
            background: canSend ? '#238636' : '#21262d',
            border: `1px solid ${canSend ? '#2ea043' : '#30363d'}`,
            borderRadius: 6,
            transition: 'background 120ms, color 120ms',
          }}
        >
          Send
        </button>
        <label
          title="When on, Enter sends and Shift+Enter inserts a newline"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            fontSize: 11, lineHeight: 1.2, color: '#8b949e',
            cursor: disabled ? 'default' : 'pointer', whiteSpace: 'nowrap',
            userSelect: 'none',
          }}
        >
          <input
            type="checkbox"
            checked={sendOnEnter}
            disabled={disabled}
            onChange={(e) => setSendOnEnter(e.target.checked)}
            style={{ cursor: disabled ? 'default' : 'pointer', margin: 0 }}
          />
          Enter sends
        </label>
      </div>
    </div>
  );
}

export default MessageComposer;
