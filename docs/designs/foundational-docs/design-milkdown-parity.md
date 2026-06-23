# Design: Milkdown Parity with the Legacy DocumentEditor

Companion to `research-milkdown-parity` (anchor), `research-wysiwyg-markdown`, and `design-milkdown-migration`. This doc enumerates exactly what remains to close the gap between the Milkdown-backed `DocumentEditor.wysiwyg.tsx` and the legacy split-pane `DocumentEditor.legacy.tsx` — and the rollout signals for flipping `wysiwygDocumentEditor` on.

---

## Guiding Principle — Prefer Milkdown built-ins

**Use Milkdown's built-in styling, presets, and plugins as much as reasonable — even when the result looks visually different from the legacy editor (different fonts, different code-block chrome, etc.).**

Rationale: minimizing the custom CSS/override surface area is a higher-value goal than pixel-matching the legacy look. Built-in styling is what Milkdown maintains; custom overrides rot across upgrades. Visual exactness to the legacy editor is **not** a parity requirement — functional parity and round-trip correctness are.

Apply this as follows throughout the sections below:
- Favor "use Milkdown built-in X" over "reimplement X to match legacy" whenever the tradeoff is only visual.
- Only override when there's a concrete functional reason (readability broken, layout breaks round-trip, dark mode unusable) — not to match legacy.
- When in doubt, propose the built-in path first and flag the visual delta so the user can accept it.

---

## 1. Goal & Scope

### What "parity" means

Three axes, all required for parity:

1. **Byte-exact markdown round-trip** on a meaningful corpus. Status: **14/14 fixtures pass** in `ui/src/components/editors/milkdown/__tests__/roundTrip.test.ts`, with exactly **1 allowlist entry** (`05-emphasis.md`) for a strong-mark join-handler gap that requires a custom `mdast-util-to-markdown` handler. This gate is green per `review-completeness-phase-1-6`.
2. **Functional UX parity** with the legacy editor for the editing surfaces real users touch: save / cancel, Ctrl+S, unsaved indicator, history modal, annotations, diagram/design embeds, code-block syntax highlighting (any reasonable theme), readable typography in light + dark, collapsible headings, raw `<details>` blocks, task-list checkbox toggles, and diff view. **Pixel parity is not required.**
3. **Zero-risk rollout** — a user on the legacy editor can opt in (or be rolled back) without data loss or document drift.

### In scope

- Closing the remaining UX-parity gaps enumerated in section 3.
- Wiring the `wysiwygDocumentEditor` feature flag through `DocumentEditor.tsx` (currently a stub router that ignores the flag — see Gap G0).
- Rollout plan to flip default-off → default-on in dev, then staging, then prod.

### Explicitly out of scope

- Collaborative editing (Yjs) — tracked elsewhere.
- Touch-optimised table editing.
- Replacing `CodeMirrorWrapper` inside `CodeEditor` / `SnippetEditor` (they are not DocumentEditor).
- Minimap parity on day one (the legacy minimap is CodeMirror-only and was already marked legacy-only in the migration design).
- Click-to-source — obsolete in a unified WYSIWYG view.
- **Matching legacy fonts, exact spacing, code-block chrome, or dark-mode palette pixel-for-pixel.** Close-enough is the bar.

---

## 2. Current State

### What's done (from `impl-wave-1-milkdown` … `impl-waves-3-6-milkdown` + `fix-bugs-phase-1-6`)

- **Deps, flag, bridge, legacy copy, stub serializer, 10 fixtures** (Wave 1).
- **Diagram-embed node + node view + autosave plugin** (Wave 2). Embeds round-trip byte-exact.
- **MilkdownEditor host, roundTrip test harness, wysiwyg DocumentEditor body, 13 wysiwyg tests green, legacy gated** (Waves 3–6).
- **rawPositions plugin + fidelityPlugins filled out (list/emphasis/hardBreak/whitespace)** (Phase 1.6). 14 fixtures grew from initial 10; extra 4 are real-world docs.
- **Bug pass (1 critical + 4 important + several minor) applied** (`fix-bugs-phase-1-6`).

### Gate status

- Round-trip gate: **14/14 pass, 1 allowlist entry** (`05-emphasis.md`, ≤2 limit satisfied, comment in `roundTrip.test.ts:57-61`).
- Original 10-fixture threshold (≥8 pass): met.
- Embed byte-exact (06, 07): met.
- No regressions in 11–14: met.
- Completeness review verdict: "0 gaps" for the Phase 1.6 surface.

### What is **not yet** done (the parity delta this design plans)

- Feature flag is not wired into the router. `DocumentEditor.tsx` unconditionally renders `DocumentEditorLegacy`, ignoring `useFeatureFlags().wysiwygDocumentEditor`. Nothing in production can reach the wysiwyg code path yet.
- Readable typography in wysiwyg (currently browser defaults).
- Code-block syntax highlighting.
- Heading-based collapsible sections + Expand/Collapse All controls.
- Raw `<details>` / `<summary>` animated blocks.
- Image URL resolver parity (`@diagram/id`, `./designs/id`, etc.) for non-embed syntax.
- Task-list checkbox toggle semantics in read-only vs edit.
- Annotations (toolbar, anchoring, migration of inline comment markers).
- Diff view (kept on legacy per the migration design; we need an explicit route).
- 1 allowlisted round-trip drift (`05-emphasis.md` strong-mark joining).
- Minor follow-ups deferred from `fix-bugs-phase-1-6`: M2 (break-slice window), M4 (no-op `bulletMarkerRemark`), M6 (ordered-list marker attr schema).

---

## 3. Gaps to Close

Each gap lists: **what's missing**, **why it matters**, and an **effort estimate** (S = ≤1 day, M = 1–3 days, L = 3–5 days).

### G0. Router does not read the flag — **S**
- **Missing:** `DocumentEditor.tsx` (10 lines) delegates straight to legacy; it never calls `useFeatureFlags()` or renders `DocumentEditorWysiwyg`.
- **Why:** Without this, nobody can even dogfood the wysiwyg path. Blocker.
- **Effort:** S (~30 min plus a router test).

### G1. Readable typography (light + dark) — **S/M**
- **Missing:** Milkdown ships no CSS out of the box. Without a theme, headings render at browser defaults, paragraphs have no vertical rhythm, and dark mode is unhandled.
- **Why:** The wysiwyg editor currently looks unstyled. Parity requires *readable*, not legacy-identical.
- **Effort:** **S if we adopt a Milkdown theme package (`@milkdown/theme-nord` or `@milkdown/crepe` theme); M if we hand-roll.** See D2.
- **Acceptance:** text and headings are readable in light + dark; code blocks have visible chrome. Fonts and exact spacing may differ from legacy — accepted.

### G2. Code-block syntax highlighting — **S/M**
- **Missing:** Fenced code currently renders as unstyled `<pre><code>`.
- **Why:** Every technical doc has fenced code. Unstyled blocks are hard to read.
- **Effort:** **S if we adopt `@milkdown/plugin-prism`; M if we build a custom `react-syntax-highlighter` NodeView.** See D3.
- **Acceptance:** common languages highlight correctly in light + dark. Theme may not match legacy's `oneDark` / `vs` — accepted.

### G3. Heading-based collapsible sections — **L**
- **Missing:** Legacy `CollapsibleMarkdown` + `CollapsibleSectionsProvider` + `ManagedCollapsibleSection` + Expand/Collapse All toolbar. Users rely on this on long docs.
- **Why:** Power users navigate long foundational docs via section collapse. Without it, wysiwyg feels regressive on the docs people actually use it on.
- **Effort:** L (~120–150 LOC). NodeView on heading schema + a ProseMirror decoration plugin that hides sibling blocks up to the next heading of equal-or-higher level. Reuses existing React `CollapsibleSectionsProvider` / `Controls` / chevron components verbatim.
- **Note:** No built-in Milkdown plugin offers this; custom implementation required. The guiding principle doesn't apply when no built-in exists.

### G4. Raw `<details>` / `<summary>` blocks — **M**
- **Missing:** CommonMark passes raw HTML tags through as un-rendered `html` nodes; Milkdown has no schema for them. Legacy renders them via `rehype-raw` → `CollapsibleDetails`.
- **Why:** Some hand-authored docs use `<details>` for ad-hoc collapsibles outside heading trees. Without this, they appear as literal text.
- **Effort:** M (~100–140 LOC): custom remark pairing plugin (paired `<details>…</details>` → `details` node) + `$nodeSchema` + NodeView. Native HTML `<details>` element works fine — minimal custom styling needed.
- **Note:** No Milkdown built-in; custom required.

### G5. Image URL resolution (`@diagram/id`, `./designs/id`) — **S/M**
- **Missing:** Raw markdown `![alt](@design/id)` or `![](./diagrams/foo)` — passed through untouched to `<img>` with unresolved URL. Legacy routes via `resolveImageSrc` to `/api/render/:id?project=…&session=…`.
- **Why:** Less common than `{{embed}}` but appears in older / copy-pasted docs. Broken images == silent data loss appearance.
- **Effort:** S (~40 LOC). NodeView on the `image` node that reuses the existing `resolveEmbedSrc` bridge.

### G6. Task-list checkbox toggle (edit + read-only) — **S**
- **Missing:** Legacy detects `className === 'task-list-item'`, swaps the checkbox with a controlled one that rewrites source on click. In wysiwyg edit mode, Milkdown mutates the doc directly via the built-in GFM plugin so autosave picks it up.
- **Why:** Ensure the edit-mode transaction round-trips the `checked` attr byte-exact. Add a fixture to the round-trip corpus if not already present.
- **Effort:** S (~30 LOC + fixture). Likely no code change if GFM task list round-trips cleanly; verify first. Uses Milkdown's built-in GFM task-list plugin — no custom styling needed.

### G7. Annotations — **L**
- **Missing:** `AnnotationToolbar` is CodeMirror-coupled. The migration design (§ Annotation strategy) resolves this by moving annotations to a **document-metadata field** (`document.annotations`) with position-resilient anchors, plus a one-shot migrator for `<!-- comment-start: … -->` markers. None of this is implemented.
- **Why:** Annotations are a live collaboration feature. Without them, wysiwyg cannot replace legacy for any user who annotates.
- **Effort:** L (~300+ LOC across: Zustand slice, PM decoration plugin, toolbar variant, migrator, server-side metadata schema bump, reversibility path).

### G8. Diff view — **S**
- **Missing:** Legacy supports `diff={{oldContent, newContent}}` via `MarkdownPreview`'s LCS path. Wysiwyg has no diff UI.
- **Why:** Used in history modal + proposed-edit review flows. Current migration design says "keep MarkdownPreview for diff, branch in caller."
- **Effort:** S. Route diff cases to `MarkdownPreview` inside `DocumentEditorWysiwyg` (prop-driven branch). ~20 LOC.

### G9. Allowlisted round-trip drift (`05-emphasis.md`) — **M**
- **Missing:** Strong-mark adjacent-run joining (`**a****b**` vs `**ab**`). Currently allowlisted.
- **Why:** Not a blocker for flag flip (gate accepts ≤2 entries), but a real drift on a real pattern. Leaving allowlist entries unaddressed erodes the "byte-exact" promise.
- **Effort:** M (~60 LOC + tests): custom `mdast-util-to-markdown` strong handler that tracks raw marker positions.

### G10. History modal parity — **S**
- **Missing:** `DocumentEditor.wysiwyg.tsx` imports `HistoryModal` but only wires `historyModalOpen` state. There's no button to open it.
- **Why:** Users expect to open version history from the wysiwyg editor too.
- **Effort:** S (~30 LOC) — port button + open-handler from legacy header.

### G11. Telemetry / observability — **S**
- **Missing:** `editor_variant`, `round_trip_drift_bytes`, `autosave_latency_ms` logging for rollout confidence.
- **Why:** Without telemetry we can't detect regressions during the flag flip.
- **Effort:** S (~50 LOC) once a telemetry sink is identified (see Open Questions).

### G12. Deferred bug-review follow-ups — **S**
- **Missing:** M2 (break-style raw slice window), M4 (`bulletMarkerRemark` no-op registration), M6 (ordered-list marker attr schema — `1.` vs `1)`).
- **Why:** M6 is a real fidelity gap; M4 is code hygiene; M2 is theoretical fragility. None blockers.
- **Effort:** S combined.

---

## 4. Design Decisions (non-trivial gaps)

### D1 (G0). Router flag plumbing — minimal router

**Approach:** Replace the current 10-line stub with:

```ts
const { wysiwygDocumentEditor } = useFeatureFlags();
return wysiwygDocumentEditor
  ? <DocumentEditorWysiwyg {...props} />
  : <DocumentEditorLegacy {...props} />;
```

**Alternatives considered:**
- **Per-document flag.** Rejected — support nightmare during rollout.
- **Lazy-load wysiwyg chunk** via `React.lazy`. Accept — good idea; defer to polish phase.

**Tradeoff:** A single global flag means everyone flips together; mitigated by per-user localStorage override.

### D2 (G1). Typography — adopt a Milkdown theme package (per guiding principle)

**Preferred approach:** Use a Milkdown-maintained theme package — either `@milkdown/theme-nord` (the canonical Milkdown theme) or the theme shipped with `@milkdown/crepe`. Add a thin dark-mode class toggle wrapper. Accept that fonts, headings, and spacing will differ from legacy.

**Rationale (from guiding principle):** Theme packages are maintained by the Milkdown team and track Milkdown's own schema. Our custom CSS would rot across upgrades. Visual delta from legacy is acceptable.

**Fallback if no theme package passes smoke test:** a minimal ~20-line scoped stylesheet that ensures readable font-size, line-height, vertical rhythm, dark-mode colors — and stops there. **No mechanical port of `MarkdownPreview`'s per-element Tailwind classes.** If the built-in looks bad, fix the specific readability issue; don't recreate legacy.

**Alternatives considered:**
- **Port every per-element Tailwind class from `MarkdownPreview`** into `.milkdown-prose .ProseMirror …` rules. **Rejected** under the guiding principle — large custom surface area, duplicates legacy visuals for no functional gain.
- **Use `@tailwindcss/typography` defaults only.** Viable fallback; simpler than hand-rolled.

**Tradeoff:** Users will notice different fonts / weights vs. legacy. Accepted. Mitigation: include a before/after screenshot in the R1 rollout notes so the change isn't surprising.

### D3 (G2). Code-block highlighting — adopt `@milkdown/plugin-prism` (per guiding principle)

**Preferred approach:** Add `@milkdown/plugin-prism` and register it. Choose a Prism theme that works in both light and dark (e.g. `prism-one-light` + `prism-one-dark`, swapped by a wrapper class). Accept that it won't visually match legacy's `react-syntax-highlighter` output.

**Rationale (from guiding principle):** `react-syntax-highlighter` is **not already used by Milkdown**; bolting it onto a Milkdown NodeView is ~60 LOC of custom integration that duplicates what `@milkdown/plugin-prism` already does well. A Milkdown-native plugin is the simpler and more maintainable path.

**Fallback** (only if `@milkdown/plugin-prism` has a blocking functional issue): custom NodeView over `$view(fencedCode.node, …)` rendering `SyntaxHighlighter`. Use only if the built-in plugin actually breaks on real fixtures.

**Alternatives considered (and what changed):**
- **Previously preferred:** custom NodeView with `react-syntax-highlighter` to match legacy visuals. **Reversed** under the guiding principle — visual-match is not a parity requirement.
- **Leave unstyled.** Rejected — not readable.

**Tradeoff:** Prism's theme doesn't match `oneDark` / `vs`. Accepted. Two small decisions remain: (a) which Prism theme(s) to ship and (b) whether to highlight live while editing or on blur — `@milkdown/plugin-prism` handles this by default, so probably no decision needed.

### D4 (G3). Heading-based collapse — NodeView + ProseMirror decoration plugin

**Approach:**
1. `<CollapsibleSectionsProvider>` hoisted to wrap the Milkdown host in `DocumentEditorWysiwyg`.
2. `<CollapsibleSectionsControls>` rendered above the editor (reused verbatim).
3. `$view(headingRawTrailing.node, …)` — chevron + heading content; click toggles an id in the provider's expanded-set.
4. A new ProseMirror `Plugin` computes a `DecorationSet` each transaction: for every heading whose id is NOT expanded, emit `Decoration.node(from, to, { class: 'section-collapsed' })` across every block from heading+1 up to the next heading of level ≤ current. CSS: `.section-collapsed { display: none; }`.

**Alternatives considered:**
- Re-render via `CollapsibleMarkdown` (ReactMarkdown) when `editable=false`, Milkdown when `editable=true`. Rejected — two mental models, double the bugs.
- Schema change: `section` node wrapping heading + body. Rejected — would mutate the AST and break round-trip.

**Tradeoff:** Animation parity with legacy's measured-`scrollHeight` transition is hard via CSS `display:none`. Acceptable: ship without animation in v1; add opacity+max-height transition in v2 only if users complain. (Consistent with guiding principle — don't chase legacy polish.)

### D5 (G4). Raw `<details>` — paired-HTML remark plugin + schema + NodeView

**Approach:** Pre-commonmark remark plugin pairs `<details>`/`</details>` sibling `html` nodes into a `details` node (with `summary` child parsed from `<summary>…</summary>`). Register `$nodeSchema('details')` + `$nodeSchema('summary')` with NodeViews rendering **native `<details>` / `<summary>` elements** — which come with built-in open/close behavior and minimal styling needs.

**Alternatives considered:**
- `:::details[Summary]` directive syntax. Rejected — rewriting docs.
- Skip. Rejected — heading collapse doesn't cover inline `<details>` usage.
- Reuse legacy `CollapsibleDetails` component verbatim. Possible, but native `<details>` is simpler and browser-maintained.

**Tradeoff:** Pairing HTML tags across mdast siblings is fragile when mis-nested. Mitigation: on pairing failure, leave the `html` nodes intact (graceful degradation) + dev-only warning.

### D6 (G7). Annotations — document-metadata field + position anchoring

Already decided in `design-milkdown-migration` §Resolved-decisions-3: annotations live on `document.annotations` (metadata envelope, not inline in markdown body). No change. Implementation work is substantial but architecturally settled.

### D7 (G9). Strong-mark join fix — custom mdast-util-to-markdown handler

**Approach:** Register a custom strong handler in the remark-stringify options that tracks raw marker positions (already available via `rawPositions`) and emits adjacent runs without collapsing. De-allowlist `05-emphasis.md` once green.

**Alternatives considered:** Leave allowlisted forever. Rejected — allowlist creep erodes the gate.

---

## 5. Risks & Unknowns

1. **Theme package visual regressions.** Adopting `@milkdown/theme-nord` or Crepe's theme means headings/paragraphs will look visually different from legacy. Risk: users perceive regression even though it's intentional. Mitigation: rollout note with screenshots before R4; escape-hatch per-user flag override.
2. **NodeView edit semantics for code blocks.** Only relevant if we fall back to a custom `react-syntax-highlighter` NodeView. Not a risk under the preferred `@milkdown/plugin-prism` path.
3. **Heading-decoration performance on long docs.** Recomputing `DecorationSet` on every transaction over a 50k-char doc with 100 headings could be slow. Mitigation: cache decorations keyed by `(docVersion, expandedSet)`.
4. **Annotation anchor drift on migration.** Real-world docs with inline `<!-- comment-start:… -->` markers where the anchored text has since been edited: the migrator can't recover the original anchor. Mitigation: show orphan list + manual reattach.
5. **Rollback safety.** If users author content relying on wysiwyg-only features (annotations stored off-markdown), then flip back, those annotations become invisible. Mitigation: don't delete the sidecar on flip-back.
6. **Server schema change for annotations.** Adding `annotations?: Annotation[]` to the document record touches `src/services/*` persistence. Not yet scoped.
7. **Allowlist creep.** Currently 1 entry with ≤2 ceiling. Any new regression must displace it rather than add to it, or the ceiling must be raised consciously.
8. **Feature-flag visibility.** Flag is localStorage-only today. Promoting to server-driven needs alignment with whatever server-side config mechanism exists.
9. **Milkdown theme/plugin version pinning.** Adopting Milkdown built-ins increases our coupling to Milkdown's release cadence. Mitigation: pin exact versions + smoke test on upgrade.

---

## 6. Rollout Plan

### Phase R0 — Make the flag reachable (prereq, ~1 day)
- Wire `useFeatureFlags()` into `DocumentEditor.tsx` router (G0).
- Add a dev-only UI toggle in settings or header (hidden behind a dev flag).
- Add telemetry scaffolding for `editor_variant` (G11).
- **Signal to proceed:** Router test confirms both variants render; devs can toggle without editing localStorage.

### Phase R1 — Close blocking parity gaps (G1, G2, G5, G8, G10)
- Adopt Milkdown theme package (G1). Adopt `@milkdown/plugin-prism` (G2). Image URL resolver (G5). Diff branching (G8). History-modal button (G10).
- **Signal to proceed:** Internal dogfooding on ≥3 real docs. Readability is the bar, not legacy-matching. Round-trip gate remains 14/14 with ≤1 allowlist.

### Phase R2 — Close UX-power gaps (G3, G4, G6)
- Heading collapse, raw `<details>`, task-list validation.
- **Signal to proceed:** Designated power user completes a week of daily use without falling back.

### Phase R3 — Annotations (G7) + strong-mark drift (G9)
- Largest remaining chunk. Migrator + toolbar rewrite + orphan UX.
- **Signal to proceed:** Annotation migrator idempotency test green on ≥5 real annotated docs; orphan rate < 10%.

### Phase R4 — Flip default-on in **dev**
- `featureFlags.ts` `DEFAULTS.wysiwygDocumentEditor = true` in dev builds only.
- Keep per-user `ff.wysiwygDocumentEditor=0` override.
- **Monitor for 1 week:** `round_trip_drift_bytes` p99 = 0, `autosave_latency_ms` p95 < 600ms, no spike in `editor_variant=legacy` overrides.
- **Signal to proceed:** All three green for 7 consecutive days.

### Phase R5 — Flip default-on in **prod**
- `DEFAULTS.wysiwygDocumentEditor = true` unconditionally.
- Keep legacy code + override for 30 days.
- **Signal to proceed:** No user-reported regression tickets for 30 days.

### Phase R6 — Delete legacy (≥30 days after R5)
- Remove `DocumentEditor.legacy.tsx`, `useSyncScroll`, `Minimap` (if unused elsewhere), legacy tests, the flag.
- **Signal to proceed:** zero legacy-override usage for 30 consecutive days.

---

## 7. Open Questions

1. **Theme package choice:** `@milkdown/theme-nord` (canonical) or the Crepe theme (more polished, heavier)? Smoke-test both on the 14 fixture docs and pick by readability, not by legacy-similarity.
2. **Prism theme choice:** ship `prism-one-light` + `prism-one-dark`, `prism-vsc-dark-plus`, something else? Minor decision — pick whichever reads best in both modes.
3. **Annotation server schema:** adding `annotations?: Annotation[]` to the document record touches `src/services/` persistence. Is there an approved schema-versioning path, or do we design one? Blocks G7 start.
4. **Telemetry sink:** existing client logger / metrics endpoint, or wire a new `/api/metrics`? Blocks G11 and therefore the R4 flip.
5. **Feature-flag promotion:** keep localStorage-only through R5, or promote to server-driven before R4? Server-driven lets us roll back without asking every user to clear localStorage.
6. **Heading-collapse animation:** acceptable to ship R2 without legacy's 300ms transition (use `display: none`), or animation is required? Consistent with guiding principle, I'd recommend shipping without and revisiting if users complain.
7. **Allowlist policy:** if a new regression arrives, let the allowlist grow 1 → 2, or is 1 permanent? Matters for G9 prioritization.
8. **Migration reversibility window:** once annotations are migrated, how long do we keep the re-stamp-to-inline-markers path? Forever, R3 → R6 only, or never?
