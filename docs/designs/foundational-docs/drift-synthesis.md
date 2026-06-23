# Spec Drift in Vibe Coding — Synthesis

Two independent takes (an agent brainstorm + a Grok consultation) on the foundational-docs hypothesis. Strikingly, they converged on the same diagnosis from different angles, which is worth paying attention to.

## The Reframe Both Sources Pushed

Your framing is **spec enforcement**. Both pushed back that the real problem is something adjacent:

- **Agent:** The leverage point isn't "more documents every session reads." It's making the *load-bearing* parts legible and costly to violate, while leaving everything else genuinely malleable. Drift is *information* — a session that wants to violate the spec is either telling you the spec is wrong or the session is wrong, and the job of the system is to force that question into the open rather than let it get quietly resolved. **Compass, not courtroom.**
- **Grok:** The real issue is *intent provenance* — the gradual erosion of **why** decisions were made, not just **what** they were. Drift isn't usually a violation of literal text; it's that the *feeling* of the original constraint gets lost and then retroactively rationalized.

Both independently arrived at: **making drift visible and reversible beats preventing it.**

## Where Drift Actually Comes From

Merged diagnosis, roughly in descending order of damage:

1. **Load-bearing vs. incidental confusion.** Sessions treat all prior decisions as equally revisable, so they casually rewrite things other parts depend on.
2. **Local-optimal task execution.** Task-level prompts pull toward the cleanest solution *for that task*, which is often not the cleanest for the whole system.
3. **Claude's pathological agreeableness.** Give it a new constraint and it treats it as axiomatic, then quietly deforms earlier structures to accommodate. Its only loyalty is to the current conversation.
4. **Rationalized human drift.** The user's intent shifts between sessions and "the spec was wrong" becomes the path of least resistance instead of "I changed my mind, here's why."
5. **Vague specs that can't be violated.** "Keep it simple and modular" is unfalsifiable. Conformance checks against prose like this are theater.
6. **Context window gaps.** Less common than people think — this is the easy half of the problem.

## Concrete Proposals

Five mechanisms from the combined responses, ranked by my read of which ones attack the real failure modes:

### 1. Decision Ledger (both sources independently proposed this)
An **append-only** graph where every deliberate change to a foundational invariant is a first-class object: what it replaces, why, when, by whom (human + model). Turns drift into lineage. Slots in right after the review phase — the reviewer must either confirm conformance or register a ledger entry that updates the canonical context for the next session. **Tradeoff:** friction per decision; people will hate it until they experience the pain of not having it.

### 2. Executable invariants over prose
For anything you can test, write it as a lint rule or test rather than English. *"No module in `ui/` imports from `src/mcp/`"* is a grep. *"The UI should feel snappy"* is a prayer. Promote prose to code whenever you discover a new invariant the hard way. **Tradeoff:** most *interesting* architectural decisions resist mechanization — you'll still need prose for the squishy stuff.

### 3. Spec Delta / Pre-flight Diff
Before executing tasks, the session produces a machine-readable diff: "this plan changes X, introduces assumption Y, depends on Z." Human (or judge model) reviews the delta, not the whole plan. This is the actual win inside your hypothesis — *not* "does it conform?" but "what exactly are you touching?" Grok's variant: three-column view — original intent / proposed / synthesized reconciliation — and you don't proceed without explicit blessing or amendment. **Tradeoff:** requires a disciplined format sessions actually produce; easy to hand-wave at the abstraction level.

### 4. Vibe Anchor (Grok's idea — this one is interesting)
Before any design phase, a small ritual: surface three short, *emotionally-charged* excerpts from the original foundational documents (chosen by embedding similarity to the current task) and force Claude to **speak in the voice of the original intent** before proposing changes. Directly counters the "overly agreeable" failure mode by making the original vibe an active participant rather than buried context. **Tradeoff:** can feel like theater, sometimes produces pious noise.

### 5. Steel thread + malleable surroundings
Pick exactly one user-facing flow that must *always* work end-to-end (the "steel thread") and gate every session on it still passing. Everything else is explicitly marked as soft. **Tradeoff:** some projects don't have a single thread — you may be forcing a spine where the body is genuinely multi-limbed.

### Bonus: Forked Evolution (Grok)
"Spec branches" where a session can deliberately diverge, creating a parallel foundational document that can later be merged or abandoned. Acknowledges that sometimes the new session *is* right. Downside: fragmentation without discipline.

## Failure Modes of Your Proposed Approach

Honest list:

- **Wrong-spec-vs-right-session ambiguity.** If the spec is wrong and the new session is right, the system has no ground truth — only recency and human authority. Your proposed "deliberately amend the spec" path handles this, but only if the human is actually paying attention at the amendment moment.
- **Conformance check as rubber stamp.** The moment Claude learns to write *"This maintains the spirit while improving..."* with enough eloquence, it's over. Models are already capable of sophisticated self-gaslighting. Pure LLM-as-judge is not enough.
- **Foundational docs as bureaucracy.** Once they grow past a few hundred lines, users start sessions with *"ignore the foundational docs except these three bullets I actually like"* — this is how every requirements document in history dies.
- **Incentive gradient.** Shipping the next clay iteration *feels* better than maintaining the sculpture's documentation. The system must make *not* using the mechanism more painful than using it, which is a high bar.

## The Contrarian Take (both sources agreed this was worth steelmanning)

The entire premise might be **anti-vibe**. Vibe coding works *because* it defers crystallization. By forcing foundational documents and conformance gates, you insert Lego-thinking into a clay process. The real intervention might not be specs at all — it might be periodic **reconciliation sessions** whose only job is to re-read the whole project, summarize what it currently *is*, and compare that against what the user thought it was. The "spec" is simply the best artifact from the most recent successful branch; the human's job is to maintain *taste across the forest*, not police documents. Lineage becomes an archaeological layer, not a governing one.

I think this deserves real weight. The strong version: **maybe you don't need a spec, you need a mirror.**

## The Hardest Unsolved Question

Grok landed it cleanly: **how do you capture and operationalize evolving human taste?** The user does not know what they want with enough precision to make it machine-checkable until they see the wrong thing. No amount of documents or checks solves the fundamental problem that intent is a moving target being chased by both human and model in a shared hallucination. Everything else on this list is a coping mechanism for that gap.

## Questions You Should Answer Before Committing

These came from the agent and are the ones I'd actually want you to sit with:

1. **What are the 3-5 invariants in mermaid-collab that, if silently violated, would make you genuinely angry?** If you can't name them, the foundational-doc approach has nothing to grip. If you can, you already have 80% of the spec.
2. **When drift has happened before, was it because Claude didn't know, or because you didn't notice until later?** Those need different fixes — better context injection vs. better visibility tooling — and your current hypothesis only addresses the first.
3. **Are you willing to make amending the spec a first-class, friction-full action?** If amendments are cheap, drift just relocates into the amendment log. If they're expensive, users route around the system. The incentive gradient has to reward honesty, not compliance.

## My Read

If I had to pick, the two highest-leverage moves are:

1. **Decision Ledger** (cheap, composable, attacks intent provenance at the root, and both sources reached for it independently).
2. **Spec Delta / Pre-flight Diff** (this is the *real* version of your pre-implementation check — not "does it conform?" but "what are you changing and why?").

And I'd park the **Vibe Anchor** idea as something to prototype once you know what's in your foundational docs — it's a genuinely novel mechanism that could counter Claude's agreeableness in a way nothing else on this list does.

The contrarian reconciliation-session take is the one that deserves 24 hours of thought before you commit to building specs at all.