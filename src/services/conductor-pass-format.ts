import type { ConductorPassJournalRow, ConductorFiledRef } from './conductor-pass-journal';

export interface ConductorPassChip { kind: string; id: string; label: string }
export interface FormattedConductorPass { sentence: string; chips: ConductorPassChip[] }

function isTypedFiledRef(x: unknown): x is ConductorFiledRef {
  return (
    x != null && typeof x === 'object' &&
    ((x as any).kind === 'epic' || (x as any).kind === 'leaf' || (x as any).kind === 'card') &&
    typeof (x as any).id === 'string' && typeof (x as any).title === 'string'
  );
}

export function formatConductorPass(row: ConductorPassJournalRow): FormattedConductorPass {
  const parts: string[] = [];
  const chips: ConductorPassChip[] = [];

  parts.push(row.missionId ? `Mission ${row.missionId}` : 'No mission');

  if (row.arm != null) {
    parts.push(`arm: ${row.arm}`);
  }

  if (row.endedAt === null) {
    parts.push('unfinished (killed)');
  }

  if (row.criteriaActed.length) {
    const clause = row.criteriaActed
      .map((c) => {
        let s = `acted on ${c.criterionId} (${c.action})`;
        if (c.servedEpicId) {
          s += ` via epic ${c.servedEpicId}`;
          chips.push({ kind: 'epic', id: c.servedEpicId, label: c.servedEpicId });
        }
        return s;
      })
      .join('; ');
    parts.push(clause);
  }

  if (row.declined.length) {
    const clause = row.declined
      .map((d) => {
        if (d.entityType && d.entityId) {
          chips.push({ kind: d.entityType, id: d.entityId, label: d.entityId });
        }
        return `declined ${d.what} (${d.why})`;
      })
      .join('; ');
    parts.push(clause);
  }

  const typedFiled = Array.isArray(row.filed) && row.filed.every(isTypedFiledRef)
    ? (row.filed as ConductorFiledRef[])
    : null;

  if (typedFiled && typedFiled.length) {
    const clause = typedFiled
      .map((ref) => {
        chips.push({ kind: ref.kind, id: ref.id, label: ref.title });
        return `filed ${ref.kind} ${ref.title}`;
      })
      .join('; ');
    parts.push(clause);
  } else if (row.filed != null && (!Array.isArray(row.filed) || row.filed.length > 0)) {
    parts.push('filed items (legacy record)');
  }

  return { sentence: parts.join('. ') + '.', chips };
}
