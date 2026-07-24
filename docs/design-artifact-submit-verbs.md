# Design: artifact-author nodes submit through a verb, not general Write

Status: SPEC (not built). Grounded against leaf-executor.ts on 2026-07-24.
Prerequisite for rollout: dontAsk round-two confirmed clean (do not change the blueprint
contract and the permission mode in the same deploy window).

## The question

Should the blueprint node's `Write` grant be replaced by a dedicated MCP tool?

Yes — and it generalises. The right frame is a split the permission survey already implied:

- **Artifact authors** emit ONE known thing: `blueprint` → a `.md` + manifest, `driveplan` → an
  AssemblyBuildPlan, `report` → a findings `.md`. These should hold a NARROW submission surface
  and **no** general `Write`, **no** `Bash`.
- **Code editors** touch ARBITRARY files: `implement`, `wimplement`, `fix`. You cannot funnel
  arbitrary edits through one verb, so these keep `Edit`+`Write`, confined to the worktree by the
  PreToolUse hook. (This is why the 2026-07-24 grant fix *added* `Write` to implement while
  blueprint should *lose* it — opposite treatments for opposite node classes.)

## What already exists (reuse, don't reinvent)

`report` already does the target thing. It has NO `Write`: it emits its markdown as its final
message, and the EXECUTOR persists it via the `writeArtifact` deps seam
(leaf-executor.ts ~:618). The rationale is recorded in the seam's own comment: a headless node's
new-file `Write` resolves to the project ROOT (a worktree's `.git` points back to the main repo),
not the worktree, so a node-written file never reaches `mergeToEpic` and the accept reverses.

`blueprint` is the lone artifact-author still on the old path: the node `Write`s
`.collab/leaf-blueprints/<id>.md` itself, and the executor reads it back through the
`readBlueprint` seam (leaf-executor.ts :609) to derive the `LeafSizeManifest` — which it extracts
by **parsing a trailing ```json fence out of free-text prose** (:1788). That fence-parse is
fragile and the manifest is load-bearing (it drives the size gate AND the Bridge file-manifest,
todo 86b2f019).

## Two ways to remove blueprint's Write

**Option A — report pattern (cheap).** Blueprint emits `{prose + manifest}` as its final message;
the executor writes it to `blueprintPath` via the existing `writeArtifact` seam (already captured
to the ledger as `outputText`). Blueprint drops `Write`. Zero new MCP surface.
- Pro: reuses proven machinery; smallest diff; immediate security win.
- Con: the manifest is still fence-parsed out of prose — the fragility remains.

**Option B — `submit_blueprint` verb (the ask).** Blueprint calls
`mcp__mermaid__submit_blueprint({ blueprintText, manifest })`. The server VALIDATES the manifest
against the `LeafSizeManifest` schema, writes the `.md` to the worktree path it controls, and
records the ledger row. Blueprint drops `Write` AND the fence-parse.
- Pro: structured, server-validated manifest (kills the fence fragility); server owns the path
  (kills the project-root-vs-worktree hazard by construction); explicit `narrow` grant.
- Con: a new MCP tool + rewiring the executor to source the blueprint from the verb's captured
  content instead of `readBlueprint`.

**Recommendation: B for blueprint.** The manifest is load-bearing and the fence-parse has been a
recurring pain (cf. the typed-blueprint / LeafBlueprint-v2 work). Paying once for structured,
validated submission retires both the `Write` grant and the parse fragility. `driveplan` gets the
sibling `submit_plan` verb by the same argument (it authors one structured plan). `report` already
conforms and needs no change.

## Verb contract (blueprint)

`submit_blueprint({ project, leafId, blueprintText, manifest }) -> { ok, path }`
- Resolves the caller's lane worktree from the session→worktree binding (the same binding the
  worktree-confinement work needs; if that isn't in yet, the verb takes the worktree path the
  executor already knows and passes at spawn).
- Validates `manifest` against `LeafSizeManifest` (schemaVersion, estimatedFiles, estimatedTasks,
  nonEnumerableFanout, …); a malformed manifest is a structured error the node can correct, not a
  silent FLOOR fallback.
- Writes `blueprintText` to `blueprintPath(leaf)` inside the worktree (server-controlled path).
- Records the ledger row (`recordLeafBlueprint`) so the durable source stays the ledger.
- Idempotent per (leafId, attempt): a re-submit overwrites, matching today's re-emit gate.

## Grant / spec changes (node-permissions.ts)

- `blueprint`: intent `planner` → **`narrow`**; target `[Read, Grep, Glob, submit_blueprint]`
  (drop `Write`, drop `Bash` — inspection is Grep/Glob). Gap ledger loses `blueprint: [Bash]`,
  gains the Write removal.
- `driveplan`: target `[Read, Grep, Glob, submit_plan]` (drop `Write`, drop `Bash`).
- Under dontAsk the verb is allow-listed; general `Write` denies. Blueprint can then ONLY submit
  its blueprint — the tightest grant in the fleet.

## Executor rewiring

- Replace the `readBlueprint` read-back with the content the verb captured (or have the verb write
  the `.md` and keep `readBlueprint` — simpler, one fewer seam change).
- The size-gate/re-emit path (leaf-executor.ts :3228–:3319) consumes the validated manifest
  directly instead of re-parsing the fence.
- Blueprint prompt (`buildNodePrompt` 'blueprint' case): "call `submit_blueprint` with your
  blueprint text and manifest" replaces "WRITE it to `<path>` … FINISH with a trailing ```json
  block".

## Staging

1. Land dontAsk round-two clean first (this is gated).
2. Build `submit_blueprint` + `submit_plan` verbs + validation; wire the executor; keep `Write` in
   the grant during a shadow window (verb writes, but Write still allowed) to de-risk.
3. Flip blueprint/driveplan grants to `narrow` (drop Write/Bash); update the lock test + gap
   ledger; deploy.
4. Watch a blueprint leaf run under dontAsk using only the verb — no denial, structured manifest.

## Non-goals

- Code editors (implement/wimplement/fix) are OUT of scope — they keep Edit/Write, confined by the
  hook. Do not try to funnel arbitrary edits through a verb.
