/** Detects criteria phrased as forward-accrual claims — asserting accrual over future
 *  passes/events/missions that can never be closed in a single observation — and offers
 *  a deterministic one-shot rewrite. Pure module: no I/O, no imports beyond stdlib. */

export const FORWARD_ACCRUAL_REASON =
  'forward-accrual criterion: asserts accrual over future passes/events/missions and can never be closed in one observation';

export class ForwardAccrualCriterionError extends Error {
  constructor(public readonly criterion: string, public readonly matched: string) {
    super(`${FORWARD_ACCRUAL_REASON} (matched "${matched}" in criterion: ${criterion})`);
    this.name = 'ForwardAccrualCriterionError';
  }
}

interface AccrualShape {
  shape: string;
  re: RegExp;
}

const ACCRUAL_SHAPES: AccrualShape[] = [
  {
    shape: 'count-over-n-future-units',
    re: /over\s+(?:≥|>=|at least\s+)?\d+\s+(?:future\s+)?(?:\w+\s+){0,2}(passes|events|missions|runs|cycles|sessions)\b/i,
  },
  {
    shape: 'over-the-next-n',
    re: /over\s+the\s+next\s+\d+\s+\w+/i,
  },
  {
    shape: 'for-the-next-n',
    re: /for\s+the\s+next\s+\d+\s+\w+/i,
  },
  {
    shape: 'continues-to',
    re: /\bcontinues?\s+to\s+\w+/i,
  },
  {
    shape: 'going-forward',
    re: /\bgoing\s+forward\b/i,
  },
  {
    shape: 'from-now-on',
    re: /\bfrom\s+now\s+on\b/i,
  },
  {
    shape: 'sustained-over',
    re: /\bsustained\s+over\b/i,
  },
];

export function detectForwardAccrual(text: string): { matched: string } | null {
  for (const { re } of ACCRUAL_SHAPES) {
    const m = text.match(re);
    if (m) {
      return { matched: m[0] };
    }
  }
  return null;
}

const CONNECTOR_RE = /[,;]?\s*(?:—|-|and)?\s*$/;

function stripOnce(text: string): string {
  let earliestIndex = -1;
  let earliestMatch: RegExpMatchArray | null = null;
  for (const { re } of ACCRUAL_SHAPES) {
    const m = text.match(re);
    if (m && m.index !== undefined && (earliestIndex === -1 || m.index < earliestIndex)) {
      earliestIndex = m.index;
      earliestMatch = m;
    }
  }
  if (!earliestMatch || earliestIndex === -1) return text;

  const matchEnd = earliestIndex + earliestMatch[0].length;

  // Walk left over an optional connector run (", ", " — ", " - ", " and ")
  let start = earliestIndex;
  const before = text.slice(0, start);
  const connectorMatch = before.match(CONNECTOR_RE);
  if (connectorMatch && connectorMatch[0].length > 0) {
    start -= connectorMatch[0].length;
  }

  // Walk right to the next comma/period, or end of string
  let end = matchEnd;
  const after = text.slice(matchEnd);
  const nextBoundary = after.search(/[,.]/);
  if (nextBoundary === -1) {
    end = text.length;
  } else {
    end = matchEnd + nextBoundary;
  }

  const excised = (text.slice(0, start) + text.slice(end)).replace(/\s{2,}/g, ' ').replace(/\s+([.,])/g, '$1').trim();

  return excised;
}

export function toOneShot(text: string): string {
  let current = text;
  for (let pass = 0; pass < 3; pass++) {
    if (detectForwardAccrual(current) === null) {
      return current;
    }
    const next = stripOnce(current);
    if (!next || next.trim().length === 0) {
      return text;
    }
    if (next === current) {
      return text;
    }
    current = next;
  }
  return detectForwardAccrual(current) === null ? current : text;
}
