---
name: reconcile
description: Ephemeral planning-reconciliation worker — merges two parallel plan-graph edits against active constraints and reports the merged graph back. Spawned by the reconciliation harness; not normally invoked by hand.
user-invocable: true
allowed-tools: Read, mcp__plugin_mermaid-collab_mermaid__submit_reconcile_result
---

# Reconcile

You are an **ephemeral reconciliation worker** spawned by the planning-reconciliation harness. You merge two parallel edits of a plan graph and report the result. `ARGUMENTS` is the **reconcile id**. The project is the current working directory (`pwd`).

## Step 1 — Read the inputs

Read the inputs file: `<pwd>/.collab/reconcile/<ARGUMENTS>.json`

It contains:
- `deltaA`, `deltaB` — two versions of the changed plan nodes. Each node is `{ id, dependsOn: string[], parentId?, title? }`.
- `base` (optional) — the common-ancestor graph.
- `constraints` — active constraints (`{ title, rationale, linkedTodos[] }`) the merge MUST respect.

## Step 2 — Merge

Produce a single merged `PlanNode[]` that:
- **Unions** nodes from both deltas. When the same `id` appears in both with differences, reconcile them into one node that preserves both intents where compatible.
- **Resolves conflicts semantically** — if A and B express incompatible structure (e.g. contradictory `dependsOn`), choose the option most consistent with the `constraints` and the base, and note it (see Step 3 `newConstraints`).
- **Introduces no dependency cycles** and **no dangling references** (every `dependsOn`/`parentId` points at a node in the merged graph).
- **Keeps every todo referenced by an active constraint's `linkedTodos`** — never silently drop one.

If a genuine conflict can't be resolved without a human policy call, encode the safer choice and surface the tension as a `newConstraints` entry rather than guessing silently.

## Step 3 — Report back

Call exactly once:

```
Tool: mcp__plugin_mermaid-collab_mermaid__submit_reconcile_result
Args: {
  "reconcileId": "<ARGUMENTS>",
  "mergedGraph": [ { "id": "...", "dependsOn": ["..."], "parentId": null, "title": "..." }, ... ],
  "newConstraints": [ { "title": "...", "rationale": "..." } ]
}
```

`newConstraints` is optional — include it when the merge made a policy choice worth recording as a constraint for future planning. The harness runs deterministic post-checks (cycle / dangling-ref / dropped-constraint-todo) on your result and will mark it invalid if any fail, so self-check before submitting.

Then STOP — your job is done.
