# CAD Dogfood — Experiment Design

**Status:** prep (P0) · **Date:** 2026-06-04 · **Owner:** supervisor-firstclass
**Target system under test:** the collab Planner/Coordinator/worker orchestration **and** bsync/build123d (the CAD kernel + solver + connection system).

This is the framing artifact for using the collab setup to build a real CAD model
through bsync. It is written **before** any build so the run is an *experiment* that
produces attributable learning — not just a model that may or may not work.

---

## 1. The build target

A **5-DOF articulated robotic arm with a parallel-jaw gripper, bolted to a fabricated table.**

- Arm chain (open): **J1 base-yaw → J2 shoulder-pitch → J3 elbow-pitch → J4 wrist-pitch → J5 wrist-roll**, all revolute, each motored.
- **Gripper** = a parallel-jaw sub-assembly: two jaws driven by **one** actuator, moving in mirror (a coupled / closed mechanism — `add_transmission` ratio −1, or a 2-bar linkage).
- **Bolted** at every joint flange, the wrist→gripper mount, and the base→table mount — real hole patterns + fasteners via the bsync connection/auto-hardware system.
- Mounted to a **table** (top + legs + apron) via a bolted base flange.

Why this shape: the 5R arm is **open-chain** (lower solver risk) and stresses the
*orchestration* (parallel parts, many bolted interfaces, multi-joint kinematics);
the **gripper quarantines the hardest problem** — coupled/closed-loop motion — into
one named sub-assembly we can de-risk in isolation.

---

## 2. Hypothesis

> The collab Planner/Coordinator can **decompose-and-assemble a multi-part mechanism**
> — authoring parts in parallel and combining them into a constrained, bolted,
> kinematically-correct assembly — **provided the interface contracts (mating datums,
> bolt circles, coordinate frames) are pinned up front as machine-checkable constraints.**

If true, the collab model generalizes from code to spatial/geometry artifacts.
If false, the *where* and *why* of the failure is the finding.

---

## 3. Open questions (what we actually want to learn)

- **Q1 — Acceptance-gate abstraction.** Where does the worker mechanical gate break for a
  **non-code** artifact? `tsc/vitest` is meaningless here; does a geometry gate
  (`validate_geometry` / bbox / DOF / clearance) actually catch empty/wrong parts, or do
  workers still report `accepted` on broken geometry? *(Probed by P1.)*
- **Q2 — Isolation.** Does **session-per-part** isolation hold under parallel authoring, or
  do concurrent workers corrupt a shared geometry kernel session? *(Probed by P4.)*
- **Q3 — Solver / coupled motion.** Can the solver **drive a coupled parallel-jaw gripper**?
  This directly probes the open build123d limitation
  (*"rotation undrivable: no 3D angle primitive… `same_orientation/parallel-3d` crash"*).
  Most likely single point of failure. *(Probed by the gripper spike.)*
- **Q4 — Interface contracts.** Do parts authored by **different workers** actually mate, or
  does coordinate-frame drift require manual alignment at assembly time? *(Probed by P5.)*
- **Q5 — Decomposition.** Can CAD todos be right-sized, or does a parametric part with
  flanges + bolt patterns blow a worker's context?

---

## 4. Metrics (captured during the run)

Capture requires **P2 (friction-note persistence)** — without it most of these are unknowable.

| Metric | How captured |
|---|---|
| % parts passing a **real** geometry gate (not just script-runs) | P1 gate result per part todo |
| **Failure attribution split**: collab-layer vs bsync-layer | P2 friction notes, categorized |
| # escalations raised (worker couldn't make geometry valid) | escalation log |
| Retry count per todo + *whether* retry was contamination vs real | P2 + DOGFOOD #5 awareness |
| Did the **success oracle** pass (§5) | final assembly checks |
| Wall-clock per wave; cold-start cost on first CAD todo per lane | timestamps + P2 |

---

## 5. Success oracle (the grading rubric — defined up front)

The finished artifact **passes** iff **all** hold:

1. **DOF:** `analyze_dof` on the assembly = **5 free DOF for the arm** (pre-grounding base) **+ 1 actuated gripper** (2 jaws coupled to one driver). No more, no fewer.
2. **Bolted joints:** every declared bolted interface (5 joint flanges + wrist→gripper + base→table = **7**) is **baked** with real holes **and** fasteners present in the geometry.
3. **Clearance:** `check_clearance` reports **zero interference** at the home pose, through the **arm sweep**, and through **jaw closure**.
4. **Validity:** `validate_geometry` passes on every part and the assembly (no empty bodies, no invalid solids).
5. **Export:** the assembly exports to a **valid STEP**, and a **cut-list/BOM** is generated.
6. **Envelope:** final bounding box within a declared target envelope (set in Epic 0 of the build plan).

A run that produces a plausible-looking arm but **fails any** of these is a *failure with a finding*, not a success.

---

## 6. De-risk first: the 3-spike wave (the first real wave)

Before fanning out the full build, run three tiny isolated spikes so the likeliest
failures surface **early and cheap**. Order by risk:

1. **Gripper-coupling spike** *(highest risk → first)*: two jaws + one actuator,
   `add_transmission` (ratio −1) or a 2-bar linkage; drive open→closed. **Directly tests Q3.**
   If coupled motion can't be driven, we've found the headline solver problem in ~15 min.
2. **One motored revolute joint:** two links, concentric + planar, add a motor, `sweep_motor`.
   Confirms open-chain joint driving works (the arm's basic primitive).
3. **One bolted connection:** two plates, `add_connection` → accept → `bake`; confirm real
   holes **and** fasteners appear. Confirms the auto-hardware fidelity (Q4-adjacent).

**Gate:** all three spikes pass → fan out the full build. Any spike fails → that *is* the
finding for this run; capture it and stop (or scope down) rather than building on sand.

---

## 7. Prep dependencies (the floor before run 1)

This experiment is only worthwhile with the prep scaffolding in place:

- **P1 — CAD acceptance gate** (must-have): geometry gate for `type:cad` todos. → Q1
- **P2 — friction-note persistence** (must-have): attribution. → all metrics
- **P4 — session isolation decision** (must-decide): isolate, or scope run 1 **sequential**. → Q2
- **P0 — this doc.**
- *Enhancements (add when run 1 demands):* **P3** cad/ocp profile (context), **P5** machine-checkable interface contract.

**Minimum viable floor for a worthwhile run 1: P0 + P1 + P2 + P4-as-sequential.**
Deliberately the floor, not the ceiling — over-instrumenting means we only find the problems
we anticipated. The unanticipated failures are the payoff.

---

## 8. Provenance

Generated by the collab dogfooding session that built the build123d UI-parity work
(2026-06-04). The prep items map to findings filed that day:
DOGFOOD #2 (profiles carry context + gate), #4 (friction persistence), #5 (worker isolation).
The CAD dogfood is the forcing function that justifies building them.
