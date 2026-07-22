import type { ZenStructured } from '@/stores/supervisorStore';

/**
 * composerGhost — pick the single inline GHOST suggestion for the terminal composer
 * from a session's `structured` interpret payload.
 *
 * This replaces the old SuggestionChips chip row: instead of a row of tappable chips,
 * the composer shows ONE greyed inline suggestion over the empty textarea that the
 * user can accept (Tab / →) or send directly (Enter / Send).
 *
 * Selection (mirrors the chip row's precedence, collapsed to a single value):
 *   - question turn with an on-screen menu → the `recommended` (else first)
 *     `options[].valueToSend`. Menu options are model-curated real choices, so the
 *     vacuous filter does NOT apply (a legitimate "Yes"/"No" must survive).
 *   - open question with no menu → the first non-vacuous `suggestedAnswers[]`.
 *   - idle, question-free turn → `aiOption`, if non-vacuous.
 *
 * Returns null when nothing worth showing (keeps the composer clean).
 */

const VACUOUS = /^(ok|okay|sure|continue|got it|sounds good|yes)\.?$/i;

/** Filler replies that add no signal — never worth a ghost. */
export function isVacuous(text: string): boolean {
  const t = text.trim();
  return t.length === 0 || VACUOUS.test(t);
}

export function pickGhost(structured: ZenStructured | undefined | null): string | null {
  if (!structured) return null;

  if (structured.options?.length) {
    const rec = structured.recommended;
    const idx = typeof rec === 'number' && rec >= 0 && rec < structured.options.length ? rec : 0;
    const value = structured.options[idx]?.valueToSend?.trim();
    return value ? value : null;
  }

  if (structured.suggestedAnswers?.length) {
    const first = structured.suggestedAnswers.find((a) => !isVacuous(a));
    return first ? first.trim() : null;
  }

  if (structured.aiOption && !isVacuous(structured.aiOption)) {
    return structured.aiOption.trim();
  }

  return null;
}
