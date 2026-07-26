# Gate–Review Serialization Dependence

DECISION: serial — gate ‖ review is not verdict-neutral and is NOT enabled; the serial order stands.

## Summary

The mechanical gate and review node must execute serially (in that order), not in parallel.
The dependence is threefold: control-flow (gate status gates review spawn), tree state
(optimistic pre-review merge for small/test-pinned tiers), and verdict semantics (falsifiability
and coverage demotions are conditioned on a green mechanical gate). Decoupling any one would
require explicit ordering barriers or restructured sentinel propagation.

## Cited Call Sites

### Dependence #1: Gate ERROR short-circuits review entirely

`src/services/leaf-executor.ts:3812`: Gate status check
```typescript
if (mech.status === 'error') {
  // ...
  return parkBlocked(formatGateErrorReason(mech));  // line 3814
}
```

No review node is ever spawned when the gate encounters an error condition. This is a hard
precondition: review is unreachable if the gate failed to run.

### Dependence #2: Gate FAIL replaces review verdict with gate findings

`src/services/leaf-executor.ts:3836`: Gate status check
```typescript
if (mech.status === 'fail') {
  findings = gateFindingsText(mech);
} else {
  // ... 3838–4136: ONLY arm that spawns review
  // const review = await runNode('review', buildSpec('review', cwd, blueprintBody));  // line 3920
}
```

The review node is spawned only in the else-arm (line 3920), which runs exclusively when
`mech.status === 'pass'`. A red gate short-circuits the entire review dispatch.

### Dependence #3: Optimistic pre-review merge for small and test-pinned tiers

`src/services/leaf-executor.ts:3848–3861`: Ordered before review spawn
```typescript
if ((smallTier || testPinnedTier) && !optimisticallyLanded) {
  // ... checks and setup
  const mergeRes = (await deps.mergeToEpic(...));  // line 3861
  // merge succeeds or fails
}
// Then, below the merge block:
const review = await runNode('review', buildSpec('review', cwd, blueprintBody));  // line 3920
```

For small and test-pinned tiers, the tree is merged to the epic branch BEFORE review runs.
The post-land revert arm at `src/services/leaf-executor.ts:4159` depends on this ordering:
if review FAILs after an optimistic merge, the revert is conditional and meaningful only because
the merge preceded review.

### Dependence #4: Falsifiability and coverage demotions are green-mech-conditioned

`src/services/leaf-executor.ts:4024` and `:4056` (assignments)
```typescript
reviewAbstained = true;  // line 4024 — only set inside mech.status==='pass' else-arm
reviewAdvisory = true;   // line 4056 — only set inside mech.status==='pass' else-arm
```

The demotion logic at `src/services/leaf-executor.ts:4148`:
```typescript
if (reviewVerdict === 'fail' && (reviewAbstained || reviewAdvisory)) {
  reviewVerdict = 'pass';  // line 4148–4149
}
```

This condition encodes "on a GREEN mechanical gate" — `reviewAbstained` and `reviewAdvisory`
are set only when `mech.status === 'pass'`. In a parallel gate‖review model, these flags would
be evaluable before the gate status is known, changing their meaning. The core non-neutrality
is that the demotion rules are NOT independent of the gate's verdict.

## Not a Prompt Dependence (Gate-Blind Review)

The review node's prompt is intentionally gate-blind:

- `buildReviewPrompt(leaf, baseRef)` at `src/services/leaf-executor.ts:1491` takes no gate output.
- The review spawn at line 3920 calls `buildSpec('review', cwd, blueprintBody)` with the
  `reviewFindings` parameter (signature at `:2669–2674`) left UNDEFINED.
- Gate text reaches only the implement node via `buildSpec('implement', cwd, blueprintBody, findings)`
  at `src/services/leaf-executor.ts:4173`, where `findings` carries gate findings if the gate FAILed.

A reader of `buildReviewPrompt` alone would wrongly conclude review is gate-independent. This
note documents that the dependence is control-flow and tree-state, not prompt content.

## Ordering Barrier Requirement

Before gate‖review parallelism could be enabled, each dependence would require an explicit
ordering barrier:

1. **Error short-circuit**: Gate spawn must report its error synchronously before review dispatch
   is considered (async gates would need a `gate.ready` signal).
2. **Fail branch guard**: Review spawn condition must poll the gate status (loses parallelism),
   or the gate must report its status upfront and the review must be gated on it
   (reintroducing serialization at dispatch).
3. **Optimistic merge ordering**: Merge must complete before review starts, enforced via a
   deterministic gate→merge→review barrier (conflicts with parallel dispatch).
4. **Demotion sentinel**: The `reviewAbstained` / `reviewAdvisory` flags must be assigned
   gate-independently (e.g., derived from review text alone, without a gate-status check), or the
   demotion condition must be restructured to not encode gate-conditionality.

---

**Line numbers as of commit `6d5749b4`.** Lines shift with each edit above the citation points;
the file and function names are stable anchors for re-verification.
