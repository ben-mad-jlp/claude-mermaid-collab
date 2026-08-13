/**
 * Shared quarantine↔failure matcher — three-arm check to determine if a failing
 * test/file is covered by a quarantine row (verbatim, section parse, or title→file resolve).
 */

import { normalizeGateFingerprint } from './leaf-gate';
import { resolveQuarantineTestFile } from './quarantine-test-file';
import { extractFailingTests, SPEC_FILE_RE } from './gate-runner';

export interface QuarantineMatchDeps {
  resolveTestFile?: (project: string, test: string) => string | null;
  project?: string;
}

/**
 * Check whether a failing entry is covered by the quarantine set using three arms:
 * 1. Verbatim: normalized failing equals normalized quarantine entry
 * 2. Section: failing appears as a header, parse its section, check all parsed names are quarantined
 * 3. Title→file: when project provided and failing is a file path, resolve each quarantine title
 *    to a file and match against the failing path
 *
 * Returns true only when at least one arm matches. Arm 3 is additive-only: can flip false→true
 * but never flips an existing true→false.
 */
export function quarantineCoversFailure(
  failing: string,
  quarantineTests: readonly string[],
  gateOutput: string,
  deps?: QuarantineMatchDeps,
): boolean {
  // Arm 1: Verbatim hit — both sides normalized by stripping ordinal prefix and trimming.
  const normalizedQuarantine = new Set(quarantineTests.map(normalizeGateFingerprint));
  const normalizedFailing = normalizeGateFingerprint(failing);

  if (normalizedQuarantine.has(normalizedFailing)) {
    return true;
  }

  // Arm 2: Section hit — extract the output slice for failing and parse its test names.
  // Find the section header for this failing: ──── failing ────
  const headerRegex = new RegExp(
    `─{4,}\\s+${normalizedFailing.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+─{4,}`,
  );
  const headerMatch = gateOutput.match(headerRegex);

  if (headerMatch) {
    const headerStartIndex = gateOutput.indexOf(headerMatch[0]);
    if (headerStartIndex !== -1) {
      const afterHeaderIndex = headerStartIndex + headerMatch[0].length;
      const remainingText = gateOutput.slice(afterHeaderIndex);
      const nextHeaderMatch = remainingText.match(/\n─{4,}/);
      const sectionEndIndex = nextHeaderMatch
        ? afterHeaderIndex + remainingText.indexOf(nextHeaderMatch[0])
        : gateOutput.length;

      const sectionText = gateOutput.slice(afterHeaderIndex, sectionEndIndex);
      const testNames = extractFailingTests(sectionText);

      // Return true only if all test names are in the quarantine set.
      if (testNames.length > 0 && testNames.every((name) => normalizedQuarantine.has(name))) {
        return true;
      }
    }
  }

  // Arm 3: Title→file (new) — only when deps?.project is provided AND failing looks like a file path.
  if (deps?.project) {
    // Check if failing looks like a file path (reuse SPEC_FILE_RE or check for .test./.spec. suffix)
    if (SPEC_FILE_RE.test(failing)) {
      const resolveTestFile = deps.resolveTestFile ?? resolveQuarantineTestFile;

      for (const rawQuarantine of quarantineTests) {
        try {
          const resolved = resolveTestFile(deps.project, rawQuarantine);
          if (resolved !== null) {
            // Normalize path for comparison (strip leading ./)
            const normalizedResolved = resolved.replace(/^\.\//, '');
            const normalizedFailing2 = failing.replace(/^\.\//, '');
            if (normalizedResolved === normalizedFailing2) {
              return true;
            }
          }
        } catch {
          // Throw or null degrades this entry to "no match", never a rejection
        }
      }
    }
  }

  return false;
}
