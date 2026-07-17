import { useEffect, useState } from 'react';
import { useSupervisorStore } from '@/stores/supervisorStore';
import { useTerminalComposerDraftStore } from '@/stores/terminalComposerDraftStore';
import { useTerminalPalette } from './terminalTheme';
import { stageIntoComposer } from './composerStage';

/**
 * SuggestionChips — structured, AI-proposed reply chips derived from the live
 * session summary's `structured` payload (options / suggestedAnswers / aiOption).
 *
 * Tapping a chip STAGES its text into the composer's draft (via composerStage) —
 * it NEVER sends. This is deliberately distinct from InputRail's canned chips,
 * which send immediately.
 *
 * Turn-bound + session-bound: a chip is only shown while `paneHash ===
 * summaryPaneHash` (the question is still on screen) — no separate turn-id is
 * needed, the existing pane-hash pair IS the turn boundary. Switching the
 * focused session naturally hides the old chip because the store lookup key
 * changes with it.
 */

interface SuggestionChipsProps {
  project: string;
  session: string;
  disabled?: boolean;
}

const VACUOUS = /^(ok|okay|sure|continue|got it|sounds good|yes)\.?$/i;

function isVacuous(text: string): boolean {
  const t = text.trim();
  return t.length === 0 || VACUOUS.test(t);
}

/** Client-only desktop-presence check — no new server route/heartbeat. */
function useDesktopPresence(): boolean {
  const [present, setPresent] = useState(() => (typeof document !== 'undefined' ? document.hasFocus() : true));
  useEffect(() => {
    const update = () => setPresent(document.hasFocus());
    window.addEventListener('focus', update);
    window.addEventListener('blur', update);
    document.addEventListener('visibilitychange', update);
    return () => {
      window.removeEventListener('focus', update);
      window.removeEventListener('blur', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, []);
  return present;
}

interface Candidate {
  key: string;
  label: string;
  valueToSend: string;
  mode: 'replace' | 'append';
  recommended?: boolean;
}

export function SuggestionChips({ project, session, disabled = false }: SuggestionChipsProps) {
  const p = useTerminalPalette();
  const present = useDesktopPresence();
  const hasText = useTerminalComposerDraftStore((s) => s.hasText);
  const summary = useSupervisorStore((s) => s.sessionSummaries[`${project}::${session}`]);

  const structured = summary?.structured;
  const isFresh = !!summary && summary.paneHash !== undefined && summary.paneHash === summary.summaryPaneHash;

  if (disabled || !structured || !isFresh || !present || hasText) return null;

  let candidates: Candidate[] = [];
  if (structured.options?.length) {
    // Explicit on-screen menu options are model-curated, not free text — the
    // vacuous filter (meant to drop filler like "ok"/"continue") doesn't apply
    // here, since a real "Yes"/"No" menu choice would otherwise be dropped.
    candidates = structured.options.map((opt, i) => ({
      key: `opt-${i}`,
      label: opt.label,
      valueToSend: opt.valueToSend,
      mode: structured.multiSelect ? ('append' as const) : ('replace' as const),
      recommended: structured.recommended === i,
    }));
  } else if (structured.suggestedAnswers?.length) {
    candidates = structured.suggestedAnswers
      .map((answer, i) => ({ key: `ans-${i}`, label: answer, valueToSend: answer, mode: 'replace' as const }))
      .filter((c) => !isVacuous(c.label));
  } else if (structured.aiOption && !isVacuous(structured.aiOption)) {
    candidates = [{ key: 'ai-option', label: structured.aiOption, valueToSend: structured.aiOption, mode: 'replace' }];
  }

  if (!candidates.length) return null;

  return (
    <div
      role="toolbar"
      aria-label="Suggested replies"
      aria-orientation="horizontal"
      style={{
        display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap',
        flex: '0 0 auto', padding: '4px 14px',
        borderTop: `1px solid ${p.border}`, background: p.surface,
      }}
    >
      {candidates.map((c) => (
        <button
          key={c.key}
          type="button"
          aria-selected={c.recommended || undefined}
          onClick={(e) => { e.preventDefault(); stageIntoComposer(c.valueToSend, c.mode); }}
          title={`Stage "${c.valueToSend}" into the composer (does not send)`}
          style={{
            flex: '0 0 auto', padding: '2px 8px', fontSize: 12, lineHeight: 1.4,
            whiteSpace: 'nowrap', cursor: 'pointer',
            color: c.recommended ? p.accent : p.fg,
            background: p.chipBg,
            border: `1px solid ${c.recommended ? p.accent : p.border}`,
            borderRadius: 4,
          }}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}

export default SuggestionChips;
