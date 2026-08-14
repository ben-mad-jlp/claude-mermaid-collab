/**
 * criteria-citability.ts — the L4 blueprint-time criterion validation gate.
 *
 * A blueprint's acceptance criteria must be citable in the declared change-set.
 * A criterion is NOT citable if it asserts a command's result, an absence, or a
 * code location outside the diff — or if it is CITABLE but INFEASIBLE, i.e. the only
 * proof it states needs something the daemon has no access to (a browser, a listening
 * service, a device, network egress, an outside test system, a human eye).
 * This module validates BEFORE the implement node
 * is spawned — the same predicate as the terminal G3 grounding gate (validateReviewGrounding),
 * evaluated against the blueprint's DECLARED change-set instead of the realised diff.
 *
 * Pure, no I/O, no spawn. Mirrors review-citations.ts's posture exactly.
 */

import { extractCitations, citationResolves } from './review-citations';
import { ABSENCE_RESULT } from './node-commands';

export type UncitableKind =
  | 'command-result'
  | 'absence'
  | 'out-of-diff-location'
  | 'infeasible';

export interface CriteriaCitabilityOpts {
  testOnly?: boolean;
  citationExistsAtBase?: (path: string, line: number) => boolean;
}

export interface CriterionVerdict {
  text: string;
  citable: boolean;
  kind?: UncitableKind;
  reason?: string;
}

export interface CriteriaCitability {
  status: 'ok' | 'uncitable' | 'abstain';
  verdicts: CriterionVerdict[];
  offenders: CriterionVerdict[];
  reasons: string[];
}

const MAX_NAMED_OFFENDERS = 3;

/** Line-scan for a heading matching /^#{1,6}\s*acceptance\s+criteri/i; collect
 *  subsequent list items until the next # heading or EOF. Skip fenced code blocks
 *  so the trailing json manifest never parses as criteria. */
export function parseBlueprintCriteria(blueprintMd: string): string[] {
  const criteria: string[] = [];
  let inCodeFence = false;
  let inCriteria = false;

  for (const line of blueprintMd.split('\n')) {
    // Toggle code fence state
    if (line.trim().startsWith('```')) {
      inCodeFence = !inCodeFence;
      continue;
    }

    // Skip everything inside code fences
    if (inCodeFence) continue;

    // Check for acceptance criteria heading
    if (/^#{1,6}\s*acceptance\s+criteri/i.test(line)) {
      inCriteria = true;
      continue;
    }

    // Exit criteria section on next heading
    if (inCriteria && /^#+\s/.test(line) && !/^#{1,6}\s*acceptance\s+criteri/i.test(line)) {
      inCriteria = false;
      break;
    }

    // Collect list items in the criteria section
    if (inCriteria) {
      // Accept BOTH bullet (-, *) and ordered (1. / 1)) list markers. Leaf specs write
      // acceptance criteria as NUMBERED lists ("emit exactly these six: 1. … 2. …") and
      // blueprints copy that format; matching only bullets made this validator abstain on
      // every real blueprint (it never convicted a single criterion).
      const match = line.match(/^\s*(?:[-*]|\d+[.)])\s+(.+?)(?:\s*(?:—|\(cite|— cite).*)?$/);
      if (match) {
        let criterion = match[1].trim();
        // Strip trailing citation tail (— cite file:line or (cite file:line))
        criterion = criterion.replace(/\s*(?:—|\(cite|— cite).*$/, '').trim();
        // Strip leading checkbox [ ]/[x]
        const cleanCriterion = criterion.replace(/^\[[\ xX]\]\s*/, '').trim();
        if (cleanCriterion) {
          criteria.push(cleanCriterion);
        }
      }
    }
  }

  return criteria;
}

/** True if the citation path resolves into the declared change-set: either via exact/suffix
 *  match (citationResolves), or by matching a declared entry containing `*` via Bun.Glob. */
function resolvesIntoDeclaredChangeSet(path: string, declaredFiles: readonly string[]): boolean {
  if (citationResolves(path, declaredFiles)) return true;
  return declaredFiles.some((d) => {
    if (d.includes('*')) {
      try {
        return new Bun.Glob(d).match(path);
      } catch {
        return false; // malformed glob pattern never matches — fail closed, not open
      }
    }
    return false;
  });
}

/** Rule 0 — ACQUIT on a resolving citation (reuses extractCitations from review-citations). */
function acquitOnResolvingCitation(text: string, declaredFiles: readonly string[]): boolean {
  const citations = extractCitations(text);
  if (citations.length === 0) return false;
  return citations.some((c) => resolvesIntoDeclaredChangeSet(c.path, declaredFiles));
}

/** Rule 1 — CONVICT on out-of-diff-location: a citation found but doesn't resolve into
 *  declaredFiles (only if we have a manifest to check against). */
function convictOnOutOfDiffLocation(
  text: string,
  declaredFiles: readonly string[],
  opts?: CriteriaCitabilityOpts,
): { uncitable: boolean; reason?: string } {
  if (declaredFiles.length === 0) {
    // No manifest — abstain on ignorance, never convict
    return { uncitable: false };
  }

  const citations = extractCitations(text);
  if (citations.length === 0) {
    // No citations found — this rule doesn't apply
    return { uncitable: false };
  }

  // We have citations and a manifest; check if ANY resolve
  const anyResolves = citations.some((c) => resolvesIntoDeclaredChangeSet(c.path, declaredFiles));
  if (anyResolves) {
    // At least one citation resolves — acquitted by Rule 0
    return { uncitable: false };
  }

  // When testOnly and citationExistsAtBase are both set, check if any citation resolves at base
  if (opts?.testOnly && opts.citationExistsAtBase) {
    if (citations.some((c) => opts.citationExistsAtBase!(c.path, c.line))) {
      return { uncitable: false };
    }
  }

  // Citations found, none resolve, and we have a manifest
  const raw = citations[0]!.raw;
  const line = citations[0]!.line;
  return {
    uncitable: true,
    reason: `criterion cites "${raw}:${line}", which is not in the leaf's declared change-set${opts?.testOnly ? ' and does not exist at base' : ''}`,
  };
}

/** Rule 2 — CONVICT on command-result: invocation token or result predicate. */
function convictOnCommandResult(text: string): { uncitable: boolean; reason?: string } {
  // Invocation token: npm, npx, bun, pnpm, yarn, make, tsc, vitest, jest, eslint, cargo, go, xcodebuild, swift, xcrun
  if (/(?:^|[\s`(])(?:npm|npx|bun|pnpm|yarn|make|tsc|vitest|jest|eslint|cargo|go|xcodebuild|swift|xcrun)\s+(?:run|test|--noEmit|-b|\S)/.test(text)) {
    return {
      uncitable: true,
      reason: "criterion asserts a command's result (a test, build, or lint invocation), which is uncitable",
    };
  }

  // Result predicate: pass/green/clean over a suite/test/build noun, or inverse
  // Match patterns like "tests pass", "build passes", "suite succeeds", "results match master", etc.
  if (
    /\b(suite|tests?|build|typecheck|type-check|compile|gate|lint|ci|results?|files?)\b[^.]{0,40}\b(pass(?:es|ed)?|green|clean|succeed(?:s|ed)?|exits?\s+0|match(?:es)?\s+master)\b/i.test(
      text,
    )
  ) {
    return {
      uncitable: true,
      reason: "criterion asserts a command's result, which is uncitable",
    };
  }

  // Inverse: pass/success before the noun
  if (
    /\b(pass(?:es|ed)?|exits?\s+0)\b[^.]{0,20}\b(suite|tests?|build|results?|files?)\b/i.test(text)
  ) {
    return {
      uncitable: true,
      reason: "criterion asserts a command's result, which is uncitable",
    };
  }

  return { uncitable: false };
}

/** Rule 3 — CONVICT on absence: structural patterns that assert a negative about code. */
function convictOnAbsence(text: string): { uncitable: boolean; reason?: string } {
  // Leading "No …" pattern
  if (/^\s*no\s+\S/i.test(text)) {
    return {
      uncitable: true,
      reason: 'criterion asserts an absence (no file touched, no field added), which is uncitable',
    };
  }

  // "no new/other/additional/extra"
  if (/\bno\s+(new|other|additional|extra)\b/i.test(text)) {
    return {
      uncitable: true,
      reason: 'criterion asserts an absence, which is uncitable',
    };
  }

  // "(is|are|was|were) not (touch|chang|modif|add|creat|introduc|import)"
  if (/\b(?:is|are|was|were)?\s*not\s+(touch|chang|modif|add|creat|introduc|import)/i.test(text)) {
    return {
      uncitable: true,
      reason: 'criterion asserts an absence, which is uncitable',
    };
  }

  // "without …ing"
  if (/\bwithout\s+\w+ing\b/i.test(text)) {
    return {
      uncitable: true,
      reason: 'criterion asserts an absence, which is uncitable',
    };
  }

  // "unchanged" or "untouched"
  if (/\b(unchanged|untouched)\b/i.test(text)) {
    return {
      uncitable: true,
      reason: 'criterion asserts an absence, which is uncitable',
    };
  }

  // "no longer", "references nothing", "nothing external", "self-contained"
  if (/\b(?:no longer|references nothing|nothing external|self[-\s]?contained)\b/i.test(text)) {
    return {
      uncitable: true,
      reason: 'criterion asserts an absence, which is uncitable',
    };
  }

  return { uncitable: false };
}

const SCOPE_GUARD_RESULT = /\b(?:0\s+files?\s+changed|empty(?:\s+output)?|no\s+output|no\s+changes|prints?\s+nothing)\b/i;

/** True when the criterion names a runnable READ-ONLY verification invocation WITH a real
 *  argument AND asserts a checkable RESULT token. Such a criterion — even an absence-shaped
 *  one ("X no longer appears — grep -c X file returns 0") — is a command-result the
 *  command-evidence gate can honour, so it must be ACQUITTED, not convicted as an absence. */
function namesVerificationCommand(text: string): boolean {
  // (i) a runnable read-only verification invocation WITH a concrete argument
  const hasInvocation =
    /(?:^|[\s`(])(?:git\s+grep|git\s+ls-files|grep|rg)\s+(?:-\S+\s+)*\S/.test(text) ||
    /(?:^|[\s`(])(?:npx\s+tsc|vitest|bun\s+test)\b/.test(text);
  if (!hasInvocation) return false;

  // (ii) an asserted checkable RESULT token
  const hasResult =
    ABSENCE_RESULT.test(text) ||
    /-c\b[^.]*\b0\b/.test(text) ||
    /\b0\s+occurrences\b/i.test(text) ||
    /\bcount\s+is\s+0\b/i.test(text);
  return hasResult;
}

/** True when the criterion names a git diff invocation with a pathspec argument AND asserts
 *  a checkable scope-guard RESULT token. Such a criterion is mechanically checkable and must
 *  be ACQUITTED as a command-result, not convicted as an absence. */
export function namesScopeGuardCheck(text: string): boolean {
  // (i) invocation with a concrete path argument — git diff with --stat or -- pathspec separator
  const hasInvocation = /(?:^|[\s`(])git\s+diff\b[^`\n]*(?:--\s+|--stat\s+)\S/.test(text);
  if (!hasInvocation) return false;

  // (ii) checkable result token from ABSENCE_RESULT or SCOPE_GUARD_RESULT
  const hasResult = ABSENCE_RESULT.test(text) || SCOPE_GUARD_RESULT.test(text);
  return hasResult;
}

/** True when the criterion names a TEST INVOCATION in the citable three-part shape:
 *  (a) the runner invocation, (b) a test FILE that resolves into the declared change-set, and
 *  (c) the NAME of an assertion inside it (`it('…')` / `test('…')` / `describe('…')`, or an
 *  `asserting/asserts "<name>"` phrase). All three are checkable against the produced diff, so
 *  such a criterion is CITABLE and must be acquitted before the command-result conviction.
 *
 *  WHY (friction d08de44a, mission 0a4a350d, leaf 54ebddd7): "`npx vitest run
 *  src/lib/__tests__/ros-store.test.ts` passes" was convicted as an uncitable command-result and
 *  the author was told to "restate as a named zero-match check — e.g. `grep -rn 'npx vitest run
 *  …' src/` returns no matches", i.e. to grep the SOURCE TREE for the literal text of the test
 *  command. Complying literally yields a criterion that is trivially true and proves nothing — a
 *  placebo. Two blueprint nodes burned, zero implement nodes reached. Missions whose criteria say
 *  "proven by test" could not state their own chosen form of proof.
 *
 *  The bar is deliberately three-part: naming a runner alone would re-admit the bare "tests pass"
 *  prose Rule 2 exists to reject. A test file NOT in the change-set still falls through to the
 *  conviction — an untouched suite proves nothing about this leaf. */
export function namesTestInvocation(text: string, declaredFiles: readonly string[]): boolean {
  // (i) a test-runner invocation
  const hasInvocation =
    /(?:^|[\s`(])(?:npx\s+)?(?:vitest|jest|mocha|ava|playwright)\b/i.test(text) ||
    /(?:^|[\s`(])(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b/i.test(text) ||
    /(?:^|[\s`(])(?:bun|node|deno)\s+(?:--)?test\b/i.test(text) ||
    /(?:^|[\s`(])(?:go|cargo)\s+test\b/i.test(text);
  if (!hasInvocation) return false;

  // (ii) a test file named in the text that resolves into the declared change-set. Without a
  // manifest we cannot check membership, so we abstain from acquitting rather than acquit blind.
  if (declaredFiles.length === 0) return false;
  const paths = text.match(/[\w./-]*[\w-]+\.(?:[jt]sx?|mjs|cjs|py|go|rs|swift|kt|rb)\b/g) ?? [];
  const namesDeclaredTestFile = paths.some((p) => resolvesIntoDeclaredChangeSet(p, declaredFiles));
  if (!namesDeclaredTestFile) return false;

  // (iii) the NAME of an assertion inside that file
  const namesAssertion =
    /\b(?:it|test|describe)\s*\(\s*['"`]/.test(text) ||
    /\bassert(?:s|ing)?\b[^.]{0,40}['"`][^'"`]{3,}['"`]/i.test(text);
  return namesAssertion;
}

/** A criterion that asserts a positive, readable property of a concrete OUTPUT-ARTIFACT file (a
 *  report/score/data file — .md/.json/.csv/.log/…, NOT source code) is CITABLE: the review reads
 *  that artifact, regardless of which command produced it. This is the measurement/spike shape
 *  ("run the harness → results/report.md contains a ## GATE verdict section"), which is falsifiable
 *  by READING the file — the opposite of the vague "tests pass" prose the command-result rule
 *  exists to reject. Requires a concrete artifact filename, so it can never acquit a suite-wide
 *  pass/green claim; positive-assertion only, so it never masks an absence ("no changes to X.json").
 *  This is what lets the daemon author + pass author-fidelity / measurement criteria autonomously
 *  instead of escalating them to a human. */
export function assertsCitableArtifact(text: string): boolean {
  // A concrete artifact filename with a report/data extension (source-code extensions excluded).
  if (!/\b[\w./-]+\.(?:md|json|jsonl|ndjson|csv|tsv|txt|log|html|svg|xml)\b/i.test(text)) return false;
  // A POSITIVE property of its content/existence — never an absence ("no …", "unchanged").
  if (/\bno\s+\S|\b(unchanged|untouched)\b/i.test(text)) return false;
  return /\b(contains?|shows?|reports?|records?|lists?|includes?|exists?|written|produced?|generated?|has\s+(?:a|an|the)\b|with\s+(?:a|an|the)\b|section|field|column|row|entry|line|value)\b/i.test(text);
}

/** The POSITIVE definition of "provable by the daemon". A leaf proves a criterion from inside its
 *  own worktree, with no network, no display, no attached device and no second machine. Exactly
 *  five proof methods are available to it:
 *
 *    1. invoking a TEST FILE with a runner (vitest/jest/bun test/go test/…),
 *    2. a TYPECHECK / compile (tsc --noEmit, `typecheck`),
 *    3. a FILE / PATH / file:line / symbol-in-a-named-file CITATION,
 *    4. a SCOPED GREP (grep / rg / git grep over a path),
 *    5. a GIT FACT (git diff / log / show / ls-files / rev-parse).
 *
 *  This predicate is the SAFETY VALVE for the infeasibility rule below: if a criterion names ANY
 *  of the five, it is provable regardless of what else it mentions, and is never convicted as
 *  infeasible. It is therefore deliberately GENEROUS — a false "provable" is only a miss, while a
 *  false "infeasible" would refuse legitimate work. */
export function namesDaemonProvableProof(text: string): boolean {
  // (1) a test-file invocation / a named test or spec file
  if (/(?:^|[\s`("'])(?:npx\s+)?(?:vitest|jest|mocha|ava|pytest)\b/i.test(text)) return true;
  if (/(?:^|[\s`("'])(?:npm|pnpm|yarn|bun|deno)\s+(?:run\s+)?test\b/i.test(text)) return true;
  if (/(?:^|[\s`("'])(?:go|cargo)\s+test\b/i.test(text)) return true;
  if (/\b(?:unit|regression)\s+tests?\b|\b(?:test|spec)\s+(?:file|case)\b/i.test(text)) return true;
  // (2) a typecheck / compile
  if (/(?:^|[\s`("'])tsc\b|--noEmit\b|\btype[-\s]?check(?:s|ed|ing)?\b|\bcompiles?\b/i.test(text)) return true;
  // (3) a file:line citation, or any concrete source/data/doc file path
  if (extractCitations(text).length > 0) return true;
  if (
    /\b[\w./-]*[\w-]+\.(?:[jt]sx?|mjs|cjs|py|go|rs|swift|kt|rb|java|c|h|cpp|json|jsonl|md|ya?ml|toml|sql|css|scss|html|txt|csv|log)\b/i.test(
      text,
    )
  ) {
    return true;
  }
  // (4) a scoped grep
  if (/(?:^|[\s`("'])(?:git\s+grep|grep|rg|ripgrep)\b/i.test(text)) return true;
  // (5) a git fact
  if (/(?:^|[\s`("'])git\s+(?:diff|log|show|status|ls-files|rev-parse|blame|cat-file|merge-base)\b/i.test(text)) {
    return true;
  }
  return false;
}

/** The curated set of proof methods that live OUTSIDE the five above. Each entry is deliberately
 *  narrow and verb/context-anchored: a bare noun ("device", "server", a URL) never fires on its
 *  own, because those appear constantly in ordinary, perfectly provable criteria (e.g. "routes SSE
 *  device payloads into the store"). */
const INFEASIBLE_SIGNALS: ReadonlyArray<{ re: RegExp; needs: string }> = [
  // A browser / a rendered UI
  {
    re: /\b(?:in|on|via|using|through|inside)\s+(?:a\s+|the\s+)?(?:headless\s+)?(?:browser|chrome|firefox|safari|webkit|devtools|web\s+page)\b/i,
    needs: 'a browser',
  },
  {
    re: /\b(?:browser|chrome|firefox|safari)\s+(?:window|tab|console|devtools|session)\b/i,
    needs: 'a browser',
  },
  { re: /\bscreenshots?\b/i, needs: 'a screenshot of a rendered UI' },
  {
    re: /\b(?:rendered|renders|rendering)\s+(?:page|ui|screen|view|dom|output|widget|canvas)\b/i,
    needs: 'a rendered UI',
  },
  // A human eye
  {
    re: /\bvisual(?:ly)?\s+(?:inspect\w*|verif\w*|check\w*|confirm\w*|compar\w*|identical|correct)\b|\bvisual\s+(?:inspection|diff|check)\b/i,
    needs: 'human visual inspection',
  },
  {
    re: /\bby\s+eye\b|\bhuman\s+(?:eye|reviewer|review|verif\w*|inspect\w*|judg\w*|sign[-\s]?off)\b|\bby\s+a\s+human\b/i,
    needs: 'a human eye',
  },
  { re: /\blooks?\s+(?:correct|right|good|the\s+same)\b/i, needs: 'human visual inspection' },
  // An outside / manual test system
  {
    re: /\bmanual(?:ly)?\s+(?:qa|test\w*|verif\w*|check\w*|confirm\w*|inspect\w*)\b|\bmanual\s+(?:qa|testing|verification)\b/i,
    needs: 'a manual test pass',
  },
  {
    re: /\bqa\s+(?:team|engineer|pass|sign[-\s]?off)\b|\b(?:external|outside|separate)\s+test\s+(?:system|harness|suite|rig)\b/i,
    needs: 'an outside test system',
  },
  // A listening service / a port
  {
    re: /\b(?:start|starts|starting|boot|boots|booting|launch|launches|launching|spin(?:s|ning)?\s+up|run(?:s|ning)?)\s+(?:the\s+|a\s+)?(?:dev\s+|live\s+|local\s+)?(?:server|service|daemon|app|application|container)\b/i,
    needs: 'a running service',
  },
  {
    re: /\b(?:listening|serving|running|live|reachable|available)\s+(?:on|at)\s+(?:port\s+)?\d+\b|\bon\s+port\s+\d+\b/i,
    needs: 'a listening service on a port',
  },
  {
    re: /\b(?:curl|fetch(?:es|ed)?|GET|POST|request(?:s|ed)?|visit(?:s|ed)?|navigat(?:e|es|ed))\b[^.]{0,40}\b(?:https?:\/\/|localhost:\d+|127\.0\.0\.1)/i,
    needs: 'a live service over the network',
  },
  // Network egress
  {
    re: /\bnetwork\s+(?:access|egress|connectivity|call)\b|\b(?:the\s+)?internet\s+(?:access|connection)\b/i,
    needs: 'network egress',
  },
  {
    re: /\b(?:external|third[-\s]party|remote|upstream|production|staging)\s+(?:api|endpoint|service|server|environment|host)\b/i,
    needs: 'an external service',
  },
  // External hardware / a device
  {
    re: /\b(?:physical|real|external|connected|attached|actual)\s+(?:device|hardware|machine|phone|handset)\b|\bon\s+(?:a|the)\s+(?:physical|real)\s+device\b/i,
    needs: 'external hardware',
  },
  {
    re: /\b(?:usb|serial\s+port|robot\s+arm|webcam|microphone|3d\s+printer)\b|\bplugged\s+in\b/i,
    needs: 'external hardware',
  },
];

/** Rule 4 — CONVICT on infeasible: the criterion is well-formed and citable in shape, but the ONLY
 *  proof it states needs something outside the daemon's five available proof methods.
 *
 *  Two-part, conservative by construction:
 *    (i)  a curated OUT-OF-REACH signal matches, AND
 *    (ii) the criterion names NONE of the five daemon-provable proof methods.
 *
 *  Part (ii) is what keeps this from creeping: a criterion that says "…and `bun test
 *  src/x.test.ts` asserts it" is provable no matter how much UI prose surrounds it. There is
 *  deliberately NO human-verified escape hatch: this daemon runs autonomously and human review
 *  happens only after it finishes, so the disposition is always "restate it provably". */
function convictOnInfeasible(text: string): { uncitable: boolean; reason?: string } {
  const hit = INFEASIBLE_SIGNALS.find((s) => s.re.test(text));
  if (!hit) return { uncitable: false };
  if (namesDaemonProvableProof(text)) return { uncitable: false };
  return {
    uncitable: true,
    reason: `criterion's only stated proof needs ${hit.needs}, which no leaf can reach from inside its own worktree — the criterion is infeasible for the daemon to prove`,
  };
}

const STOP_WORDS = new Set(['a', 'an', 'the', 'no', 'not', 'is', 'are', 'was', 'were', 'left', 'added']);

/** Pull the clearest example token out of offending criterion text: prefer a backticked or
 *  quoted token, else the first non-stop-word identifier-ish bareword. */
function pickTerm(text: string): string {
  const backticked = text.match(/`([^`]+)`/);
  if (backticked) return backticked[1]!;
  const quoted = text.match(/'([^']+)'|"([^"]+)"/);
  if (quoted) return (quoted[1] ?? quoted[2])!;
  const words = text.match(/[A-Za-z_$][\w$.\-/]*/g) ?? [];
  const word = words.find((w) => !STOP_WORDS.has(w.toLowerCase()));
  return word ?? '<term>';
}

/** For absence criteria: strip a leading no|not|without run, then pick the subject term. */
function pickSubject(text: string): string {
  const stripped = text.replace(/^\s*(?:no|not|without)\s+/i, '');
  const term = pickTerm(stripped);
  return term === '<term>' ? '<subject>' : term;
}

/** Pure helper: for a convicted criterion, render the compliant rewrite shape the leaf author
 *  should use instead, with an example token drawn from the offending text. Every arm carries a
 *  stable leading marker so tests and reviewers can anchor on it regardless of wording. */
export function compliantShapeFor(kind: UncitableKind, offendingText: string): string {
  switch (kind) {
    case 'command-result': {
      // NEVER suggest grepping the source tree for the text of a command (friction d08de44a):
      // that yields a criterion which is trivially true and asserts nothing about the code.
      const term = pickTerm(offendingText);
      return `Compliant shape: name what the command PRODUCES, not that it succeeds — for a test, cite the test file (declared in filesToEdit/filesToCreate) and the assertion inside it, e.g. \`${term}\` passes, asserting \`it('<test name>')\` in <declared test file>; for a build or report, assert a readable property of the produced artifact, e.g. <artifact>.json contains <field>. If neither is available, drop the criterion rather than restating the command.`;
    }
    case 'absence': {
      const subject = pickSubject(offendingText);
      return `Compliant shape: move the negation into the size-manifest — e.g. outOfScope: ["${subject}"] — or name a scope guard, e.g. \`git diff HEAD --stat -- <path>\` is empty — or restate as one of the three DELETION/REMOVAL citable forms.`;
    }
    case 'out-of-diff-location': {
      const citations = extractCitations(offendingText);
      const path = citations[0]?.raw ?? '<path>';
      return `Compliant shape: declare it or re-cite — add "${path}" to filesToEdit/filesToCreate, or cite a file:line this leaf actually changes.`;
    }
    case 'infeasible': {
      const term = pickTerm(offendingText);
      return `Compliant shape: state a proof the leaf can run inside its own worktree — no browser, no listening service, no device, no network, no human eye. Pick one: (a) a test file it declares plus the named assertion inside it, e.g. \`bun test <declared test file>\` passes, asserting \`it('<test name>')\`; (b) a typecheck, e.g. \`npx tsc --noEmit\` on the changed files; (c) a file:line citation of the code that implements \`${term}\`; (d) a scoped grep over a declared path; or (e) a git fact, e.g. \`git diff HEAD --stat -- <path>\`. Push the untestable part down to something in-process: assert the state/props/markup the renderer is GIVEN, or the payload the service WOULD receive, instead of what a browser or a person would see.`;
    }
    default:
      return '';
  }
}

/** Classify a single criterion: Rule 0 (acquit-first), then Rules 1–3. */
export function classifyCriterion(
  text: string,
  declaredFiles: readonly string[],
  opts?: CriteriaCitabilityOpts,
): CriterionVerdict {
  // Rule 0: ACQUIT on a resolving citation
  if (acquitOnResolvingCitation(text, declaredFiles)) {
    return { text, citable: true };
  }

  // Rule 0.5: ACQUIT on a concrete output-ARTIFACT content assertion (report.md contains a ## GATE
  // verdict). A produced artifact is citable-by-reading even though it's a runtime output not in the
  // code change-set, so this must precede the out-of-diff conviction. Reuse the 'command-result'
  // kind so the review-time defer predicate honours it too.
  if (assertsCitableArtifact(text)) {
    return { text, citable: true, kind: 'command-result' };
  }

  // Rule 1: CONVICT on out-of-diff-location
  const rule1 = convictOnOutOfDiffLocation(text, declaredFiles, opts);
  if (rule1.uncitable) {
    return {
      text,
      citable: false,
      kind: 'out-of-diff-location',
      reason: `${rule1.reason} ${compliantShapeFor('out-of-diff-location', text)}`,
    };
  }

  // Rule 1.5: ACQUIT on a named runnable read-only verification command with a checkable result.
  // Reuse the 'command-result' kind so the review-time defer predicate accepts it too.
  if (namesVerificationCommand(text) || namesScopeGuardCheck(text)) {
    return { text, citable: true, kind: 'command-result' };
  }

  // Rule 1.6: ACQUIT a TEST INVOCATION stated in the citable three-part shape (runner + declared
  // test file + named assertion) — see namesTestInvocation. Must precede Rule 2, which would
  // otherwise convict it and hand back placebo advice (friction d08de44a). Reuses the
  // 'command-result' kind so the review-time defer predicate honours it like the other acquittals.
  if (namesTestInvocation(text, declaredFiles)) {
    return { text, citable: true, kind: 'command-result' };
  }

  // Rule 2: CONVICT on command-result
  const rule2 = convictOnCommandResult(text);
  if (rule2.uncitable) {
    return {
      text,
      citable: false,
      kind: 'command-result',
      reason: `${rule2.reason} ${compliantShapeFor('command-result', text)}`,
    };
  }

  // Rule 3: CONVICT on absence
  const rule3 = convictOnAbsence(text);
  if (rule3.uncitable) {
    return {
      text,
      citable: false,
      kind: 'absence',
      reason: `${rule3.reason} ${compliantShapeFor('absence', text)}`,
    };
  }

  // Rule 4: CONVICT on infeasible. Deliberately LAST — every existing acquittal and conviction is
  // evaluated first, so this rule can only ever reclassify what would otherwise fall through as
  // citable-by-default. It cannot shadow any kind the other rules already decide.
  const rule4 = convictOnInfeasible(text);
  if (rule4.uncitable) {
    return {
      text,
      citable: false,
      kind: 'infeasible',
      reason: `${rule4.reason} ${compliantShapeFor('infeasible', text)}`,
    };
  }

  // Default: CITABLE (no citation required, no command asserted, no absence claimed)
  return { text, citable: true };
}

/** Validate the blueprint's acceptance criteria against the declared change-set. */
export function validateCriteriaCitability(
  blueprintMd: string,
  declaredFiles: readonly string[],
  opts?: CriteriaCitabilityOpts,
): CriteriaCitability {
  const criteria = parseBlueprintCriteria(blueprintMd);

  if (criteria.length === 0) {
    // No criteria section found — we abstain (a doc-only leaf is fine)
    return { status: 'abstain', verdicts: [], offenders: [], reasons: [] };
  }

  const verdicts = criteria.map((c) => classifyCriterion(c, declaredFiles, opts));
  const offenders = verdicts.filter((v) => !v.citable);

  if (offenders.length === 0) {
    // All criteria are citable
    return { status: 'ok', verdicts, offenders, reasons: [] };
  }

  // At least one offender — extract reasons
  const reasons: string[] = offenders
    .slice(0, MAX_NAMED_OFFENDERS)
    .map((o) => `criterion "${o.text.slice(0, 60)}"${o.reason ? ': ' + o.reason : ''}`);

  const rest = offenders.length - MAX_NAMED_OFFENDERS;
  if (rest > 0) {
    reasons.push(`and ${rest} more uncitable criterion(criteria)`);
  }

  return { status: 'uncitable', verdicts, offenders, reasons };
}

/** DEFER-TO-EVIDENCE predicate (floor-path fix). An uncited PASS-criterion set is NOT
 *  review-vacuous when EVERY uncited criterion is a structural COMMAND-RESULT. Those name a
 *  command (tsc/test/build/lint/grep) that the command-evidence gate verifies against the
 *  RECORDED exit codes — they cannot be cited to a diff line, so grounding must defer them to
 *  that gate rather than discard a correct leaf. ABSENCE / non-goal criteria are deliberately
 *  NOT deferred here: no recorded command verifies a negative, so the reviewer must mark those
 *  `[N/A]` (a judgment the classifier must not make — "No regression in auth" is a real check). */
export function uncitedCriteriaAreAllCommandResults(
  criteria: ReadonlyArray<{ text: string; outcome: string; citations: ReadonlyArray<unknown> }>,
  declaredFiles: readonly string[],
): boolean {
  const uncited = criteria.filter((c) => c.outcome !== 'not-applicable' && c.citations.length === 0);
  if (uncited.length === 0) return false;
  return uncited.every((c) => classifyCriterion(c.text, declaredFiles).kind === 'command-result');
}
