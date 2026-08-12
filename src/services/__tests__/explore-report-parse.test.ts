import { describe, it, expect } from 'bun:test';
import { parseExploreReport, EXPLORE_REPORT_SENTINEL, ExploreReportParse, exploreAssertsFindings } from '../leaf-parsing';
import { exploreReportPath } from '../leaf-prompts';
import type { Todo } from '../todo-store';

describe('parseExploreReport', () => {
  it('a zero-finding parseable report parses ok with an empty findings list', () => {
    const text = `# Investigation Report

Some analysis and findings here.

## Findings

No items found.

EXPLORE-REPORT: FINDINGS=0`;

    const result = parseExploreReport(text);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.findings.length).toBe(0);
    }
  });

  it('a multi-finding parseable report parses ok with >=2 findings', () => {
    const text = `# Investigation Report

## Findings

- First issue found in the code
- Second issue with the implementation
- Third problem discovered

EXPLORE-REPORT: FINDINGS=3`;

    const result = parseExploreReport(text);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.findings.length).toBeGreaterThanOrEqual(2);
      expect(result.findings.length).toBe(3);
    }
  });

  it('empty text fails with reason empty', () => {
    const result = parseExploreReport('');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('empty');
    }
  });

  it('prose with no sentinel line fails with reason unparseable', () => {
    const text = `# Investigation Report

## Findings

- Some finding here
- Another finding

No sentinel line at all.`;

    const result = parseExploreReport(text);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('unparseable');
    }
  });

  it('a markdown-wrapped sentinel line still parses ok', () => {
    const backtickWrapped = `# Investigation Report

## Findings

- Finding one
- Finding two

\`EXPLORE-REPORT: FINDINGS=2\``;

    const result1 = parseExploreReport(backtickWrapped);
    expect(result1.ok).toBe(true);
    if (result1.ok) {
      expect(result1.findings.length).toBe(2);
    }

    const boldWrapped = `# Investigation Report

## Findings

- Finding one

**EXPLORE-REPORT: FINDINGS=1**`;

    const result2 = parseExploreReport(boldWrapped);
    expect(result2.ok).toBe(true);
    if (result2.ok) {
      expect(result2.findings.length).toBe(1);
    }
  });

  it('exploreReportPath returns docs/explore/<id>.report.md', () => {
    const leaf = { id: 'abc123' } as Todo;
    const path = exploreReportPath(leaf);
    expect(path).toBe('docs/explore/abc123.report.md');
  });

  it('a FINDINGS=n sentinel whose n does not match the parsed bullet count still returns ok:true', () => {
    const text = `# Investigation

## Findings

- Finding one
- Finding two

EXPLORE-REPORT: FINDINGS=5`;

    const result = parseExploreReport(text);
    expect(result.ok).toBe(true); // Mismatch should NOT fail the parse
    if (result.ok) {
      expect(result.findings.length).toBe(2); // But we still parse the actual bullets
    }
  });

  it('FINDINGS=0 with no bullets is a successful parse', () => {
    const text = `# Report

## Findings

EXPLORE-REPORT: FINDINGS=0`;

    const result = parseExploreReport(text);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.findings.length).toBe(0);
    }
  });

  it('preserves the original text (unstripped) in the report field', () => {
    const text = `# Title

Body with some content.

EXPLORE-REPORT: FINDINGS=0`;

    const result = parseExploreReport(text);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.report).toBe(text.trim());
      expect(result.report).toContain('# Title');
    }
  });

  it('handles case-insensitive EXPLORE-REPORT and FINDINGS keywords', () => {
    const text = `# Report

## Findings

- Item

explore-report: findings=1`;

    const result = parseExploreReport(text);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.findings.length).toBe(1);
    }
  });

  it('stops collecting bullets at next ## heading', () => {
    const text = `# Report

## Findings

- Finding one
- Finding two

## Discussion

- This should not be counted

EXPLORE-REPORT: FINDINGS=2`;

    const result = parseExploreReport(text);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.findings.length).toBe(2);
    }
  });

  it('undefined text fails with reason empty', () => {
    const result = parseExploreReport(undefined);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('empty');
    }
  });

  it('whitespace-only text fails with reason empty', () => {
    const result = parseExploreReport('   \n\n  \t  ');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('empty');
    }
  });

  it('parses findingsCount from FINDINGS=99', () => {
    const text = `# Investigation Report

## Findings

- Issue 1
- Issue 2
- Issue 3

EXPLORE-REPORT: FINDINGS=99`;

    const result = parseExploreReport(text);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.findingsCount).toBe(99);
    }
  });
});

describe('exploreAssertsFindings', () => {
  it('is false for FINDINGS=0 with no bullets', () => {
    const text = `# Report

## Findings

EXPLORE-REPORT: FINDINGS=0`;

    const result = parseExploreReport(text);
    expect(exploreAssertsFindings(result)).toBe(false);
  });

  it('is true for FINDINGS=0 with one bullet', () => {
    const text = `# Report

## Findings

- One finding was discovered

EXPLORE-REPORT: FINDINGS=0`;

    const result = parseExploreReport(text);
    expect(exploreAssertsFindings(result)).toBe(true);
  });

  it('is true for FINDINGS=2', () => {
    const text = `# Report

## Findings

- First issue
- Second issue

EXPLORE-REPORT: FINDINGS=2`;

    const result = parseExploreReport(text);
    expect(exploreAssertsFindings(result)).toBe(true);
  });
});
