# Claude Code batteries to rebuild into the in-process daemon worker

We're moving the worker off the Claude CLI to an in-process daemon harness for ALL providers
(see `design-northstar-worker-fabric` §3). That gives up Claude Code's batteries. This is the
prioritized list of which to rebuild — keeping what the daemon already does BETTER. Goal: not clone
Claude Code, but rebuild its LOAD-BEARING parts + own the interception point so the worker is better
than the CLI for our needs (gate + observability + policy).

## Tier 1 — the quality floor (without these the worker writes worse code)
1. **Real edit/search tools** — replace GrokOwnHarness's primitive write_file/read_file/run_bash.
   The single biggest quality win; some bakeoff drift is plausibly primitive-tooling drift.
   - `Edit` — exact string-replace + uniqueness check + must-read-before-edit. (vs whole-file write)
   - `Grep` (ripgrep-backed, structured) + `Glob` (fast find) — not shelling out via run_bash.
   - `Read` — offset/limit + line numbers (cat -n).
2. **Per-phase tool capability model** (Claude Code runtimeMode/allowed-tools). Each phase gets only
   its tools: research/verify = read-only (Read/Grep/Glob); implement = +Edit/Write/Bash. Enforces the
   discipline STRUCTURALLY, not by prompt.

## Tier 2 — the SPINE (one mechanism → three requirements)
3. **Pre/post-tool interception layer** (Claude Code hooks). Highest leverage: ONE mechanism delivers
   three things we already require —
   - **Host-authoritative gate** — intercept + VETO a tool call (the opencode tool.execute.before
     throw); the model has no "done" tool, the host marks done after the gate.
   - **Observability (§6)** — log every tool call/result/COST at the interception point → the live
     transcript + model-call ledger fall out here.
   - **Policy** — enforce the per-phase capability model (Tier 1.2).
   Building this is what makes the in-process worker BETTER than the CLI — we own the interception.

## Tier 3 — reach & economics
4. **MCP client in the worker** — Claude Code's tools come from MCP servers; make the worker an MCP
   client so it gets collab's MCP + any server (browser, etc.) for free, vs hand-wiring 5 tools.
5. **Prompt caching** — with fresh-context-per-phase the system prompt + repo context repeat; cache
   them. Real cost/latency lever across thousands of autonomous calls.
6. **Bash sandboxing** — Claude Code sandboxes bash; grok harness only guards `cd`. For UNATTENDED
   workers at scale, filesystem/network sandboxing is a real safety lever (matters most at high
   autonomy level).
7. **Robust cross-provider retry/backoff** — rate limits + transient errors; partially there
   (isRateLimitError), needs to be general across providers.

## Tier 4 — discipline delivery
8. **A "playbook" mechanism** (Claude Code skills / progressive disclosure). Don't hardcode the phase
   discipline — load reusable per-task-type modules (CAD vs UI differ), ideally the SAME source the
   human-facing skills use → one source of truth. = the "skill-as-compiled-playbook" design concept.

## Do NOT rebuild — we already do it better
- `TodoWrite` → the persistent WORK-GRAPH (durable, dependency-aware) is superior.
- Session/checkpoint memory → collab + the work-graph are the per-todo source of truth.
- Context compaction → fresh-context-per-phase largely REMOVES the need; just need per-phase
  step/token caps, not mid-session summarization.

## Priority through-line
Tier 1.1 (real edit tools) = the quality floor. Tier 2.3 (interception layer) = the spine that makes
the gate + observability + policy all fall out of ONE mechanism, and is where the in-process worker
beats the CLI. Build those two first; the rest layers on.

Note: keep the steering/interrupt seam we already have (GrokOwnHarness prepareStep inject queue) — it's
Claude Code's mid-session injection, already present; don't lose it in the rebuild.

---

## Reuse strategy — HARVEST opencode, don't rebuild from scratch

Decision: vendor specific MIT-licensed opencode source + read-to-learn, rather than write every battery
from scratch. This is a DIFFERENT relationship from "embed opencode as a runtime" (rejected earlier for
plugin-API churn) — and it sidesteps that whole risk:
- **Vendoring ≠ depending.** We lift a SNAPSHOT, OWN it; opencode's release cadence is irrelevant. MIT
  permits it. The earlier objection (weekly breaking plugin-API changes = our compat burden) does NOT
  apply to copied source.
- **Same stack** — TS/Bun + Vercel AI SDK + Zod tools → lifted code drops in with minimal translation.
- **Best OPEN reference available** — we CANNOT copy from Claude Code (closed); opencode is the open
  analogue of exactly these batteries.

### Rough reuse fit (to confirm via the survey)
| Battery | Likely fit |
|---|---|
| Tier 1 Edit/Grep/Glob/Read tools | MOST liftable (esp. the exact-match edit algorithm — edge-case-heavy, don't rewrite) |
| Tier 3 MCP client / bash sandbox / prompt-cache / retry | Liftable — standard infra |
| Tier 2 interception spine (gate+observability+policy) | READ-AND-OWN — tailored to our gate/ledger |
| Agent loop | We already have GrokOwnHarness — compare, don't replace |

### Discipline that keeps harvesting clean
1. Per-module COUPLING check — lift only what extracts without dragging opencode's session/permission
   types; some modules (ripgrep wrapper, diff algorithm) are standalone, others entangled.
2. MIT ATTRIBUTION + a `VENDOR.md` provenance record (what / from where / which commit) → auditable,
   re-syncable.
3. Accept we FORGO their future fixes — vendoring freezes a snapshot; re-sync is an OWNED decision.

### opencode now has TWO possible relationships (keep them distinct)
- (a) Runtime adapter behind the WorkerAgent port — GATED on a pinned spike, plugin-API churn risk
  (see `research-opencode-plugin-feasibility`). Decide only if a non-Anthropic phase is wanted.
- (b) SOURCE to harvest — vendor MIT modules, own them, no churn. LOWER risk, likely higher near-term
  value for the batteries. This section is (b).

### Survey output (per-battery build-vs-harvest plan)
See the survey results doc `research-opencode-harvest-survey` — maps each battery → extraction
feasibility (clean-lift / lift-with-coupling / read-only reference / write-fresh) with file pointers.
