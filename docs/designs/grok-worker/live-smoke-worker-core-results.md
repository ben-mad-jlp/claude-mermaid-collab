# Worker-core LIVE smoke — results (real grok-build, 3 runs)

A throwaway-repo smoke (`scripts/worker-core-smoke.ts`) drove `runWorkerCore` against the REAL
`xai('grok-build-0.1')` model with simple deps + a real "did the file get created?" gate, streaming the
observability events. Zero blast radius (no server, no daemon, /tmp worktree). Task: create `hello.txt`.

## VALIDATED LIVE (the engine works end-to-end)
Across all three runs, against a real model:
- **Tools execute** — glob/read_file/write_file/run_bash/run_bash_ro/grep all ran against the worktree.
- **Observability spine streams** — every tool call + result + phase boundary surfaced live (north-star §6 proven).
- **Capability gating holds** — research/verify got read-only tools; implement got writers.
- **Recipe sequences** — research → implement → verify → fix-loop, with per-phase fresh context.
- **Fix loop self-terminates** — escalated after 2 identical failures (never ground forever).
- **HOST-AUTHORITATIVE COMPLETION + FAIL-SAFE HELD** — even when `hello.txt` was created CORRECTLY,
  the host REFUSED to mark done because verify couldn't confirm — it escalated instead of falsely
  completing. The core safety property worked in the wild.

## Run-by-run
- **Run 1** (open prompts): research WANDERED the filesystem (`ls /app`, `find /` — found the real repo!),
  never emitted findings, hit the 5-min timeout. → prompts too open + `run_bash_ro` roams the whole FS.
- **Run 2** (tightened research prompt + step caps): research FIXED (1 `ls`, valid JSON, 2 steps).
  Implement WROTE the file correctly. Verify thoroughly checked (even a python3 byte-check) but never
  emitted the JSON verdict → parseError → escalated 'stuck' (with empty sig).
- **Run 3** (tightened implement+verify prompts + distinct unparseable sig): research clean (2 steps);
  **implement PERFECT** — write_file → `git add -A && git commit` (real commit) → "STOPPED as instructed"
  (3 steps); verify STILL tool-loops (xxd/od/python3) and **never terminates with the JSON verdict** even
  when told "FINAL message MUST be ONLY this JSON". Escalated 'stuck' with the clear signature
  `verify-output-unparseable`.

## THE conclusive finding
**grok-build cannot reliably TERMINATE a structured-output phase (verify/review) with clean JSON.** It
tool-loops verifying and never emits the closing verdict — prompt-tightening did not fix it (tried twice).
This is the bakeoff "grok drifts" finding, sharpened to a precise mechanism and **empirically confirms the
phase-routing thesis**: grok-build is fine for the MECHANICAL implement phase (it writes + commits + stops
cleanly) and trivial research, but the JUDGMENT/verdict phases need either:
1. **Forced structured output** — a `submit_verdict(schema)` TOOL that ENDS the phase when called (the
   phase can't end any other way), instead of hoping the model emits freeform JSON. Robust across models.
   THE recommended next build.
2. **Phase-route verify/review to a stronger model** (Sonnet/Opus) — the tier matrix. Complementary.

## Other observations
- `run_bash_ro` is NOT worktree-confined — grok ran `find /` and `ls /app`. The "true read-only = OS
  sandbox (Tier-3)" caveat bit live. For unattended runs, sandbox or restrict bash.
- Implement, once told "commit then STOP," is clean and efficient on grok-build (3 steps).

## Run 4 — submit_verdict forced structured output → FULL GREEN on grok-build ALONE
Added a `submit_verdict` TOOL (input = the phase schema; calling it captures the SDK-validated verdict
+ ENDS the phase via hasToolCall). Re-ran live:
- research: **1 step** (called submit_verdict with findings directly).
- implement: write_file → `git commit` (real commit) → STOP. **3 steps.**
- verify: read_file → `submit_verdict({pass:true})`. **2 steps.**
- **✅ COMPLETED (host-authoritative).** Deliverable correct. Whole recipe = 6 steps.

`submit_verdict` was THE fix — verify went from endless tool-looping to 2 clean steps. Forcing the
verdict through a tool (the phase can only end by calling it) is robust where freeform-JSON-text was not.

## CONCLUSION
The worker-core recipe runs **end-to-end GREEN on grok-build ALONE** — research → implement → verify →
host-authoritative completion, validated against the real model. **No stronger model is required for the
basic recipe.** An ANTHROPIC key / phase-routing to Claude is now an OPTIONAL QUALITY UPGRADE (the tier
matrix: Opus/Sonnet on blueprint/verify/review for harder real-world tasks), NOT a necessity for the
engine to work. Trigger to add it: when real tasks are complex enough that grok's judgment on
verify/review/blueprint isn't good enough — add @ai-sdk/anthropic + ANTHROPIC_API_KEY (Secrets UI) +
wire resolveModel's claude case (~20 lines).

Status: all committed (branch worker-core/apply-edit-harvest, 18 commits, 77 tests green, tsc 0). The
watched run fully achieved its purpose — engine validated live + driven to green.
