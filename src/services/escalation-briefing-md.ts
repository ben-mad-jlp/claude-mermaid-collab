/**
 * DETERMINISTIC (no-LLM) markdown renderer over an enriched TriageBundle.
 *
 * This is the "deterministic floor" a human sees for an escalation: pure string
 * assembly over the read-only ground-truth bundle packBundle() produced. NO model
 * is involved — same input always yields the same markdown. Robust to every
 * enriched field being missing (they are all optional/best-effort on the bundle).
 *
 * Sections:
 *   ## Decision        — the question + any structured A/B option labels
 *   ## Situation       — linked todo title/status/retry, raiseDetail highlights, git drift
 *   ## System context  — plan-graph neighbors, epic branch health, prior-escalation count
 */

import type { TriageBundle } from './grok-triage.ts';

/** Options may ride on the bundle's escalation echo in the future; accept a loose
 *  shape so the renderer stays decoupled from the Escalation type. */
export interface RenderOptions {
  /** Structured A/B option labels, when the escalation carried them. */
  options?: Array<{ id: string; label: string; detail?: string }> | null;
}

function fmtStatus(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  return String(v);
}

/** Pull a few human-legible highlights out of an arbitrary raiseDetail blob.
 *  Best-effort: recognizes common raise-time keys (gate/tsc/verdict/conflicts). */
function raiseDetailHighlights(detail: unknown): string[] {
  const out: string[] = [];
  if (!detail || typeof detail !== 'object') return out;
  const d = detail as Record<string, unknown>;
  const scalar = (k: string, label: string) => {
    const v = d[k];
    if (v !== undefined && v !== null && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')) {
      out.push(`- ${label}: ${String(v)}`);
    }
  };
  scalar('verdict', 'Verdict');
  scalar('reason', 'Reason');
  scalar('gate', 'Gate');
  scalar('gateOutput', 'Gate output');
  scalar('tsc', 'tsc');
  scalar('error', 'Error');
  const conflicts = d['conflicts'] ?? d['conflictFiles'];
  if (Array.isArray(conflicts) && conflicts.length) {
    out.push(`- Conflict files: ${conflicts.map((c) => String(c)).join(', ')}`);
  }
  return out;
}

export function renderBundleMarkdown(bundle: TriageBundle, opts: RenderOptions = {}): string {
  const lines: string[] = [];
  const esc = bundle?.escalation ?? { id: '', kind: '', questionText: '', todoId: null };

  // -------- Decision --------
  lines.push('## Decision');
  lines.push('');
  lines.push(esc.questionText?.trim() ? esc.questionText.trim() : '_(no question text)_');
  const options = opts.options ?? null;
  if (options && options.length) {
    lines.push('');
    lines.push('Options:');
    for (const o of options) {
      const label = o.label?.trim() || o.id;
      lines.push(o.detail?.trim() ? `- **${label}** — ${o.detail.trim()}` : `- **${label}**`);
    }
  }

  // -------- Situation --------
  lines.push('');
  lines.push('## Situation');
  lines.push('');
  const todo = bundle?.todo ?? null;
  if (todo) {
    lines.push(`- Todo: **${todo.title || todo.id}** (\`${todo.id}\`)`);
    lines.push(`- Status: ${fmtStatus(todo.status)}` + (todo.acceptanceStatus ? ` / acceptance: ${todo.acceptanceStatus}` : ''));
    lines.push(`- Retry count: ${fmtStatus(todo.retryCount)}`);
  } else {
    lines.push('- No linked todo.');
  }
  const behind = bundle?.git?.commitsBehindMaster;
  if (behind !== null && behind !== undefined) {
    lines.push(`- Commits behind master: ${behind}`);
  }
  const highlights = raiseDetailHighlights(bundle?.raiseDetail ?? null);
  if (highlights.length) {
    lines.push('');
    lines.push('Raise-time detail:');
    lines.push(...highlights);
  }

  // -------- System context --------
  lines.push('');
  lines.push('## System context');
  lines.push('');
  const pg = bundle?.planGraph ?? null;
  if (pg) {
    lines.push(`- Parent epic: ${pg.parentEpic ? `**${pg.parentEpic.title}** (${fmtStatus(pg.parentEpic.status)})` : '—'}`);
    lines.push(`- Siblings: ${pg.siblings?.length ?? 0}`);
    lines.push(`- Dependents (blocked on this): ${pg.dependents?.length ?? 0}`);
  } else {
    lines.push('- Plan graph: unavailable.');
  }
  const eb = bundle?.epicBranch ?? null;
  if (eb) {
    lines.push(
      `- Epic branch: ahead ${fmtStatus(eb.ahead)}, behind ${fmtStatus(eb.behind)}, ` +
        `mergeable ${fmtStatus(eb.mergeable)}, land-leaf-done ${fmtStatus(eb.landLeafDone)}` +
        (eb.stranded ? ', **STRANDED**' : ''),
    );
  }
  const prior = bundle?.priorEscalations ?? [];
  lines.push(`- Prior related escalations: ${prior.length}`);

  return lines.join('\n') + '\n';
}
