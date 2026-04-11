export type ProseOrigin = 'heuristic' | 'manual' | 'llm' | 'mixed' | 'none';

interface ProseOriginBadgeProps {
  origin: ProseOrigin;
  showExplanation?: boolean;
}

const LABELS: Record<ProseOrigin, string> = {
  heuristic: 'AUTO',
  manual: 'MANUAL',
  llm: 'LLM',
  mixed: 'MIXED',
  none: '—',
};

const TOOLTIPS: Record<ProseOrigin, string> = {
  heuristic: 'Auto-generated from docstring — treat as a draft. Upgrade via /pseudocode.',
  manual: 'Human-authored prose. Committed under .collab/pseudo/prose/.',
  llm: 'LLM-authored prose. Committed under .collab/pseudo/prose/.',
  mixed: 'Some methods manual/LLM, others heuristic.',
  none: 'No prose for this file yet.',
};

const CLASS_NAMES: Record<ProseOrigin, string> = {
  heuristic: 'prose-badge prose-badge-heuristic',
  manual: 'prose-badge prose-badge-manual',
  llm: 'prose-badge prose-badge-llm',
  mixed: 'prose-badge prose-badge-mixed',
  none: 'prose-badge prose-badge-none',
};

export function ProseOriginBadge({ origin, showExplanation = false }: ProseOriginBadgeProps) {
  return (
    <span
      className={CLASS_NAMES[origin]}
      title={TOOLTIPS[origin]}
      data-origin={origin}
    >
      {LABELS[origin]}
      {showExplanation && (
        <span className="prose-badge-explanation"> {TOOLTIPS[origin]}</span>
      )}
    </span>
  );
}
