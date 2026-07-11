# Blueprint — Gate escape: acceptance gate must run the change-set's OWN tests (f5cab8d4)

## Problem (confirmed root cause)

The daemon built `f5cab8d4` (UI reactivity refactor, 19 nodes, waves/leaf-executor
path) and the mechanical acceptance gate ACCEPTED it (status done/accepted,
retryCount 0) — even though the change-set **adds** a test,
`ui/src/components/supervisor/bridge/funnel.live.test.ts`, that FAILS against the
daemon's own implementation (`claimable todo: resolves to ready WITH byId,
collapses to backlog WITHOUT byId` → expected `ready`, got `backlog`).

### Why the gate let it through

The leaf-executor routes acceptance through the SAME registry gate as the daemon
worker path — `coordinator-live.ts:2514` builds a `GateSubject` and calls
`runRegistryGate` (`src/services/gate-runner.ts:121`). `runRegistryGate` resolves
**exactly ONE** plugin (`resolveGatePlugin`, first by tier then registration
order) and runs it.

The registered plugins (`gate-runner.ts`):
- `frontendSuiteGatePlugin` (id `frontend-suite`, tier `project`, registered first)
  — `appliesTo` requires `type ∈ {frontend, ui}` **AND**
  `manifest.frontendGateCommand?.trim()` (`:360`).
- `manifestCommandGatePlugin` (id `manifest-command`, tier `project`, registered
  second) — `appliesTo` requires `manifest.gateCommand?.trim()` (`:404`); runs the
  command and **change-set-narrows** a failure (`scopeFailureToChangeSet`).

This repo's manifest `.collab/project.json` declares **only**:
```json
{ "version": 1, "gateCommand": "npx tsc --noEmit" }
```
There is **no `frontendGateCommand`**, so for the ui leaf `frontendSuiteGatePlugin`
did not apply and resolution fell to `manifestCommandGatePlugin`, which ran
`npx tsc --noEmit` (clean) and accepted. **The newly-added vitest spec was never
executed.** tsc-clean + trial-merge-clean is not "tests pass"; the leaf's own
red test was invisible to the gate. (The union test run later caught it — the
"verify the union, not just the per-leaf gate" lesson; this fixes the per-leaf
gate so it never accepts a leaf whose own change-set test is red.)

## Fix (design)

Add a **change-set-scoped test gate** for frontend/ui leaves: after the tsc gate
passes, run the leaf's own added/modified spec files and FAIL acceptance on any
red. Keep `gate-runner.ts` domain-free — the test command is **declared in the
project manifest as data** (mirrors `gateCommand` / `frontendGateCommand`), so the
core learns no "vitest"/"ui" specifics.

Because the registry runs only one plugin and ui leaves currently resolve to
`manifestCommandGatePlugin` (tsc), the new plugin must run **both** tsc and the
change-set tests. We extract the existing manifest-command body into a shared
helper and compose.

### Resolution after the change (same tier `project`, ordered by registration)

1. `frontendSuiteGatePlugin` — applies only when `frontendGateCommand` declared
   (full-suite gate; unchanged). Stays registered FIRST so it still wins when a
   project opts into the full suite.
2. `changeSetTestGatePlugin` (NEW) — applies when `type ∈ {frontend, ui}` AND
   `manifest.changeSetTestCommand` declared AND no `frontendGateCommand`. Runs
   tsc (shared helper) THEN the change-set's spec files.
3. `manifestCommandGatePlugin` — unchanged fallback for everything else.

A non-ui leaf, or a ui leaf with no `changeSetTestCommand`, behaves exactly as
today (no regression).

## Change shape

### 1. `src/config/project-manifest.ts` — declare the new manifest fields

In `interface ProjectManifest` (after `frontendBaselineFailures`, ~`:93`) add:

```ts
  /** Acceptance-gate command for FRONTEND/UI leaves that runs ONLY the leaf's OWN
   *  change-set spec files (added/modified `*.test.*` / `*.spec.*`), so a leaf can
   *  never be accepted while a test IT added is red (the f5cab8d4 escape: tsc was
   *  clean but the leaf's new vitest spec failed and the gate never ran it). The
   *  `{files}` placeholder is replaced with the change-set's spec paths (relative
   *  to `changeSetTestCwd`), space-separated and shell-quoted. Run via `sh -c` in
   *  `<laneCwd|gateProject>/<changeSetTestCwd>`. A non-zero exit REJECTS. Absent →
   *  ui/frontend leaves fall through to the generic `gateCommand` (today's
   *  behavior). Distinct from `frontendGateCommand`: that runs the FULL suite vs a
   *  baseline; this runs only the touched specs (fast, no baseline to maintain). */
  changeSetTestCommand?: string;
  /** Subdirectory (relative to the gate repo / lane worktree) the
   *  `changeSetTestCommand` runs in, and the prefix stripped from change-set spec
   *  paths before `{files}` substitution (e.g. `ui` so vitest sees `src/...`
   *  paths it can resolve). Omitted → repo root, no prefix stripped. */
  changeSetTestCwd?: string;
```

No code changes needed elsewhere in this file (the fields are plain data read by
the gate plugin).

### 2. `src/services/gate-runner.ts` — extract helper + add the plugin

**(a) Extract the manifest-command body into a reusable exported helper.** The
current `manifestCommandGatePlugin.run` (`:405-434`) becomes a thin wrapper:

```ts
/** Run the project's generic `gateCommand` (e.g. `npx tsc --noEmit`) with
 *  change-set narrowing on failure. Returns null when no gateCommand is declared
 *  (caller treats as "nothing to run"). Shared by manifestCommandGatePlugin and
 *  changeSetTestGatePlugin so the tsc gate runs exactly once, identically. */
export async function runManifestCommand(ctx: GateSubject): Promise<GateVerdict | null> {
  const cmd = ctx.manifest?.gateCommand?.trim();
  if (!cmd) return null;
  try {
    const cwd = ctx.laneCwd ?? ctx.gateProject;
    const proc = await ctx.exec(['sh', '-c', cmd], { cwd, capture: true });
    const out = proc.stdout + '\n' + proc.stderr;
    const structured = parseTrailingVerdict(out);
    if (structured) return structured;
    if (proc.code === 0) return { passed: true, reasons: [] };
    const scoped = scopeFailureToChangeSet(out, await fetchChangeSet(ctx));
    if (scoped) return scoped;
    return { passed: false, reasons: [`gate command exited ${proc.code}: ${lastLines(out, 20)}`] };
  } catch (e) {
    return { passed: false, reasons: [`gate could not run (${cmd}): ${e instanceof Error ? e.message : String(e)}`] };
  }
}

export const manifestCommandGatePlugin: GatePlugin = {
  id: 'manifest-command',
  tier: 'project',
  appliesTo: (obj) => Boolean(obj.manifest?.gateCommand?.trim()),
  run: (ctx) => runManifestCommand(ctx),
};
```

(`fetchChangeSet` is already module-private and usable here; keep it private.)

**(b) Add spec-file helpers** (near `extractFailingTests`, reuse it for parsing):

```ts
/** Default matcher for "a test file": `*.test.*` / `*.spec.*` with a JS/TS ext. */
export const SPEC_FILE_RE = /\.(test|spec)\.(tsx?|jsx?|mts|cts|mjs|cjs)$/;

/** The change-set members that are spec files, with `cwd` stripped to the path
 *  the test runner resolves (e.g. `ui/src/x.test.ts` + cwd `ui` → `src/x.test.ts`).
 *  Returns paths relative to `cwd` (or root-relative when cwd omitted). */
export function specFilesInChangeSet(
  changeSet: readonly string[],
  cwdRel?: string,
): string[] {
  const prefix = cwdRel ? cwdRel.replace(/\/+$/, '') + '/' : '';
  const out: string[] = [];
  for (const raw of changeSet) {
    const p = normPath(raw);
    if (!SPEC_FILE_RE.test(p)) continue;
    if (prefix) {
      if (!p.startsWith(prefix)) continue; // a spec outside the test cwd — skip
      out.push(p.slice(prefix.length));
    } else {
      out.push(p);
    }
  }
  return [...new Set(out)];
}
```

**(c) Add the plugin and register it BETWEEN frontendSuiteGatePlugin and
manifestCommandGatePlugin** (so it out-resolves the manifest plugin for ui leaves,
but yields to the full-suite plugin when that's configured):

```ts
export const changeSetTestGatePlugin: GatePlugin = {
  id: 'changeset-test',
  tier: 'project',
  appliesTo: (obj, type) =>
    (type === 'frontend' || type === 'ui') &&
    Boolean(obj.manifest?.changeSetTestCommand?.trim()) &&
    !obj.manifest?.frontendGateCommand?.trim(),
  run: async (ctx): Promise<GateVerdict | null> => {
    // 1. tsc first (shared helper). A tsc failure rejects before we bother with tests.
    const base = await runManifestCommand(ctx);
    if (base && !base.passed) return base;

    // 2. The leaf's OWN spec files (added or modified), from its change-set.
    const tmpl = ctx.manifest!.changeSetTestCommand!.trim();
    const cwdRel = ctx.manifest?.changeSetTestCwd?.trim() || undefined;
    const changeSet = await fetchChangeSet(ctx);
    if (!changeSet) {
      // Can't read the change-set → fail CLOSED (don't accept unverified tests).
      return { passed: false, reasons: ['change-set test gate: could not read change-set'] };
    }
    const specs = specFilesInChangeSet(changeSet, cwdRel);
    if (specs.length === 0) return base ?? { passed: true, reasons: [] }; // no new tests → tsc verdict stands

    // 3. Run them. cwd = <lane|gateProject>/<changeSetTestCwd>.
    const root = ctx.laneCwd ?? ctx.gateProject;
    const cwd = cwdRel ? `${root}/${cwdRel}` : root;
    const filesArg = specs.map((f) => `'${f.replace(/'/g, "'\\''")}'`).join(' ');
    const cmd = tmpl.replace(/\{files\}/g, filesArg);
    try {
      const proc = await ctx.exec(['sh', '-c', cmd], { cwd, capture: true });
      const out = proc.stdout + '\n' + proc.stderr;
      const structured = parseTrailingVerdict(out);
      if (structured) return structured;
      if (proc.code === 0) {
        return { passed: true, reasons: [], metrics: { changeSetTestGate: true, ranSpecs: specs } };
      }
      const failing = extractFailingTests(out);
      return {
        passed: false,
        reasons: [
          `change-set test gate: ${failing.length || 'unattributed'} failing test(s) in this leaf's own change-set`,
          ...(failing.length ? failing.slice(0, 20) : [lastLines(out, 20)]),
        ],
        metrics: { changeSetTestGate: true, ranSpecs: specs, failingTests: failing },
      };
    } catch (e) {
      return { passed: false, reasons: [`change-set test gate could not run (${cmd}): ${e instanceof Error ? e.message : String(e)}`] };
    }
  },
};

registerGatePlugin(changeSetTestGatePlugin);
```

Placement: put the plugin + its `registerGatePlugin(...)` call **after**
`registerGatePlugin(frontendSuiteGatePlugin)` (`:399`) and **before** the
`manifestCommandGatePlugin` definition/registration (`:401-437`). Registration
order is the within-tier tiebreaker, so this guarantees the resolution above.

### 3. `.collab/project.json` — declare the command for THIS repo

ui tests run with vitest from `ui/` (`ui/package.json`: `"test:ci": "vitest --run"`).
Add:

```json
{
  "version": 1,
  "gateCommand": "npx tsc --noEmit",
  "changeSetTestCommand": "bunx vitest --run {files}",
  "changeSetTestCwd": "ui"
}
```

`changeSetTestCwd: "ui"` makes the gate run vitest in `ui/` and pass spec paths as
`src/...` (relative to ui), which vitest resolves. For `f5cab8d4` the change-set
includes `ui/src/components/supervisor/bridge/funnel.live.test.ts` → stripped to
`src/components/supervisor/bridge/funnel.live.test.ts` → vitest runs it → red →
**REJECT** (the exact escape this closes). Edit the worktree copy
`.collab/project.json` (it commits to the branch and lands to master).

### 4. NEW `src/services/__tests__/gate-runner-changeset-tests.test.ts`

`bun:test`, mirroring `gate-runner-cwd.test.ts` (inject a fake `exec`; stub the
change-set by having `exec` answer the `git ... status --porcelain` /
`diff --name-only` calls, OR set `laneCwd`+`integrationBase` and answer those git
calls in the fake exec). Cases:

1. **Regression test (the bug):** ui leaf, change-set contains a spec file, the
   vitest command exits non-zero → `verdict.passed === false`, reasons mention the
   failing test. (Asserts a leaf with a red OWN test is rejected.)
2. ui leaf, spec command exits 0 → `passed === true`, `metrics.ranSpecs` includes
   the spec.
3. ui leaf, change-set has NO spec files → vitest is NOT invoked; verdict is the
   tsc pass.
4. tsc (`gateCommand`) fails → reject WITHOUT invoking the test command.
5. test command throws (spawn error) → `passed === false` (fail closed).
6. `resolveGatePlugin`: for a ui leaf with `changeSetTestCommand` (no
   `frontendGateCommand`) resolves to `changeset-test`; with `frontendGateCommand`
   resolves to `frontend-suite`; for a non-ui leaf resolves to `manifest-command`.

## Out of scope / notes
- Does NOT change the full-suite `frontendSuiteGatePlugin` (cross-file regressions
  remain the union-verify discipline's job). This gate only guarantees a leaf's
  OWN added/modified specs are green — the specific f5cab8d4 escape.
- No durable schema, no migration. Manifest fields are optional; absent → today's
  behavior exactly.
- `f5cab8d4`'s work lives on `collab/epic/df338385`, NOT landed (merge aborted);
  this fix is independent of re-landing that work.

```json
{ "schemaVersion": 1, "estimatedFiles": 4, "estimatedTasks": 4,
  "nonEnumerableFanout": false,
  "filesToCreate": ["src/services/__tests__/gate-runner-changeset-tests.test.ts"],
  "filesToEdit": ["src/config/project-manifest.ts", "src/services/gate-runner.ts", ".collab/project.json"],
  "tasks": [
    { "id": "manifest-fields", "files": ["src/config/project-manifest.ts"], "description": "Add changeSetTestCommand + changeSetTestCwd optional fields to ProjectManifest" },
    { "id": "gate-plugin", "files": ["src/services/gate-runner.ts"], "description": "Extract runManifestCommand helper; add SPEC_FILE_RE + specFilesInChangeSet + changeSetTestGatePlugin registered between frontend-suite and manifest-command" },
    { "id": "project-manifest-config", "files": [".collab/project.json"], "description": "Declare changeSetTestCommand 'bunx vitest --run {files}' + changeSetTestCwd 'ui'" },
    { "id": "tests", "files": ["src/services/__tests__/gate-runner-changeset-tests.test.ts"], "description": "Unit tests: red own-spec rejects, pass accepts, no-spec=tsc-only, tsc-fail short-circuits, spawn-error fails closed, resolution order" }
  ] }
```
