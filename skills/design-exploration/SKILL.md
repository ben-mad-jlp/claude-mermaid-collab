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
