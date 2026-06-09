---
name: design-exploration
description: Explore an open design question from multiple independent creative angles, then synthesize one recommended design. Spawns a diverge→judge→synthesize multi-agent workflow (ground the reality → N distinct concepts in parallel → adversarial judge → one synthesized design doc). Use for UI/UX, architecture, or product design questions where several approaches are viable and you want a creative-yet-buildable recommendation with the reasoning preserved — NOT for a quick decision with an obvious default.
user-invocable: true
allowed-tools: Read, Grep, Glob, Bash, Workflow, ToolSearch, mcp__plugin_mermaid-collab_mermaid__create_document, mcp__plugin_mermaid-collab_mermaid__get_document
---

# Design Exploration

Turn an open design question into one well-justified, buildable design — by exploring it from several **independent** creative angles in parallel, judging them adversarially, and synthesizing the best into a single recommendation. The reasoning is preserved as a session document so it survives a `/clear` and can feed the Planner.

This is the pattern that produced the "Studio & Bridge" control-UI design and the Bridge redesign. Use it whenever a design space is genuinely open (multiple viable approaches) and the cost of guessing one direction is high.

## When to use
- **Use it** for: a fresh UI/UX surface, an architecture with real tradeoffs, "reimagine X", "what's the best way to structure Y", choosing between approaches when the solution space is wide.
- **Use it for MECHANICAL / CAD design too** — see [Mechanical / CAD mode](#mechanical--cad-mode-produce-the-e0-build-contract) below. The Planner runs it as a **planning-stage** activity to *produce the E0 build contract* (the pinned spatial arrangement) BEFORE the parts→assembly build pipeline runs. Use it whenever you'd otherwise hand the Orchestrator's Build pass a CAD build with only interfaces specified — exploring joint-axis layout / link proportions / reach envelope / gripper mechanism up front is what stops a plausible-but-wrong mechanism (e.g. the coaxial-arm failure) from reaching the build.
- **Don't use it** for: a decision with an obvious default, a small change, or something you can just verify in the codebase. Pick the obvious option and move on.

## The shape (always the same four phases)
1. **Ground** — 2 parallel readers establish reality: a *code/UI cartographer* (what exists, which files, which store slices/data drive it, the concrete pain points) and a *domain/research* agent (the user journeys, or research into any libraries/approaches in play). Their output grounds every concept so nothing is vaporware.
2. **Diverge** — 4–6 agents, each given a **distinct creative lens**, design a *complete* concept in parallel. Distinct lenses are the whole point — if they converge you wasted the fan-out. Each concept must deliver the same structure (thesis, layout/structure, the hard parts, ASCII wireframes/mockups, signature interactions, a technical plan grounded in real names).
3. **Judge** — one skeptical design-director agent scores all concepts on criteria tailored to the question (use a `schema` so the verdict is structured), names each one's biggest risk, picks a **winner**, and says what to **graft** from runners-up and what to **drop**.
4. **Synthesize** — one lead-designer agent produces the definitive design anchored on the winner + grafts, and **saves it as a session document** (`create_document`). It returns a tight executive summary.

Then **present** the ranking + winner + executive summary to the human, and on their pick hand it to the **planner** skill to decompose into a build epic. **Weigh, don't obey** the judge — synthesize against the product's real constraints.

## How to run it

1. **Frame the question + pick the lenses.** Write a rich `CONTEXT` block: the problem in the user's own words, the current state (be honest about what's wrong), the data/stack facts, and any principle/library to evaluate. Then choose 4–6 lenses that attack the space from genuinely different stances (e.g. for a dashboard: instrument-panel-primary / graph-primary / split / focus-led / zoned). If the user named threads, fold each into the lenses or make them cross-cutting requirements every concept must address.
2. **Author the Workflow inline** using the template below — fill in `CONTEXT`, the two grounding prompts, the `LENSES`, the judge `SCHEMA` criteria, and the synthesis doc name.
3. **Launch** with the `Workflow` tool (it runs in the background; you're notified on completion).
4. On completion: relay the **winner + ranking table + executive summary**, point to the saved doc, and offer to plan it.

### Template (adapt every field to the question)

```js
export const meta = {
  name: '<topic>-design',
  description: '<one-line design goal>',
  phases: [
    { title: 'Ground', detail: 'map reality + research' },
    { title: 'Diverge', detail: 'N distinct concepts in parallel' },
    { title: 'Judge', detail: 'score against the criteria' },
    { title: 'Synthesize', detail: 'one recommended design, saved as a doc' },
  ],
}
const PROJECT = '<abs project path>'
const SESSION = '<collab session>'
const CONTEXT = `<<the problem in the user's words; current state + what's wrong; stack/data facts; principles/libs to evaluate; the ask>>`

phase('Ground')
const grounding = await parallel([
  () => agent(`${CONTEXT}\n\nYOU ARE A CODE/UI CARTOGRAPHER. Read the real implementation (Glob/Grep/Read specific paths). Produce a tight map: component tree + what each shows + the concrete pain points; the exact store slices/selectors/events each surface consumes; what data is already derivable for any new view. Be specific with file + selector names.`, { label: 'ground:code', phase: 'Ground' }),
  () => agent(`${CONTEXT}\n\nYOU ARE A DOMAIN/RESEARCH ANALYST. Define the user journey(s) and what each truly needs (and what to cut); OR research the libraries/approaches in play and where each earns its place vs is overkill. Output an opinionated brief the design agents build against.`, { label: 'ground:domain', phase: 'Ground' }),
])
const GROUND = grounding.filter(Boolean).join('\n\n=====\n\n')

phase('Diverge')
const LENSES = [
  { key: 'lens-a', brief: '<distinct stance A — be specific about the angle>' },
  { key: 'lens-b', brief: '<distinct stance B>' },
  { key: 'lens-c', brief: '<distinct stance C>' },
  { key: 'lens-d', brief: '<distinct stance D>' },
  // 4–6 total; make them genuinely different
]
const concepts = await parallel(LENSES.map((l) => () =>
  agent(`${CONTEXT}\n\n--- GROUNDING ---\n${GROUND}\n\n--- YOUR DIRECTION: ${l.key} ---\n${l.brief}\n\nDesign a COMPLETE concept in this direction. Deliver: 1 THESIS; 2 STRUCTURE/LAYOUT + hierarchy; 3 THE HARD PARTS (the specific things this design must nail); 4 ASCII WIREFRAME(S), detailed, monospace; 5 SIGNATURE INTERACTIONS (3-5); 6 TECHNICAL PLAN — component names, store slices/events, reuse vs new vs delete, deps to add, phased build order, referencing real names from the grounding. Concrete and buildable; one of several competing concepts — make yours distinct and the best.`, { label: `concept:${l.key}`, phase: 'Diverge' })
))
const CONCEPTS = LENSES.map((l, i) => `### CONCEPT: ${l.key}\n${concepts[i] ?? '(failed)'}`).join('\n\n==========\n\n')

phase('Judge')
const SCHEMA = { type: 'object', additionalProperties: false,
  required: ['ranking','winner','synthesisGuidance'],
  properties: {
    ranking: { type: 'array', items: { type: 'object', additionalProperties: false,
      // tailor these criteria to the question; keep a `total` + `verdict`
      required: ['concept','criterionA','criterionB','technical','total','verdict'],
      properties: {
        concept: { type: 'string' },
        criterionA: { type: 'number', description: '0-10 <tailored>' },
        criterionB: { type: 'number', description: '0-10 <tailored>' },
        technical: { type: 'number', description: '0-10 buildable on the real stack' },
        total: { type: 'number' },
        verdict: { type: 'string', description: 'one-line judgment + biggest risk' },
      } } },
    winner: { type: 'string' },
    synthesisGuidance: { type: 'string', description: 'what to graft from runners-up, what to drop' },
  } }
const verdict = await agent(`${CONTEXT}\n\nYOU ARE A SKEPTICAL DESIGN DIRECTOR. Competing concepts:\n\n${CONCEPTS}\n\nScore each 0-10 on the criteria; be critical and name each one's biggest risk. Pick a WINNER and say what to GRAFT from runners-up and what to DROP. Favor something creative AND shippable on the real stack.`, { label: 'judge:panel', phase: 'Judge', schema: SCHEMA })

phase('Synthesize')
const synth = await agent(`${CONTEXT}\n\n--- GROUNDING ---\n${GROUND}\n\n--- CONCEPTS ---\n${CONCEPTS}\n\n--- JUDGE VERDICT ---\n${JSON.stringify(verdict, null, 2)}\n\nYOU ARE THE LEAD DESIGNER. Produce ONE definitive design anchored on the winner, grafting the best per the judge, weighed against the product's real constraints. SAVE it as a session document: ToolSearch the tool, then mcp__plugin_mermaid-collab_mermaid__create_document { project: "${PROJECT}", session: "${SESSION}", name: "design-<topic>", content: <full markdown: vision; structure + wireframe; the hard parts; signature interactions; visual/info design; technical plan with components/stores/deps/reuse-new-delete/phased build order; why-over-alternatives + top risks> }. Return a tight executive summary (vision + winning direction + first build phase).`, { label: 'synthesize:design', phase: 'Synthesize' })

return { winner: verdict?.winner, ranking: verdict?.ranking, doc: 'design-<topic>', summary: synth }
```

## Rules of thumb
- **Distinct lenses or it's wasted.** If two concepts would come out similar, replace one. Name the stance, not just the topic.
- **Ground first, always.** Vaporware loses; every concept must reference real files/stores/data from the grounding phase.
- **Tailor the judge criteria** to what actually matters for this question (e.g. declutter, glanceability, professional, buildable, right-tool-per-job) — don't reuse a generic rubric.
- **The synthesis MUST save a doc** (`create_document`) — the durable artifact is the point; the chat summary is just the hook.
- **Right-size the fan-out** to the stakes: 4 lenses for a focused surface, 5–6 for a big reimagining.
- **Hand off to the planner.** A design doc is not a build. After the human picks the direction, invoke the `planner` skill to decompose it into a work-graph epic.

---

## Mechanical / CAD mode (produce the E0 build contract)

The same **diverge→judge→synthesize** shape applies to a *mechanism* (a robot arm, a gripper, a fixture). The difference is **what the synthesis produces**: not a UI design doc but an **E0 build contract** — the machine-checkable spatial arrangement the existing parts→assembly build pipeline consumes. This is a **Planner-stage** activity: a good design is fed into the (already-proven) build pipeline, instead of the Orchestrator's Build pass improvising the geometry.

**Why this exists.** A CAD build pipeline that pins only *interfaces* (mating datums, bolt circles) but not the *spatial arrangement* (joint AXES, link lengths, reach envelope) lets a kinematically-wrong mechanism through — e.g. the **coaxial-arm failure**, where every interface matched but all joints shared an axis so the arm couldn't reach. The synthesis here MUST pin the spatial config, not just interfaces.

**Proven recipe (CAD-arm RUN 2, 2026-06-04 — executed manually, produced a good 5-DOF arm).** The corrected pipeline that worked:
1. **DESIGN** — pin diverse joint axes (e.g. J1 yaw-Z, J2/J3/J4 pitch-Y, J5 roll) + REAL link lengths (upper 250 / forearm 200) so the arm extends laterally; gripper jaws oppose perpendicular to the approach axis.
2. **BUILD** — a forward-kinematics *posed* assembly in build123d (no live solver needed for a fitness check).
3. **FITNESS REVIEW** (the [#7b fitness gate](#)) — offline iso+side render + printed joint heights / min-Z; LOOK and iterate. RUN 2 took 3 iterations: a folded pose, then an inverted-pitch table collision (elbow below the tabletop) — **both invisible to the mechanical gate**, caught only by the fitness review.

This mode productizes steps 1 + (the design half of) 3: **diverge** = N design agents each emitting a candidate E0 contract; **judge** = the fitness rubric scoring each candidate; **synthesize** = the winner's spatial config written as E0; then hand E0 to the existing parts→assembly build pipeline (RUN 3 = run it for-real through the collab Planner + Orchestrator daemon so the arm is both well-designed AND motor-driven).

### What changes vs the UI flow
- **Ground** — a *kinematics/reach analyst* (the task envelope: required reach, payload, dexterity, the poses the mechanism must hit) **and** a *bsync/build123d capability cartographer* (which verbs exist; the **solver limits** that constrain the design — e.g. coupled/closed-loop motion is the known-hard case, so a parallel-jaw gripper must be quarantined as one named sub-assembly). Ground every concept in real envelope numbers + real kernel capabilities so nothing is unbuildable.
- **Diverge** — each lens is a distinct **mechanical stance**, and each agent emits a *candidate E0 contract* (the structured spatial spec below), not prose. Make the lenses genuinely different: joint-axis layout (where the DOF live), link proportions (reach vs stiffness), reach-envelope-first (size links to the task volume), gripper mechanism (parallel-jaw coupled / 2-bar linkage / cam).
- **Judge** — score on a **fitness rubric** (below), not UI criteria. At design stage there may be no geometry yet, so the judge scores the spatial spec + a quick FK sanity (reach coverage, dexterity from *distinct* axes, no folded/colliding home pose). When a posed FK render IS available, route it through the #7b fitness gate (the judge SEES the render) for a stronger verdict.
- **Synthesize** — produce the **E0 contract** and SAVE it (`create_document`, name `cad-contract-<topic>`). It MUST pin spatial arrangement: every joint's **axis + type**, **link lengths**, the **reach/workspace envelope**, the **gripper mechanism + DOF**, the **coordinate frames / mating datums**, and the **bolted interfaces**. That document is E0 — the input to the build pipeline.

### CAD template (adapt every field to the mechanism)

```js
export const meta = {
  name: '<mechanism>-cad-design',
  description: '<one-line mechanism goal> — produce the E0 build contract',
  phases: [
    { title: 'Ground', detail: 'task envelope + kernel/solver capabilities' },
    { title: 'Diverge', detail: 'N distinct candidate E0 contracts in parallel' },
    { title: 'Judge', detail: 'score on the fitness rubric' },
    { title: 'Synthesize', detail: 'winner → E0 contract, saved as a doc' },
  ],
}
const PROJECT = '<abs project path>'
const SESSION = '<collab session>'
const CONTEXT = `<<the mechanism in the user's words; the TASK ENVELOPE (required reach, payload, dexterity, the poses/volume it must serve); DOF budget; mounting + bolted interfaces; the known solver limits (coupled motion is hard — quarantine it); the ask: produce an E0 build contract that pins the SPATIAL arrangement>>`

phase('Ground')
const grounding = await parallel([
  () => agent(`${CONTEXT}\n\nYOU ARE A KINEMATICS / REACH ANALYST. Define the TASK ENVELOPE precisely: the workspace volume to cover, required reach + payload, the dexterity (orientations) at the work points, and the specific poses the mechanism MUST hit. Output concrete numbers (reach in mm, DOF needed, axis directions implied by the task) the design agents must satisfy.`, { label: 'ground:kinematics', phase: 'Ground' }),
  () => agent(`${CONTEXT}\n\nYOU ARE A bsync / build123d CAPABILITY CARTOGRAPHER. ToolSearch the CAD verbs (joints, motors, transmissions, connections/auto-hardware, validate_geometry, analyze_dof, check_clearance, FK posing, render/export). Map what's BUILDABLE and — critically — the SOLVER LIMITS (e.g. coupled/closed-loop motion is the known-hard case). Output an opinionated brief: what each concept may rely on, and what it must quarantine or avoid.`, { label: 'ground:kernel', phase: 'Ground' }),
])
const GROUND = grounding.filter(Boolean).join('\n\n=====\n\n')

phase('Diverge')
const LENSES = [
  { key: 'joint-axis-layout', brief: 'Lead with WHERE the DOF live: pick joint axes (yaw/pitch/roll assignment per joint) that maximize distinct, useful motion — explicitly avoid coaxial/degenerate axes. Justify reach + dexterity from the axis choice.' },
  { key: 'link-proportions', brief: 'Lead with link length ratios for reach vs stiffness/printability; size the upper/fore/wrist links to the task volume; justify why these proportions cover the envelope without folding.' },
  { key: 'reach-envelope-first', brief: 'Start from the required workspace volume and back-solve the chain (DOF count, link lengths, base height) to cover it with margin; justify coverage of every required pose.' },
  { key: 'gripper-mechanism', brief: 'Lead with the end-effector: choose the parallel-jaw mechanism (coupled −1 transmission / 2-bar linkage / cam), jaw stroke + approach axis, and how it quarantines the hard coupled-motion problem into one sub-assembly; then fit the arm to serve it.' },
  // 4–6 total; make them genuinely different mechanical stances
]
const concepts = await parallel(LENSES.map((l) => () =>
  agent(`${CONTEXT}\n\n--- GROUNDING ---\n${GROUND}\n\n--- YOUR DIRECTION: ${l.key} ---\n${l.brief}\n\nDesign a COMPLETE mechanism in this direction and emit it as a CANDIDATE E0 CONTRACT. Deliver: 1 THESIS (the mechanical bet); 2 the KINEMATIC CHAIN — every joint's TYPE + AXIS (e.g. J1 revolute yaw-Z), in order; 3 LINK LENGTHS (mm) and base height; 4 the REACH/WORKSPACE ENVELOPE it achieves + how it covers the required poses (a quick FK reachability argument); 5 the GRIPPER mechanism + its DOF + jaw stroke + approach axis; 6 COORDINATE FRAMES / MATING DATUMS per link + BOLTED INTERFACES (which flanges, bolt circles); 7 HOME POSE (and a sanity check that it does NOT fold or self/table-collide); 8 BUILDABILITY on bsync (what it relies on, what it quarantines). Concrete, numeric, buildable; one of several competing candidates — make yours distinct and the best.`, { label: `concept:${l.key}`, phase: 'Diverge' })
))
const CONCEPTS = LENSES.map((l, i) => `### CANDIDATE: ${l.key}\n${concepts[i] ?? '(failed)'}`).join('\n\n==========\n\n')

phase('Judge')
// The FITNESS rubric (mechanical), not UI criteria. Ties to the #7b fitness gate:
// when a posed FK render exists, the judge SEES it; here it scores the spatial spec
// + an FK sanity check.
const SCHEMA = { type: 'object', additionalProperties: false,
  required: ['ranking','winner','synthesisGuidance'],
  properties: {
    ranking: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['concept','reach','dexterity','noCollision','buildability','total','verdict'],
      properties: {
        concept: { type: 'string' },
        reach: { type: 'number', description: '0-10 covers the required workspace envelope + poses' },
        dexterity: { type: 'number', description: '0-10 DOF live on DISTINCT useful axes (penalize coaxial/degenerate)' },
        noCollision: { type: 'number', description: '0-10 home + key poses do not fold / self-collide / hit the table' },
        buildability: { type: 'number', description: '0-10 buildable on bsync; quarantines coupled motion' },
        total: { type: 'number' },
        verdict: { type: 'string', description: 'one-line judgment + biggest mechanical risk' },
      } } },
    winner: { type: 'string' },
    synthesisGuidance: { type: 'string', description: 'what spatial choices to graft from runners-up, what to drop' },
  } }
const verdict = await agent(`${CONTEXT}\n\nYOU ARE A SKEPTICAL MECHANICAL DESIGN DIRECTOR. Competing candidate contracts:\n\n${CONCEPTS}\n\nScore each 0-10 on the FITNESS rubric (reach, dexterity, no-collision, buildability). Be critical: explicitly catch coaxial/degenerate axes, folded or table-colliding home poses, and reach that misses the envelope — the failures the mechanical gate CANNOT see. Pick a WINNER and say what spatial choices to GRAFT and what to DROP. Favor a mechanism that is dexterous AND buildable on bsync.`, { label: 'judge:fitness', phase: 'Judge', schema: SCHEMA })

phase('Synthesize')
const synth = await agent(`${CONTEXT}\n\n--- GROUNDING ---\n${GROUND}\n\n--- CANDIDATES ---\n${CONCEPTS}\n\n--- JUDGE VERDICT ---\n${JSON.stringify(verdict, null, 2)}\n\nYOU ARE THE LEAD MECHANICAL DESIGNER. Produce ONE definitive E0 BUILD CONTRACT anchored on the winner, grafting the best spatial choices per the judge, weighed against the real task envelope + kernel limits. SAVE it as a session document: ToolSearch the tool, then mcp__plugin_mermaid-collab_mermaid__create_document { project: "${PROJECT}", session: "${SESSION}", name: "cad-contract-<mechanism>", content: <full markdown E0 CONTRACT that PINS THE SPATIAL ARRANGEMENT, not just interfaces: (1) KINEMATIC CHAIN table — every joint TYPE + AXIS in order; (2) LINK LENGTHS + base height (mm); (3) REACH/WORKSPACE envelope it guarantees; (4) GRIPPER mechanism + DOF + jaw stroke + approach axis; (5) COORDINATE FRAMES / MATING DATUMS per link; (6) BOLTED INTERFACES (flanges, bolt circles, fasteners); (7) HOME POSE + a collision/fold sanity statement; (8) the DOF BUDGET success oracle (e.g. 5 arm DOF + 1 gripper); (9) buildability notes — what is quarantined (coupled motion) and how> }. Return a tight executive summary (the chain, link lengths, reach, gripper, and the first build phase).`, { label: 'synthesize:e0-contract', phase: 'Synthesize' })

return { winner: verdict?.winner, ranking: verdict?.ranking, contract: 'cad-contract-<mechanism>', summary: synth }
```

### CAD rules of thumb
- **Pin spatial arrangement, not just interfaces.** The E0 contract must fix joint AXES, link lengths, and the reach envelope — interface-only contracts let the coaxial-arm failure through.
- **Quarantine the hard motion.** Coupled/closed-loop motion (a parallel-jaw gripper) is the known solver risk — make it ONE named sub-assembly so the rest of the chain stays open-chain and low-risk.
- **The mechanical gate is blind to fitness.** `validate_geometry`/DOF/clearance say a part *exists*, not that the mechanism *reaches* or *doesn't fold*. The fitness rubric (and, when geometry exists, the #7b render-seeing judge) is what catches a plausible-but-wrong arm.
- **The synthesis MUST save the E0 contract** (`create_document`, `cad-contract-<mechanism>`). That document — not the chat summary — is the input the parts→assembly build pipeline consumes.
- **Hand E0 to the build pipeline.** After the human accepts the contract, invoke the `planner` skill to decompose E0 into the parts→assembly build epic (RUN 3: well-designed AND motor-driven).
