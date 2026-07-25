import type { ApproachAttempt, ApproachRung } from './criterion-approach-store';

export function buildCriterionDiagnosis(input: {
  criterionText: string;
  servedEpicCount: number;
  attempts: ApproachAttempt[];
  distinctReasons: string[];
  missing: ApproachRung[];
}): { body: string; recommendation: string } {
  const lines: string[] = [];

  // Header
  lines.push(`Criterion: "${input.criterionText}"`);
  lines.push(`Served epics: ${input.servedEpicCount}`);
  lines.push('');

  // Rungs tried
  lines.push('Rungs tried:');
  if (input.attempts.length === 0) {
    lines.push('- (no rungs recorded)');
  } else {
    for (const attempt of input.attempts) {
      const detail = attempt.detail ?? '(no detail)';
      lines.push(`- ${attempt.rung}: ${attempt.outcome} — ${detail}`);
    }
  }
  lines.push('');

  // Rungs not yet tried
  lines.push('Rungs not yet tried:');
  if (input.missing.length === 0) {
    lines.push('- (none — ladder exhausted)');
  } else {
    for (const rung of input.missing) {
      lines.push(`- ${rung}`);
    }
  }
  lines.push('');

  // Distinct rejection reasons
  lines.push('Distinct rejection reasons:');
  if (input.distinctReasons.length === 0) {
    lines.push('- (none recorded)');
  } else {
    for (const reason of input.distinctReasons) {
      lines.push(`- ${reason}`);
    }
  }
  lines.push('');

  // Recommendation
  let recommendation: string;
  if (input.missing.length > 0) {
    recommendation = `Try the next rung: ${input.missing[0]}`;
  } else {
    recommendation =
      'The ladder is exhausted. This criterion needs human decision: rescope the requirement or drop it from the mission.';
  }
  lines.push(`Recommendation: ${recommendation}`);

  return {
    body: lines.join('\n'),
    recommendation,
  };
}
