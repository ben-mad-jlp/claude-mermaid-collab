# Conductor land authority

**Status:** accepted  
**Date:** 2026-07-09  
**Amends:** constraint a383bc2c  
**Depends on:** G9, G10  
**Direction:** human on 2026-07-09

---

## Context — the conflation being corrected

The conductor is a **role with ownership**. The autonomy level (`auto`, `on`, `build`) is a **user preference** about daemon behavior. These are orthogonal.

- **User preference** (`auto` / `on` / `build`): controls whether the daemon auto-merges without asking the human. This is a daemon setting, not a role boundary.
- **Conductor role**: owns one active mission and its child epics. Ownership is a business relationship between the conductor session and the work; landing authority flows from ownership.

G10 conflated these, treating conductor identity as if it were an autonomy level. This record corrects that distinction: landing authority belongs to the owning conductor role; the user's autonomy choice is orthogonal and governs only auto-answer gates for escalations.

---

## One land proof, three actors

Three different actors may land an epic: the human click (via the UI), the conductor's explicit `land_epic` call (via MCP), and the daemon's auto-land at level `auto` (via the reconciliation loop). All three go through a single `landReadiness(project, epicId)` — no actor gets a weaker proof. The actor determines *authority and audit trail*; the proof determines *safety*. Never trade one for the other.

The contract: all three actors MUST call the same `landReadiness` gate, report a uniform verdict, and record their identity in the commit trailer.

---

## The ownership rule

The conductor MAY land an epic iff **all** of the following hold:

(a) **Ownership** — the epic is a descendant of the conductor's active mission, and that mission's `ownerSession` matches the conductor's session (`mission.active = 1` AND `mission.ownerSession = <session>`).

(b) **Not a bucket** — bucket epics (Inbox, Bugfix Inbox) are organizational roots, hold no convergence work, have no mission and no owner, and are never conductor-landable. They must escalate to the human.

(c) **The [LAND] leaf's deps are satisfied** — the epic's own gate, per constraint a383bc2c. Every epic ends with a human `[LAND]` leaf; its dependencies define closure.

(d) **The proof is green** — all three gates pass:
   - **G9**: every accepted CODE leaf has a commit reachable from the epic tip.
   - **G10**: the project-declared gate runs on the epic branch; branch-red-but-master-green is BLOCKING, branch-red-and-master-red is INHERITED and reported (not blocking).
   - **Dry-merge**: the existing forward-integration and conflict-free merge test.

**Otherwise: escalate to the human.** Never land on a partial proof. Never land another mission's epic. A refusal must be actionable and name the owner (the ownerSession of the mission).

---

## The trap: [LAND] is not a buildable leaf

The function `isHeadlessLeaf` in `src/services/coordinator-live.ts` currently reads:

```typescript
if (todo.assigneeKind === 'human') return false;
if (/^\s*\[(EPIC|GATE)\]/i.test(todo.title ?? '')) return false;
```

The regex excludes `[EPIC]` and `[GATE]` from the headless pool. **`[LAND]` is absent from that regex**, and this is a safety trap.

A `[LAND]` leaf authors no code; its only action is to merge the epic into master — an irreversible git operation. If a `[LAND]` leaf were ever claimed by the headless executor (assigned to `'agent'` instead of `'human'`), it would hand the git merge to a blueprint → implement → review pipeline, collapsing the hand-off boundary that protects the main branch.

**The safety prerequisite:** the `[LAND]` title regex MUST be amended to exclude `[LAND]` alongside `[EPIC]` and `[GATE]`:

```typescript
if (/^\s*\[(EPIC|GATE|LAND)\]/i.test(todo.title ?? '')) return false;
```

This ensures that a `[LAND]` leaf with `assigneeKind: 'agent'` is never headless-claimed, regardless of other conditions. **This is independent of whether the conductor has landing authority** — it is a structural defense: the build pipeline MUST NOT see merge commits.

A sibling code leaf implements this fix and asserts the invariant: *`[LAND]` leaves are never headless-claimed*.

---

## Reconciliation with constraint a383bc2c

Constraint a383bc2c states: "every epic ends with a HUMAN `[LAND]` leaf."

This record **amends** that constraint, not deletes it. The `[LAND]` leaf persists — it is what stops an epic from looking done while stranded on its branch.

What changes is **who may complete that leaf**:

- **Before this record** (implicit): only a human could complete the `[LAND]` leaf, because it was human-assigned.
- **After this record** (explicit rule): the owning conductor, OR a human, may complete the `[LAND]` leaf, iff the conductor has a live owned mission and passes the ownership + proof gates above.

The amendment should be recorded in the constraint store by a sibling leaf, reflecting this expanded but still-gated audience. This document is the authority for that edit.

---

## Attribution of an irreversible action

The land commit records the actor in a trailer:

- **Conductor land:** `Landed-By: conductor:<ownerSessionId>`
- **Human land:** `Landed-By: human`
- **Daemon auto-land:** `Landed-By: daemon:auto`

The same actor is written to the ledger (the todo's `completedBy` or equivalent audit field).

**Rationale:** an irreversible action — a git merge into master — must say who took it. Future human audit, incident response, and rollback decisions all depend on this trail. The actor label ensures accountability and is queryable downstream.

---

## Consequences and non-goals

**Consequence:** a conductor without an active owned mission has **no land authority at all** and must escalate to the human if an epic is ready to land.

**Consequence:** the `[LAND]` leaf title regex is hardened against accidental agent assignment, making the title pattern the safety boundary, not assigneeKind alone.

**Non-goal:** making `[LAND]` leaves agent-assigned by default. This record does not prescribe assigneeKind; it only permits the conductor to land when qualified.

**Non-goal:** changing what `auto` means for the daemon. The autonomy level still controls auto-answer gates for escalations; this record does not alter that dial.

**Open question worth naming:** what happens to conductor land authority when a mission's `ownerSession` dies mid-flight (e.g., the conductor's session crashes or is superseded)? Answer: conductor authority lapses; the epic escalates to the human. The epic remains owned by the dead session, but no live conductor holds authority, so the land falls back to human judgment.

---

## Attribution

Direction from user on 2026-07-09. Ground truth verified in `src/services/coordinator-live.ts`, constraint a383bc2c from the project constraint store.
