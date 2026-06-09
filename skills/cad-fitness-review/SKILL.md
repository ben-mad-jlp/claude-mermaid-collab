---
name: cad-fitness-review
description: Post-build fitness/design-review gate for CAD mechanisms — a JUDGMENT gate where a vision-capable judge SEES a render of the artifact (plus the quantitative facts the eye can't read) and decides "is this actually a GOOD <thing>?" against a domain fitness rubric. Distinct from and complementary to the mechanical gate (validate_geometry / analyze_dof / check_clearance). A degenerate-but-valid result is FLAGGED → redesign/escalate, never silently accepted. Use after a CAD build to catch the failures the mechanical gate is blind to (folded poses, ground/table collisions, coaxial/degenerate axes, a gripper that doesn't oppose).
user-invocable: true
allowed-tools: Read, Grep, Glob, Bash, ToolSearch, mcp__plugin_mermaid-collab_mermaid__*
---

# CAD Fitness Review

A **judgment gate** that runs *after* a CAD build to answer the question the mechanical
gate cannot: **"is this actually a GOOD mechanism?"** — not "does this solid exist?"

It is to a CAD build what the bug/completeness review (`vibe-review`) is to a code build:
a second, qualitatively different gate that runs after the mechanical one. The mechanical
gate (`validate_geometry` / `analyze_dof` / `check_clearance`) proves the geometry is
**valid, has the right DOF, and doesn't interfere**. None of that proves the mechanism
**works for its purpose**. A robot arm can be valid geometry, have exactly 5 DOF, and pass
clearance — yet be folded back on itself, have every joint on the same axis (no workspace),
or have its elbow below the tabletop. Those are *fitness* failures, and only an
**engineering-literate judge that SEES the artifact** catches them.

## Why this exists (the gap it closes)

From CAD-arm RUN 2 (2026-06-04) — the gate caught two defects the mechanical gate passed:

1. **Folded pose** — the whole arm folded back on itself. Valid geometry, right DOF,
   clearance passes. Visible *only* in a render.
2. **Inverted pitch sign** — put the elbow at `z = -87`, **below the tabletop** (a table
   collision the assembly-level clearance check didn't model). Caught by **printing joint
   heights + min-Z**, which the eye/judge then flags.

And from RUN 1 — the **coaxial-arm failure**: all joints shared an axis, so the arm had no
workspace and the gripper didn't oppose the approach. Every interface matched; the
mechanical gate was green. A fitness judge that sees "all axes parallel" rejects it
immediately.

**Acceptance oracle for this gate itself:** feed the RUN-1 coaxial render + facts → the
judge returns **FAIL** with specifics (all axes parallel → no workspace; gripper doesn't
oppose). Feed the RUN-2 render + facts → **PASS**. A gate that passes the coaxial arm is
broken.

## The shape (two halves: produce the evidence, then judge it)

```
   BUILD (parts→assembly, posed via FK)
        │
   ┌────▼─────────────── MECHANICAL GATE ───────────────┐
   │ validate_geometry · analyze_dof · check_clearance  │   ← part exists, DOF right, no interference
   └────┬───────────────────────────────────────────────┘
        │ (green — but blind to fitness)
   ┌────▼──────────────── FITNESS GATE (this skill) ─────┐
   │ 1. RENDER  — offline iso + side-elevation wireframe │   ← the judge's eyes
   │ 2. FACTS   — per-joint XYZ, end-effector, min-Z     │   ← what the eye can't read
   │ 3. JUDGE   — vision model vs the domain rubric      │   ← "is this GOOD?"
   └────┬───────────────────────────────────────────────┘
        │
   PASS → done   ·   FAIL → flag → redesign / escalate (never silently accept)
```

## Step 1 — Produce the RENDER (the judge's eyes)

`capture_view` needs a **live OCP viewer** and is **unreliable headless** — do not depend on
it in an automated gate. The **reliable** path proven in RUN 2 is an **offline wireframe
render inside `run_script`**: project every edge of the assembly through a rotation matrix
and `matplotlib.savefig`. Render **two** views:

- **Isometric** (`az`/`el` set for a 3/4 view) — overall form and proportion.
- **Side elevation in the reach plane** (`az = 0, el = 0` → a true XZ elevation) — **this is
  the view that exposes pose/articulation defects** (folding, an elbow under the table). Do
  not skip it; the iso alone hides in-plane defects.

**Color the subject distinctly from its context** so the judge can separate them — e.g. the
arm dark blue, the table/ground grey.

Skeleton of the offline render (adapt verb names to the live bsync/build123d API — ToolSearch
the CAD verbs first):

```python
# inside run_script — no live viewer needed
import numpy as np, matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

def rot(az_deg, el_deg):
    az, el = np.radians(az_deg), np.radians(el_deg)
    Rz = np.array([[ np.cos(az),-np.sin(az),0],[np.sin(az),np.cos(az),0],[0,0,1]])
    Rx = np.array([[1,0,0],[0,np.cos(el),-np.sin(el)],[0,np.sin(el),np.cos(el)]])
    return Rx @ Rz

def project_edges(edges, R):                 # edges: list of (p0, p1) in world coords
    return [((R @ np.asarray(a))[:2], (R @ np.asarray(b))[:2]) for a, b in edges]

def render(edges_by_part, R, path, colors):  # edges_by_part: {part_name: [(p0,p1), ...]}
    fig, ax = plt.subplots(figsize=(6, 6)); ax.set_aspect("equal"); ax.axis("off")
    for name, edges in edges_by_part.items():
        for a, b in project_edges(edges, R):
            ax.plot([a[0], b[0]], [a[1], b[1]], color=colors.get(name, "k"), lw=1)
    fig.savefig(path, dpi=120, bbox_inches="tight"); plt.close(fig)

COLORS = {"arm": "#1f3a93", "table": "#888888", "ground": "#bbbbbb"}
render(edges_by_part, rot(35, 25), "/tmp/fit_iso.png",  COLORS)   # isometric
render(edges_by_part, rot(0,   0), "/tmp/fit_side.png", COLORS)   # XZ side elevation
```

Save the two PNGs to the session images folder (`.collab/sessions/<session>/images/`) so the
judge — and a human — can open them.

## Step 2 — Print the FACTS (what the eye can't judge)

The render shows *form*; numbers catch what a 2D projection hides. In the same `run_script`,
**print** (and capture into the judge prompt):

- **Per-joint world XYZ** for the posed assembly (the kinematic chain in space).
- **End-effector position** (and approach-axis direction).
- **min-Z of every body vs the ground/table plane** — the explicit collision check. A
  negative min-Z (a link below the tabletop) is the RUN-2 inverted-pitch failure; it is
  *invisible* in an iso render and only obvious from this number.
- **Joint-axis directions** (unit vectors) — so "all axes parallel/coaxial" is a checkable
  fact, not a visual guess (the RUN-1 failure).

Treat **`capture_view`/offline-render + these prints as INFRASTRUCTURE — the judge's input**,
not show-and-tell. The point is to *feed the judge*, not to produce a pretty picture.

## Step 3 — JUDGE against the domain fitness rubric (vision)

Call a **vision-capable** judge with **both** the rendered images (iso + side) **and** the
printed facts. The judge is engineering-literate and skeptical; its job is to decide **"is
this a good <thing>?"** and, on any failure, name the specific defect.

### Fitness rubric — robot arm (generalize per domain)

- **Joint-axis diversity** — axes are NOT all parallel/coaxial (the RUN-1 failure); the DOF
  live on distinct, useful axes.
- **Real links between joints** — lateral reach, not a vertical stack of coincident joints.
- **Reachable workspace** — the chain actually sweeps the required work volume.
- **Approachable work surface** — the end-effector can reach down to / approach the work
  surface in a usable orientation.
- **No self / ground / table collision** through the home pose and key poses (min-Z ≥ 0
  vs every surface).
- **Gripper opposition** — the jaws actually **oppose**, perpendicular to the approach axis,
  with a real, non-zero stroke.
- **Sane proportions** — link ratios and base height are physically reasonable, not
  degenerate.

For a different mechanism (a fixture, a linkage, a press), swap the rubric rows for that
domain's fitness criteria — but keep the structure: *distinct-motion / reach / no-collision /
mechanism-actually-does-its-job / sane-proportions*, judged from a render + facts.

### Verdict (use a structured `schema` so it's machine-actionable)

```js
const SCHEMA = { type: 'object', additionalProperties: false,
  required: ['verdict', 'criteria', 'defects', 'summary'],
  properties: {
    verdict:  { type: 'string', enum: ['PASS', 'FAIL'] },
    criteria: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['name', 'score', 'note'],
      properties: {
        name:  { type: 'string' },                                   // a rubric row
        score: { type: 'number', description: '0-10' },
        note:  { type: 'string', description: 'what the render/facts show' },
      } } },
    defects:  { type: 'array', items: { type: 'string' },
                description: 'each specific fitness defect (e.g. "all joint axes parallel → no workspace", "elbow min-Z = -87 → below tabletop")' },
    summary:  { type: 'string', description: 'one-paragraph fitness judgment' },
  } }

const verdict = await agent(
  `YOU ARE A SKEPTICAL, ENGINEERING-LITERATE DESIGN REVIEWER judging a mechanism's
   FITNESS FOR PURPOSE (not its geometric validity — that already passed the mechanical
   gate). You are shown TWO renders (isometric + side-elevation-in-the-reach-plane) and a
   block of FACTS (per-joint XYZ, end-effector position, joint-axis unit vectors, and min-Z
   of every body vs the ground/table).

   FACTS:
   ${facts}

   Judge against this fitness rubric and FLAG every defect — a degenerate-but-valid result
   must FAIL, never pass silently:
   ${rubricText}

   Look specifically for the failures the mechanical gate is blind to: all joint axes
   parallel/coaxial (no workspace); the arm folded back on itself; any link with negative
   min-Z (below the table/ground); a gripper whose jaws do not oppose the approach axis with
   a real stroke. Return PASS only if the mechanism is genuinely good.`,
  { label: 'judge:fitness', schema: SCHEMA, /* attach the two rendered images for vision */ }
)
```

> The judge call **needs the image** (vision) — attach the iso + side PNGs from Step 1. The
> printed facts alone are not enough (and the render alone is not enough — that's why both
> halves exist).

## Step 4 — Act on the verdict (never silently accept)

- **PASS** — the mechanism is fit for purpose. Record the verdict + the two renders as a
  session document (`create_document`, `fitness-review-<mechanism>`) so the judgment survives
  a `/clear`, and let the build proceed.
- **FAIL** — **flag it; do NOT silently accept.** Save the verdict (with the `defects` list
  and both renders) and route it back:
  - If the fix is a design change (wrong axis layout, wrong link lengths, inverted pitch
    sign), feed the `defects` into a **redesign** — re-run the [design-exploration CAD
    mode](../design-exploration/SKILL.md) to produce a corrected E0 contract, or hand the
    defects to the planner.
  - If a human decision is needed, **escalate** (`escalation_create` with the defects as the
    question + the renders as evidence) rather than ending on a printed note.

A degenerate-but-valid artifact reaching "accepted" is exactly the failure this gate exists
to prevent.

## How to wire it into the pipeline

Run this **as an optional review stage after the mechanical gate**, not in place of it:

1. Build → mechanical gate (`validate_geometry` / `analyze_dof` / `check_clearance`). If that
   fails, fix the geometry first — fitness review is moot on invalid geometry.
2. Mechanical gate green → **fitness review** (this skill): render → facts → vision judge.
3. PASS → done. FAIL → flag → redesign/escalate.

It pairs with [design-exploration's CAD mode](../design-exploration/SKILL.md): that skill is
the **design-stage** judge (scores candidate E0 contracts *before* the build, from a spatial
spec + FK sanity); this skill is the **post-build** judge (scores the *built, posed*
mechanism, from a real render). The same fitness rubric grounds both — design-exploration's
judge uses it on the spec; this one uses it on the artifact, with the judge's eyes on a
render.

## Rules of thumb

- **The mechanical gate is blind to fitness.** Valid + right-DOF + clearance-passes ≠ good.
  This gate is the only thing that catches a folded, coaxial, or table-colliding mechanism.
- **The judge must SEE the render.** A text-only review misses pose/articulation defects;
  attach the iso + side PNGs.
- **Always render the side elevation in the reach plane** — it exposes the in-plane defects
  (folding, sub-table links) the iso hides.
- **Print the facts the eye can't read** — joint XYZ, end-effector, axis vectors, and min-Z
  vs every surface. min-Z < 0 is a ground/table collision the eye won't see.
- **Render is infrastructure, not show-and-tell** — its purpose is to feed the judge.
- **FAIL flags, never silently accepts.** A degenerate-but-valid result routes to
  redesign/escalate.
