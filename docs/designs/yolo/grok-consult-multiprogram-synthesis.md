# Grok skeptic pass — multi-program platform design (synthesis)

Model: `grok-build-0.1`. System framing: skeptical principal engineer, local-first/single-user.
Critiques the Layer A/B/C plan in `design-collab-as-multiprogram-platform`. Below: Grok's point → my ACCEPT / TEMPER / DISCOUNT against our actual context.

## 1. `assigneeKind` overloads `ready` → human path becomes a special case everywhere
**Grok:** `ready` now means two things ("daemon may claim" vs "exists & unblocked"). The coordinator must re-evaluate on every human `done`; there's no lease to revoke if a human un-does; the gate becomes a rubber-stamp for the human branch. Sharper: coordinator owns ONLY agent-executable work; humans get a thinner model; the inbox is a **view over the graph**, not a second class of claimable todo.

**Verdict: ACCEPT the framing, TEMPER the implementation.** The user explicitly chose "same graph, human assignee" (and rejected a separate store), so we keep one graph — but we honor Grok by making the coordinator's exclusion **one clean filter at the claim boundary** (`WHERE assigneeKind='agent'`), NOT a skip-flag sprinkled through lease/retry/gate. The human inbox is a **read-only view**; human todos never enter the claim/lease/gate machinery at all. This is the difference between "a different actor on the same graph" (good) and "a second execution contract bolted onto the todo record" (what Grok warns against). → Sharpens B2's spec: exclusion is a query filter; human todos are structurally outside claim/lease/gate.

## 2. Sharing the CAD binary gate is wrong-shaped for metrics
**Grok:** A geometry gate is a **structural invariant** (cheap, pure, re-runnable). mAP is a **policy threshold** on a **non-reproducible** training run over **heavy gitignored binaries**. Forcing one gate concept makes it "a bag of parameters" or you end up with two gate kinds anyway. yolox — not CAD — is the case that should have driven the gate design.

**Verdict: ACCEPT.** Split the concept explicitly: (a) shared **artifact transport** (don't store gitignored blobs in-repo; reference by handle/metadata) — genuinely common to STEP/PNG/.pth/.blob; (b) **two gate KINDS** — `structural` (CAD: validity/diff/schema) vs `metric-threshold` (yolox: parse a metric, apply a policy threshold). Do NOT pretend one verdict shape fits both. → Adjusts A3 + the CAD binary-gate todo: the binary-artifact gate is transport-only; the verdict kind is declared per program.

## 3. Deferring identity silently corrupts Layer B
**Grok:** Layer B introduces the first **durable human decision** ("I reviewed these labels") that downstream training/export implicitly trust. Recording only "session X marked done" loses attribution. **Auth can be deferred; attribution on human decisions cannot.** Minimal seam: a first-class `actor`/`principal` (even just `local:<hostname>` + optional display name) recorded as **who completed** a human todo.

**Verdict: ACCEPT — strongest point, and it confirms the insurance I flagged earlier.** Fold a minimal actor primitive into B1: store `completedBy` (an opaque actor handle) on human-todo completion, and let `assignee` be `human:<actor>`. This is NOT auth and NOT Layer C — it's one nullable string column that makes C a backfill instead of a migration. → B1 gains `actor`/`completedBy`; C stays vision-only.

## 4. #1 unnamed risk — the human loop breaks "claim-once → run-to-gate"
**Grok:** Annotation is **iterative**, not fire-and-forget: auto-label → human corrects a subset → maybe re-auto-label → "good enough for now, train on it, keep reviewing." The graph has no home for partial progress / iteration. Training-depends-on-review means training consumes a **soft, unverified, mutable** input; if the human changes the dataset mid-train, or labels were bad, there's no clean way to invalidate the run. And gitignored binaries mean **the graph is no longer self-describing** — "what exact input produced this run?" chases external files not versioned by graph state.

**Verdict: ACCEPT — the deepest insight.** Mitigation we should design in (not necessarily build now): the training todo must depend on a **pinned dataset snapshot/version**, not "review todo done." Pin the input (a dataset revision id / content hash from annotator-mcp) so a run is reproducible and invalidatable, and so the graph references an immutable handle rather than mutable on-disk files. The iteration loop stays in the program's native UI; collab tracks **batch-level checkpoints** ("review round N complete → dataset rev R"), not per-image churn. → New consideration on Epic A/B: dataset-versioning/pinning as the contract between human review and mechanical training.

## Net changes to the plan (proposed, for human approval)
1. **B2:** coordinator exclusion = a single claim-boundary query filter; human todos never touch claim/lease/gate. (clarity, not new scope)
2. **B1:** add a minimal `actor`/`completedBy` handle now (attribution ≠ auth). (small scope add)
3. **A3 + CAD binary gate:** separate **artifact transport** (shared) from **gate verdict kind** (`structural` vs `metric-threshold`, declared per program). (re-frame, not new todo)
4. **A/B (new consideration):** training input must be a **pinned dataset revision**, not "review done"; collab tracks batch checkpoints, program owns per-image iteration. (likely a new planned todo under Epic A)

None promoted to `ready` — these refine the `planned` graph pending sign-off.
