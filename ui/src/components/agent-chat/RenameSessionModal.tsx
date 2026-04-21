import React, { useEffect, useRef, useState } from 'react';
import { useAgentSession } from '../../hooks/useAgentSession';

export interface RenameSessionModalProps {
  sessionId: string;
  currentName?: string;
  isOpen: boolean;
  onClose: () => void;
}

export function RenameSessionModal({ sessionId, currentName, isOpen, onClose }: RenameSessionModalProps) {
  const { renameSession } = useAgentSession(sessionId);
  const [value, setValue] = useState(currentName ?? '');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setValue(currentName ?? '');
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [isOpen, currentName]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const trimmed = value.trim();
  const valid = trimmed.length >= 1 && trimmed.length <= 128;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    renameSession(trimmed);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-modal="true" aria-label="Rename session">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden />
      <form onSubmit={submit} data-testid="rename-session-modal" className="relative z-10 w-96 max-w-[90vw] rounded-lg border bg-background p-4 shadow-lg">
        <h2 className="text-base font-semibold mb-3">Rename session</h2>
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={128}
          placeholder="Session name"
          className="w-full rounded border bg-input px-2 py-1 text-sm"
          data-testid="rename-session-input"
        />
        <div className="mt-1 text-[11px] text-muted-foreground">{trimmed.length}/128</div>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-1 text-sm rounded hover:bg-accent">Cancel</button>
          <button type="submit" disabled={!valid} data-testid="rename-session-submit" className="px-3 py-1 text-sm rounded bg-primary text-primary-foreground disabled:opacity-50">
            Rename
          </button>
        </div>
      </form>
    </div>
  );
}

export default RenameSessionModal;
