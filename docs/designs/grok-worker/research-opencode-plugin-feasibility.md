# opencode plugin/SDK feasibility — can collab carry the discipline?

Question: ship collab as (1) an MCP server opencode consumes + (2) an opencode
**plugin** carrying our work discipline, with opencode as the worker runtime behind
our `WorkerAgent` port. Can the plugin layer carry **server-authoritative completion
+ host-driven fix loop + fresh-context verify**? (Sources: opencode.ai/docs,
`@opencode-ai/plugin` types, GitHub issues. Repo moved org sst → anomalyco.)

## Gating questions — verdicts

**Q1 — Veto/gate completion → PARTIAL-GO.**
- `tool.execute.before(input,{args})` — a **`throw` genuinely aborts** the tool call
  (the official `.env`-protection example throws to block). So our plugin CAN
  intercept a `complete_todo` MCP call, run our gate, and refuse it. ✅
- `permission.ask` is **defined in types but NOT wired** (issue #7006, still open;
  bypassed on first-encounter #19927). **Do not rely on it.** ❌
- Best design: completion is a **host action via the SDK with NO model-callable
  "mark done" tool** — exactly our Phase-1 plan. Most robust; sidesteps the
  permission-hook weakness entirely.

**Q2 — Scoped gate at a boundary + re-prompt fix loop → PARTIAL.**
- Plugin context exposes **`$` (Bun shell)** → run tsc/tests. ✅
- Plugin context exposes **`client` SDK** → `client.session.prompt(...)` re-prompts
  the same session (the fix loop). ✅
- BUT `session.idle` event handlers are **fire-and-forget — can't be awaited/blocked**
  (issues #16879, #16626 propose fixing this). So the fix loop is **detect-then-push,
  not a hard blocking barrier** — small race window. Combined with the Q1 veto, "done"
  still can't slip through; the clean turn-boundary guarantee just isn't first-class.

**Q3 — Fresh-context verify sub-session + worktree isolation → PARTIAL-GO.**
- Child sessions via `client.session.create({parentID, directory})` run with **fresh
  history** → our independent completeness review. ✅ *Caveat:* issue #8528 (child
  sessions don't execute prompts, v1.1.15+) is marked closed but **must be validated
  on the pinned version** — it's exactly this path.
- Plugin context exposes **`worktree` + `directory`**; sessions take a `directory`
  param → per-worker cwd. ✅
- No first-class pool primitive — cleanest isolation = **one `opencode serve` per
  worktree**. Structured-output (`format: json_schema`) is documented but unverified
  in plugin types → keep a text-parse fallback.

## Supporting facts
- **Embed:** `createOpencode()` spawns+drives in-process (`{client}`) — fits our Bun
  sidecar; headless `opencode serve`, no TUI. Secondary processes use
  `createOpencodeClient({baseUrl})`.
- **Transcript:** `client.event.subscribe()` SSE; `message.updated` /
  `message.part.updated` → render our own worker transcript.
- **Auth:** Grok works headless 3 ways incl. **SuperGrok device-code (subscription)**
  + API key. ✅ Anthropic **Pro/Max subscription PROHIBITED** via opencode → Claude
  needs an API key.

## THE risk: plugin API has no stability contract
Demonstrated **silent breaking removals** (`api.command.*` removed in v1.14.42, no
deprecation/changelog — #26557), type-defined-but-unimplemented hooks (#7006), and
still-evolving idle/turn semantics (#16879/#16626). **Our discipline would live in
this layer.** Mitigation: pin an exact version; a thin adapter shim isolating every
hook/SDK call; a CI smoke test per version exercising (a) `tool.execute.before` veto,
(b) child-session execution, (c) `session.idle` delivery before any upgrade.

## Overall: GO, with a hardened design + pinned version.
collab-as-MCP + collab-as-plugin CAN carry all three pillars today if designed around
the soft spots (host-action completion not permission.ask; veto+detect-push fix loop;
one-serve-per-worktree). The plugin instability is the price of not maintaining a loop.

---

## Recommendation — keep both paths open, de-risk cheaply (don't migrate blind)

The durable invariants are **runtime-agnostic**: our `WorkerAgent` port +
**host-authoritative completion (no model-callable "done")**. That design is IDENTICAL
whether the runtime is our `runLoop` or opencode. So:

1. **Build Phase 1 in our OWN harness now** — extract `runScopedGate`, remove
   `complete_todo` from the model toolset, host drives completion. Cheap, reversible,
   tightens the floor REGARDLESS of the opencode decision.
2. **Run a TIME-BOXED opencode SPIKE behind the `WorkerAgent` port** — an
   `OpenCodeAgent` adapter + a minimal collab plugin — on a PINNED version, validating
   the three must-checks: `tool.execute.before` veto, child-session execution (#8528),
   `session.idle` delivery. One worktree, one todo, end-to-end.
3. **Decide on evidence:** spike green → opencode becomes the multi-provider runtime
   and our bespoke loop stops growing; plugin instability bites → keep our harness +
   add multi-provider model routing (the prior plan). Either way Phase 1 is kept.

Net: the deep dive backs the instinct — opencode + a collab extension is viable and
buys multi-provider + subscription + UI + a maintained loop. The one thing that could
sink it (plugin-API churn) is exactly what a pinned-version spike measures before we
commit. Build Phase 1; spike opencode; let the spike decide.
