# blueprint-lab

blueprint-lab measures whether the real blueprint node can reliably emit valid v2
DiffContracts against real historical leaves mined from this repo's own git history.

## Usage

Run the full pipeline (emit → score → report):

```bash
bun run scripts/blueprint-lab/run.ts
```

Optional case-id args restrict the run to specific corpus cases (forwarded to `emit.ts`):

```bash
bun run scripts/blueprint-lab/run.ts <caseId> [<caseId> ...]
```

You can also run each stage standalone, to iterate on just one stage without re-running the
others:

```bash
bun run scripts/blueprint-lab/emit.ts [caseId...]   # spawn the blueprint node per corpus case
bun run scripts/blueprint-lab/score.ts               # score results/run.json against corpus.ts
```

## Env vars

- `BLUEPRINT_MODEL` (default `sonnet`)
- `BLUEPRINT_EFFORT` (default `medium`)

Set these to match whatever model/effort the daemon actually runs blueprint nodes at for
faithful measurement — run at the same model/effort the daemon's blueprint node actually
uses, not a stronger default, or results won't be faithful.

## Output

- `results/run.json` — raw emit output (one parsed contract-or-null per corpus case)
- `results/score.json` — scored results (validation mode + file-match stats per case, plus
  aggregate stats)
- `results/report.md` — human-readable report (acceptance table, rejection-mode breakdown,
  match-rate summary, GATE verdict)
- `results/<id>.emit.md` — raw per-case node reply text

## Scope

This is a standalone measurement harness: it does not wire into `leaf-executor.ts`, the
daemon pipeline, or `diff-contract.ts`, and running it never mutates those files or any live
todo/mission state.
