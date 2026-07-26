/**
 * review-depth-parity.ts — gate the light path on recorded replay-corpus parity.
 *
 * Light routing turns on ONLY when a parity measurement for the CURRENT router
 * thresholds is durably stored in the per-project replay corpus and clears an
 * agreement floor. No stored measurement ⇒ light stays off.
 */

import type { DiffRisk } from './review-depth-router';
import { HOT_PATH, REVIEW_HEAVY_LOC, REVIEW_HEAVY_FILES, REVIEW_LIGHT_LOC, routeReviewDepth } from './review-depth-router';
import { recordGateEval, listGateEvals, type GateEval } from './replay-corpus-store';
import { replayCorpus, type CandidateGate, type ReplayResult } from './gate-replay';
import { validateReviewGrounding } from './review-citations';

export const REVIEW_DEPTH_PARITY_LEAF_ID = 'review-depth-parity';
export const PARITY_AGREEMENT_FLOOR = 0.95;
export const PARITY_MIN_SAMPLES = 20;

export interface ReviewDepthParity {
  thresholdKey: string;
  sampleSize: number;
  agreements: number;
  agreementRate: number;
  standard: ReplayResult;
  light: ReplayResult;
  deltas: Array<{ leafId: string; gate: string; expected: string; actual: string; kind: string }>;
}

export function reviewDepthThresholdKey(): string {
  const parts = [
    HOT_PATH.length,
    REVIEW_HEAVY_LOC,
    REVIEW_HEAVY_FILES,
    REVIEW_LIGHT_LOC,
  ];
  return `v1:${parts.join(',')}`;
}

export function riskFromRow(row: { inputText: string; changeSet: string[] }): DiffRisk {
  const files = row.changeSet;
  let addedLines = 0;
  let deletedLines = 0;

  const locMarker = row.inputText.match(/LOC:(\d+)\/(\d+)/);
  if (locMarker) {
    addedLines = parseInt(locMarker[1], 10);
    deletedLines = parseInt(locMarker[2], 10);
  }

  return { files, addedLines, deletedLines };
}

export const standardPathGate: CandidateGate = ({ inputText, changeSet }) => {
  return validateReviewGrounding(inputText, changeSet, { citationExists: () => true }).status === 'ok';
};

export const lightPathGate: CandidateGate = ({ inputText, changeSet }) => {
  const risk = riskFromRow({ inputText, changeSet });
  const route = routeReviewDepth(risk, { lightPathEnabled: true });
  if (route.depth === 'light') {
    return true;
  }
  return validateReviewGrounding(inputText, changeSet, { citationExists: () => true }).status === 'ok';
};

export function measureReviewDepthParity(project: string, filter?: any): ReviewDepthParity {
  const standard = replayCorpus(project, standardPathGate, filter);
  const light = replayCorpus(project, lightPathGate, filter);

  const allDeltas = light.deltas.filter((d) => {
    const key = `${d.leafId}|${d.kind}`;
    return !standard.deltas.some((sd) => `${sd.leafId}|${sd.kind}` === key);
  });

  const sampleSize = standard.total;
  const agreements = sampleSize - allDeltas.length;
  const agreementRate = sampleSize === 0 ? 0 : agreements / sampleSize;

  return {
    thresholdKey: reviewDepthThresholdKey(),
    sampleSize,
    agreements,
    agreementRate,
    standard,
    light,
    deltas: allDeltas as any,
  };
}

export async function recordReviewDepthParity(project: string, m: ReviewDepthParity): Promise<GateEval> {
  const verdict = m.agreementRate >= PARITY_AGREEMENT_FLOOR && m.sampleSize >= PARITY_MIN_SAMPLES ? 'pass' : 'fail';
  return recordGateEval(project, {
    leafId: REVIEW_DEPTH_PARITY_LEAF_ID,
    gate: 'review-depth',
    inputText: m.thresholdKey,
    changeSet: [],
    verdict,
    reasons: JSON.stringify({
      sampleSize: m.sampleSize,
      agreementRate: m.agreementRate,
      deltas: m.deltas,
    }),
  });
}

export function readReviewDepthParity(project: string): ReviewDepthParity | null {
  try {
    const rows = listGateEvals(project, { leafId: REVIEW_DEPTH_PARITY_LEAF_ID, gate: 'review-depth' });
    const thresholdKey = reviewDepthThresholdKey();

    for (const row of rows) {
      if (row.inputText === thresholdKey) {
        try {
          const parsed = JSON.parse(row.reasons);
          return {
            thresholdKey,
            sampleSize: parsed.sampleSize ?? 0,
            agreements: parsed.sampleSize - (parsed.deltas?.length ?? 0),
            agreementRate: parsed.agreementRate ?? 0,
            standard: { total: 0, fp: 0, fn: 0, deltas: [] },
            light: { total: 0, fp: 0, fn: 0, deltas: [] },
            deltas: parsed.deltas ?? [],
          };
        } catch {
          continue;
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

export function isLightPathParityMet(project?: string): boolean {
  if (!project) return false;

  try {
    const parity = readReviewDepthParity(project);
    if (!parity) return false;
    if (parity.sampleSize < PARITY_MIN_SAMPLES) return false;
    if (parity.agreementRate < PARITY_AGREEMENT_FLOOR) return false;
    return true;
  } catch {
    return false;
  }
}
