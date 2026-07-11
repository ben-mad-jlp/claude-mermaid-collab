# Visual QA Sweep — Design-System Epic (T8)

Final QA for the visual-consistency epic (T1–T7). **Method note:** a *live* light+dark screenshot pass of each role/view requires a running UI server (`ui.running` was `false` during this run) and, for the installed app, an electron-builder repackage — that interactive portion is filed as a follow-up (N5). This document records the **static** consistency verification done from source, which confirms the epic's structural goals.

## Verification results (static, from source)

| Check | Result |
|-------|--------|
| **T2** — residual arbitrary `text-[Npx]` sizes | ✅ **0** — all migrated to `text-2xs`/`text-3xs` |
| **T3** — residual raw `red/green/blue/amber-*` utils | ✅ **0** — all migrated to `danger/success/info/warning` tokens |
| **T3** — tokens pixel-identical to built-ins | ✅ semantic tokens alias the Tailwind v4 OKLCH ramps (`var(--color-red-500)` …) |
| **T4** — non-test components using color utils with **no** `dark:` | ✅ only 2 remain, both intentional (see N4) |
| **T5/T6/T7** — collapse glyphs, tri-view, PlanPanel | ✅ unified tokens/scale; metadata badges normalized to `text-3xs`; in_progress pin treatment added |

The structural goals of the epic (token-driven typography, semantic color tokens, dark-mode parity on first-party surfaces) are met.

## Residual nits (filed as follow-up todos)

- **N1 — Stray non-tokenized color families.** `yellow` (21 files, incl. the `blocked` status color), `orange` (8), `purple` (7), `emerald` (6), `indigo` (5), `slate` (3), `stone` (2). These were deliberately left out of T3 because their ramps are **not** pixel-identical to a semantic token (e.g. `yellow ≠ amber/warning`), so migrating them is a *color-changing* decision, not visual-only. Needs a design call: remap `yellow→warning` (accept the shift) or define additional tokens.
- **N2 — `blocked` state uses raw `yellow-600`** consistently across ProjectScopeSection, PlanPanel, CoordinatorView. Consistent with itself, but not tokenized. Fold into the N1 decision (likely → `warning`).
- **N3 — Hover-state opacity inconsistency.** Some rows use `dark:hover:bg-gray-800` and others `dark:hover:bg-gray-800/50`. Cosmetic; pick one.
- **N4 — Intentional dark-mode exceptions.** `ChatHost` (white/opacity overlay on a colored toolbar) and vendored `ContextWindowMeter` (t3chat third-party) have no `dark:` variants by design. Re-confirm during the live pass.
- **N5 — Live light+dark screenshot pass still pending.** Run with the UI server up (`bun run dev`) + CDP tunnel for each role/view (Supervisor/Planner/Coordinator) and key app screens; for the installed app, repackage via ad-hoc electron-builder first.
