import React, { useRef, useState, useCallback } from 'react';
import type { PermissionMode } from '@/types/agent';
import PermissionModeSelector from './PermissionModeSelector';
import SlashCommandPicker from './SlashCommandPicker';
import FileMentionPicker from './FileMentionPicker';
import AttachmentDropzone from './AttachmentDropzone';
import { useAgentStore } from '../../stores/agentStore';
import useAgentShortcuts from '../../hooks/useAgentShortcuts';

export interface TurnInputProps {
  onSend: (text: string) => void;
  onCancel?: () => void;
  disabled?: boolean;
  placeholder?: string;
  permissionMode: PermissionMode;
  onModeChange: (mode: PermissionMode) => void;
  sessionId?: string;
}

// Compute the @-mention query based on cursor position. Returns the partial
// path after the most recent `@` if the cursor sits in a mention token,
// otherwise null.
function computeMentionQuery(value: string, caret: number): { query: string; start: number } | null {
  if (caret <= 0) return null;
  // Find the nearest '@' before the caret with no whitespace between it and caret
  let i = caret - 1;
  while (i >= 0) {
    const ch = value[i];
    if (ch === '@') {
      // Must be start-of-string or preceded by whitespace
      if (i === 0 || /\s/.test(value[i - 1])) {
        const partial = value.slice(i + 1, caret);
        // Only trigger when the partial is word-ish (path chars)
        if (/^[\w./\-]*$/.test(partial)) {
          return { query: partial, start: i };
        }
      }
      return null;
    }
    if (/\s/.test(ch)) return null;
    i--;
  }
  return null;
}

export const TurnInput: React.FC<TurnInputProps> = ({
  onSend,
  onCancel,
  disabled = false,
  placeholder = 'Message the agent…',
  permissionMode,
  onModeChange,
  sessionId,
}) => {
  const [value, setValue] = useState('');
  const [caret, setCaret] = useState(0);
  const [slashOpen, setSlashOpen] = useState(false);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);

  const pushUserMessage = useAgentStore((s) => s.pushUserMessage);
  const recallUserMessage = useAgentStore((s) => s.recallUserMessage);
  const addAttachment = useAgentStore((s) => s.addAttachment);
  const userMessageHistory = useAgentStore((s) => s.userMessageHistory);

  const updateFromValue = (next: string, nextCaret: number) => {
    setValue(next);
    setCaret(nextCaret);
    // Slash picker visibility: input starts with '/'
    setSlashOpen(next.startsWith('/'));
    // Mention picker visibility
    const mention = computeMentionQuery(next, nextCaret);
    setMentionOpen(mention !== null);
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const next = e.target.value;
    const nextCaret = e.target.selectionStart ?? next.length;
    updateFromValue(next, nextCaret);
    setHistoryIndex(null);
    if (ref.current) {
      ref.current.style.height = 'auto';
      ref.current.style.height = `${Math.min(ref.current.scrollHeight, 150)}px`;
    }
  };

  const handleSelect = (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    setCaret(el.selectionStart ?? 0);
    const mention = computeMentionQuery(el.value, el.selectionStart ?? 0);
    setMentionOpen(mention !== null);
  };

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    pushUserMessage(trimmed);
    setValue('');
    setCaret(0);
    setSlashOpen(false);
    setMentionOpen(false);
    setHistoryIndex(null);
    if (ref.current) ref.current.style.height = 'auto';
  }, [value, disabled, onSend, pushUserMessage]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // ArrowUp: history recall when input is empty (or already recalling)
    if (e.key === 'ArrowUp' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
      if (value === '' || historyIndex !== null) {
        if (userMessageHistory.length > 0) {
          e.preventDefault();
          const nextIdx =
            historyIndex === null
              ? userMessageHistory.length - 1
              : Math.max(0, historyIndex - 1);
          const recalled = recallUserMessage(nextIdx);
          if (recalled !== undefined) {
            setHistoryIndex(nextIdx);
            setValue(recalled);
            setCaret(recalled.length);
          }
          return;
        }
      }
    }
    if (e.key === 'ArrowDown' && historyIndex !== null && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      const nextIdx = historyIndex + 1;
      if (nextIdx >= userMessageHistory.length) {
        setHistoryIndex(null);
        setValue('');
        setCaret(0);
      } else {
        const recalled = recallUserMessage(nextIdx);
        if (recalled !== undefined) {
          setHistoryIndex(nextIdx);
          setValue(recalled);
          setCaret(recalled.length);
        }
      }
      return;
    }
    // Let pickers handle Enter/Arrow/Escape when open
    if (slashOpen || mentionOpen) {
      if (e.key === 'Enter' || e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'Escape') {
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !(e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSlashSelect = (cmd: { name: string }) => {
    setValue(cmd.name);
    setCaret(cmd.name.length);
    setSlashOpen(false);
    ref.current?.focus();
  };

  const handleMentionSelect = (path: string) => {
    const mention = computeMentionQuery(value, caret);
    if (!mention) {
      setMentionOpen(false);
      return;
    }
    const before = value.slice(0, mention.start);
    const after = value.slice(caret);
    const insertion = `@${path} `;
    const next = before + insertion + after;
    const nextCaret = before.length + insertion.length;
    setValue(next);
    setCaret(nextCaret);
    setMentionOpen(false);
    requestAnimationFrame(() => {
      if (ref.current) {
        ref.current.focus();
        ref.current.setSelectionRange(nextCaret, nextCaret);
      }
    });
  };

  const handleAttachmentUpload = useCallback(
    (a: { id: string; url: string; mimeType: string; name: string }) => {
      if (!sessionId) return;
      addAttachment(sessionId, {
        attachmentId: a.id,
        mimeType: a.mimeType,
        url: a.url,
        sizeBytes: 0,
      });
    },
    [sessionId, addAttachment],
  );

  // Wire keyboard shortcuts
  useAgentShortcuts({
    onSend: handleSend,
    onCancel: onCancel,
    onFocus: () => ref.current?.focus(),
    onSlash: () => {
      setValue((v) => (v.startsWith('/') ? v : '/'));
      setSlashOpen(true);
      ref.current?.focus();
    },
    onMention: () => {
      const el = ref.current;
      if (!el) return;
      const pos = el.selectionStart ?? value.length;
      const before = value.slice(0, pos);
      const after = value.slice(pos);
      const needsSpace = before.length > 0 && !/\s$/.test(before);
      const insertion = (needsSpace ? ' @' : '@');
      const next = before + insertion + after;
      const nextCaret = before.length + insertion.length;
      setValue(next);
      setCaret(nextCaret);
      setMentionOpen(true);
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(nextCaret, nextCaret);
      });
    },
  });

  const slashQuery = slashOpen ? value.slice(1) : '';
  const mentionInfo = computeMentionQuery(value, caret);
  const mentionQuery = mentionInfo ? mentionInfo.query : '';

  const textarea = (
    <textarea
      ref={ref}
      value={value}
      onChange={handleChange}
      onSelect={handleSelect}
      onKeyDown={handleKeyDown}
      disabled={disabled}
      rows={1}
      placeholder={placeholder}
      style={{ minHeight: '38px' }}
      className="block w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed resize-none overflow-hidden"
    />
  );

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <PermissionModeSelector value={permissionMode} onChange={onModeChange} disabled={disabled} />
      </div>
      <div className="flex gap-2 items-end relative">
        <div className="flex-1 relative">
          {slashOpen && (
            <SlashCommandPicker
              query={slashQuery}
              onSelect={handleSlashSelect}
              onDismiss={() => setSlashOpen(false)}
            />
          )}
          {mentionOpen && (
            <FileMentionPicker
              query={mentionQuery}
              onSelect={handleMentionSelect}
              onDismiss={() => setMentionOpen(false)}
            />
          )}
          {sessionId ? (
            <AttachmentDropzone sessionId={sessionId} onUpload={handleAttachmentUpload}>
              {textarea}
            </AttachmentDropzone>
          ) : (
            textarea
          )}
        </div>
        {onCancel ? (
          <button
            onClick={onCancel}
            aria-label="Stop generating"
            className="flex-shrink-0 px-4 py-2 text-sm font-medium bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
          >
            Stop
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={disabled || !value.trim()}
            aria-label="Send message"
            className="flex-shrink-0 px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Send
          </button>
        )}
      </div>
    </div>
  );
};

TurnInput.displayName = 'TurnInput';
