import { useEffect } from 'react';

export interface UseAgentShortcutsOptions {
  onSend?: () => void;
  onCancel?: () => void;
  onFocus?: () => void;
  onSlash?: () => void;
  onMention?: () => void;
  enabled?: boolean;
}

export function useAgentShortcuts({
  onSend, onCancel, onFocus, onSlash, onMention, enabled = true,
}: UseAgentShortcutsOptions): void {
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    const handler = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key === 'Enter' && onSend) { e.preventDefault(); onSend(); return; }
      if (e.key === 'Escape' && onCancel) { onCancel(); return; }
      if (mod && (e.key === 'k' || e.key === 'K') && onFocus) { e.preventDefault(); onFocus(); return; }
      if (mod && e.key === '/' && onSlash) { e.preventDefault(); onSlash(); return; }
      if (mod && e.key === '@' && onMention) { e.preventDefault(); onMention(); return; }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onSend, onCancel, onFocus, onSlash, onMention, enabled]);
}

export default useAgentShortcuts;
