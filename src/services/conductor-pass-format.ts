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
    parts.push('killed (ran out of time)');
  }

  if (row.criteriaActed.length) {
    const groups = new Map<string, { action: string; servedEpicId: string; label: string; count: number }>();
    const soloClauses: string[] = [];

    for (const c of row.criteriaActed) {
      if (c.servedEpicId) {
        const key = `${c.action}::${c.servedEpicId}`;
        const existing = groups.get(key);
        if (existing) {
          existing.count += 1;
          if (!existing.label && c.servedEpicNickname) existing.label = c.servedEpicNickname;
        } else {
          groups.set(key, {
            action: c.action,
            servedEpicId: c.servedEpicId,
            label: c.servedEpicNickname || c.servedEpicId.slice(0, 8),
            count: 1,
          });
        }
      } else {
        soloClauses.push(`acted on ${c.criterionId} (${c.action})`);
      }
    }

    const clauses: string[] = [];
    let soloIdx = 0;
    for (const c of row.criteriaActed) {
      if (c.servedEpicId) {
        const key = `${c.action}::${c.servedEpicId}`;
        const g = groups.get(key);
        if (g) {
          const noun = g.count === 1 ? 'criterion' : 'criteria';
          clauses.push(`served ${g.count} ${noun} via epic ${g.label}`);
          chips.push({ kind: 'epic', id: g.servedEpicId, label: g.label });
          groups.delete(key);
        }
      } else {
        clauses.push(soloClauses[soloIdx]);
        soloIdx += 1;
      }
    }
    parts.push(clauses.join('; '));
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
