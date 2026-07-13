import { describe, it, expect } from 'bun:test';
import { parseCriterionResults } from '../review-citations';

describe('parseCriterionResults — marker anywhere on a line', () => {
  it('parses H4 numbered-list shape: criterion text before marker, then citation', () => {
    const input = '1. `coordinator-live.ts` defines and exports `surfaceStuckAutoLand` — [MET] `src/services/coordinator-live.ts:1465-1475`';
    const result = parseCriterionResults(input);

    expect(result).toHaveLength(1);
    const [criterion] = result;
    expect(criterion.outcome).toBe('met');
    expect(criterion.text).toBe('`coordinator-live.ts` defines and exports `surfaceStuckAutoLand`');
    expect(criterion.citations).toHaveLength(1);
    const [citation] = criterion.citations;
    expect(citation.path).toBe('src/services/coordinator-live.ts');
    expect(citation.line).toBe(1465);
  });

  it('still parses marker-first format unchanged', () => {
    const input = '- [MET] module exists — src/services/review-citations.ts:14';
    const result = parseCriterionResults(input);

    expect(result).toHaveLength(1);
    const [criterion] = result;
    expect(criterion.outcome).toBe('met');
    expect(criterion.text).toBe('module exists');
    expect(criterion.citations).toHaveLength(1);
    const [citation] = criterion.citations;
    expect(citation.path).toBe('src/services/review-citations.ts');
    expect(citation.line).toBe(14);
  });

  it('placebo guard: bare VERDICT: PASS produces no criteria', () => {
    const input = 'VERDICT: PASS';
    const result = parseCriterionResults(input);
    expect(result).toHaveLength(0);
  });

  it('placebo guard: plain prose line produces no criteria', () => {
    const input = 'This is just a sentence with no marker.';
    const result = parseCriterionResults(input);
    expect(result).toHaveLength(0);
  });

  it('does not match incidental markers in non-list sentences', () => {
    const input = 'This sentence mentions [MET] in the middle but has no leading bullet.';
    const result = parseCriterionResults(input);
    expect(result).toHaveLength(0);
  });

  it('parses bullet-starred list with marker mid-line', () => {
    const input = '* The function is properly exported — [UNMET] src/index.ts:42';
    const result = parseCriterionResults(input);

    expect(result).toHaveLength(1);
    const [criterion] = result;
    expect(criterion.outcome).toBe('unmet');
    expect(criterion.text).toBe('The function is properly exported');
  });

  it('parses dash-bulleted list with marker mid-line', () => {
    const input = '- Handles edge cases correctly — [MET] src/utils.ts:100';
    const result = parseCriterionResults(input);

    expect(result).toHaveLength(1);
    const [criterion] = result;
    expect(criterion.outcome).toBe('met');
    expect(criterion.text).toBe('Handles edge cases correctly');
    expect(criterion.citations).toHaveLength(1);
    expect(criterion.citations[0].path).toBe('src/utils.ts');
  });

  it('parses parenthesized numbered list with marker mid-line', () => {
    const input = '42) Performance meets SLA — [MET] src/perf.ts:250';
    const result = parseCriterionResults(input);

    expect(result).toHaveLength(1);
    const [criterion] = result;
    expect(criterion.outcome).toBe('met');
    expect(criterion.text).toBe('Performance meets SLA');
  });

  it('handles N/A marker in list-anchored line', () => {
    const input = '1. Legacy code path — [N/A] src/legacy.ts:5';
    const result = parseCriterionResults(input);

    expect(result).toHaveLength(1);
    const [criterion] = result;
    expect(criterion.outcome).toBe('not-applicable');
    expect(criterion.text).toBe('Legacy code path');
  });

  it('handles NOT_APPLICABLE variant', () => {
    const input = '- Deprecated module — [NOT_APPLICABLE] src/old.ts:1';
    const result = parseCriterionResults(input);

    expect(result).toHaveLength(1);
    const [criterion] = result;
    expect(criterion.outcome).toBe('not-applicable');
  });

  it('extracts citations from the full raw line regardless of marker position', () => {
    const input = '1. Tests exist — [MET] `src/foo.test.ts:10-20`';
    const result = parseCriterionResults(input);

    expect(result).toHaveLength(1);
    const [criterion] = result;
    expect(criterion.citations).toHaveLength(1);
    expect(criterion.citations[0].path).toBe('src/foo.test.ts');
    expect(criterion.citations[0].line).toBe(10);
  });
});
