import { type GateEval, type ReplayGate, listGateEvals, type GateEvalFilter } from './replay-corpus-store';

export type ReplayVerdict = 'accept' | 'reject';

/** A candidate gate: given a stored input, returns TRUE to ACCEPT the review. */
export type CandidateGate = (input: { inputText: string; changeSet: string[] }) => boolean;

export interface ReplayDelta {
  leafId: string;
  gate: ReplayGate;
  expected: ReplayVerdict;   // ground truth
  actual: ReplayVerdict;     // what the candidate gate produced
  kind: 'fp' | 'fn';
}

export interface ReplayResult {
  total: number;
  fp: number;   // candidate ACCEPTED a should-REJECT row
  fn: number;   // candidate REJECTED a should-ACCEPT row (a false block — the prod bug class)
  deltas: ReplayDelta[];
}

const ACCEPT_VERDICTS = new Set(['ok', 'accept', 'pass']);

/** Ground truth: a recorded human `override` means should-ACCEPT; otherwise derive
 *  from the stored verdict. */
function expectedAccept(row: GateEval): boolean {
  return row.override != null ? true : ACCEPT_VERDICTS.has(row.verdict.toLowerCase());
}

export function replayCorpus(
  project: string,
  gate: CandidateGate,
  filter: GateEvalFilter = {},
): ReplayResult {
  const rows = listGateEvals(project, filter);
  const deltas: ReplayDelta[] = [];
  let fp = 0, fn = 0;
  for (const row of rows) {
    const exp = expectedAccept(row);
    const act = gate({ inputText: row.inputText, changeSet: row.changeSet });
    if (exp === act) continue;
    const kind: 'fp' | 'fn' = exp ? 'fn' : 'fp'; // should-accept but rejected ⇒ fn
    if (kind === 'fn') fn++; else fp++;
    deltas.push({
      leafId: row.leafId,
      gate: row.gate,
      expected: exp ? 'accept' : 'reject',
      actual: act ? 'accept' : 'reject',
      kind,
    });
  }
  return { total: rows.length, fp, fn, deltas };
}
