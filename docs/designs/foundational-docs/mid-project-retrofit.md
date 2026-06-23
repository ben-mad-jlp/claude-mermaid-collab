# Mid-Project Retrofit — Synthesis

Round 2: what if you're starting this in the middle of a living project (mermaid-collab itself being the motivating case)? Agent + Grok again, independently. The convergence this round is even stronger than round 1.

## The Big Shift

**The mirror becomes the main move, not the contrarian one.**

Both sources independently said: the "foundational docs + decision ledger + pre-flight diff" proposals from round 1 quietly assumed you could still touch original intent before drift calcified. At v5.60.1, that ship sailed years ago. Trying to excavate the "original spec" of a codebase that's already the accumulation of thousands of drifted decisions is **archaeology with a heavy dose of fiction**.

- **Agent:** *"You are not trying to recover original intent, because original intent was never a single coherent thing in the first place. What you actually want to recover is the small set of decisions that are currently load-bearing. Stop trying to excavate history. Start tagging the present."*
- **Grok:** *"The mirror approach I floated last time is no longer contrarian here; it becomes the primary practical move. You cannot bootstrap a clean spec retroactively without doing violence to reality."*

## The Reverse-Engineering Problem

There is no reliable *automatic* technique. Git history is noise. Author recollection has been edited by subsequent pain. Static analysis sees coupling but not intent. Both converged on roughly the same approach, from different framings:

**Agent — Counterfactual probing:** Walk a module and ask "If I removed/inverted this, what would notice?" The answers cluster:
- Breaks loudly (tests, callers, user-visible) → **load-bearing**
- Breaks quietly (assumptions in three other files) → **load-bearing but hidden**
- Breaks nothing → **accidental drift candidate**

This is mechanical, doesn't require the human to remember anything, and surfaces actual coupling structure rather than imagined structure.

**Grok — Live annotation of a "Current Reality Mirror":** The AI reads a module, emits a terse non-judgmental description of what the code actually does and what invariants it enforces. The human spends ~15 minutes reacting in real time, tagging in categories. *The signal is not in the code; it's in the human's micro-reactions and willingness to spend political capital defending something.*

They're complementary: counterfactual probing surfaces *candidates*, live annotation sorts them.

## Tagging — The Convergent Schema

Both sources independently reached for the same 3–4 category system. I'm merging them:

| Tag | Meaning | Future sessions should... |
|---|---|---|
| **load-bearing / defended** | Verified by probe and human confirms, has dependents | Defend — amend only with explicit ledger entry |
| **observed** | This is what the code does, status unknown | Not defend — treat as inert substrate |
| **tolerated / suspect** | Works but would change if cheap, looks accidental | Flag for review, never crystallize |
| **regret / embarrassing** | Known wrong, kept for compatibility | Explicitly NOT defend — do not let future sessions inherit this as invariant |

The important move: **refuse to produce a single artifact called "the spec."** Every retroactive entry carries its epistemic status. A future session reading the ledger sees *"the rules AND their certainty level"* — not "the rules." `observed` and `suspect` entries explicitly *do not* get defended. Compass, not courtroom, again.

## The Canonizing-Drift Failure Mode

The scariest retrofit failure: you run one big excavation session, write down what the code currently does, call it the foundational spec — and every accidental local minimum becomes sacred text. Future sessions defend bugs.

Both sources pointed at the same antidote:

1. **Never produce a monolithic spec.** Tags only. Status-bearing entries only.
2. **Keep the artifact alive and tied to recency.** Grok: *"decisions age out unless actively re-defended in later sessions."* Entries decay if untouched, so stale canon doesn't accumulate.
3. **Stale entries are themselves a signal.** Agent: when the ledger says X and the code says Y, *the code wins by default* and the ledger gets a `stale` tag. Concentrations of stale entries are where mental model has drifted farthest from reality — that's where the next nasty bug is hiding.

## The Ledger Cold-Start — Solved

Don't try to backfill history. **Today is day zero of the ledger.** Pre-existing code is read-only substrate until it's touched. New entries written only when something is *touched* or *questioned*.

Agent called it **touch-triggered excavation**, Grok called it **attention-flow-driven growth**. Same mechanism, same beautiful property: *the ledger grows exactly where attention is actually being paid. Dead code stays undocumented because nobody cares.*

Combined with a **floor-mark with an asymmetry rule** (Agent): "everything before commit X is unrecorded. Pre-floor code is `observed` only until something touches it, at which point the touching session must promote the relevant pieces to `load-bearing`, `tolerated`, or `regret` before changing them." This forces excavation exactly when it pays for itself and never when it doesn't.

## Truth Inversion

Clean-slate: spec wins, code is the projection.
Mid-project: **code wins by default, but every win is logged.**

This inverts the Spec Diff Arena. Instead of *spec vs. implementation*, it becomes *Current Reality vs. Current Hypothesis*:

> "Here is what the code actually does when we probe it. Here is what you just said you want. The delta is X."

That delta is where the real conversation happens. The Vibe Anchor also mutates — it stops trying to channel some pristine original voice (there isn't one) and instead forces the model to speak in the voice of *"the project as it has actually evolved."* The human's correction becomes the ledger entry.

## Concrete Week One on mermaid-collab

Both sources gave concrete sequences. Merging them:

### Session 1 — Seed probe (90 min)
Pick the 3 files you've most recently regretted touching (or the 3 you're most afraid to touch — same signal). For each, run counterfactual probes. The AI emits a Current Reality Mirror for the file. You tag ~5–15 entries per file in 15-minute bursts. **Total seed ledger: ~30 entries.**

### Session 2 — "What surprises you?" pass (45 min)
Run on `src/mcp/server.ts` and one UI module. Tag surprises. **First real value shows up here** — usually a *"wait, we've been defending that?"* moment that collapses a long-standing local hack. Grok's estimate: a discovery like "three Tolerated behaviors that have been causing support tickets for 18 months."

### Session 3 — Floor-mark (30 min)
Set the stake at current HEAD. From now on, any new session touching a file reads the ledger entries for that file and must confirm, contradict, or extend them as part of preflight. **No retroactive excavation beyond what the seed already covered.**

### Week 2–3 — Normal work with the ledger live
As decisions get revisited during normal work, you append. Re-run the mirror periodically on the same module — drift between previous mirror and current mirror becomes visible. *Only the `load-bearing` entries slowly crystallize into something that resembles a spec.* The rest stays in `tolerated` until someone has energy to fix it.

### Ongoing — Forked Evolution as escape hatch
For major refactors, explicitly fork the relevant ledger entries into Before/After. This is how you escape canonized drift without pretending the old decisions were never made.

## What This Accepts

Both sources were explicit: **most of the codebase will remain undocumented legacy with occasional illuminated patches.** That's the honest state of every mature project. The mirror doesn't solve intent being a moving target — it just makes the current position of the target legible before you shoot.

You're not trying to save everything. You're trying to stop *adding* to the pile.

## Questions You Should Answer

1. **What's your tolerance for the ledger being wrong?** If a `load-bearing` tag turns out incorrect six weeks later, is that a failure or expected churn? This determines whether tags are sticky or cheap. (Agent's question.)
2. **Who is the reconciliation ritual *for* — you or the next session?** If for you: terse and visual. If for the next AI session: machine-parseable. Trying to be both produces neither. (Agent's question.)
3. **Is there a file in mermaid-collab you'd be willing to sacrifice as the pilot** — somewhere you'd accept "the experiment made this worse" as a cost? Without a designated pilot, the retrofit will get blocked the first time the ledger contradicts your gut, and you'll quietly stop using it. (Agent's question — this one feels especially sharp to me.)

## My Read

The convergence between the two sources is unusually tight on this round, which makes me more confident than usual in the synthesis. **Don't write a foundational spec for mermaid-collab. Build the mirror infrastructure and let the ledger grow from attention.** Specifically:

1. **A Current Reality Mirror skill** — reads a bounded scope, emits a non-judgmental "here's what this code believes" summary, prompts for tagging.
2. **The ledger as tagged entries, not prose** — `file:line` or `module` scope, one of the four tags, short rationale, date.
3. **Touch-triggered excavation** — any session that writes to a file first reads/extends that file's ledger entries.
4. **Floor-mark at HEAD today.** Everything below is `observed`. Promotion only happens on touch.

The one concrete thing to prototype first is probably the Current Reality Mirror — if that produces a single *"wait, we've been defending that?"* moment in week one, you've proven the mechanism and earned the rest of the scaffolding.