# Design Tokens — Visual Audit & Baseline (T1)

**Scope:** Inventory the current visual system and centralize it into Tailwind v4 `@theme` tokens. VISUAL-ONLY — defines tokens; call-site refactors are T2/T3.
**Decision honored:** Tailwind theme tokens (`@theme inline` in `ui/src/index.css`), **not** a parallel CSS-var system.
**Stack:** Tailwind v4 (CSS-based `@theme`), `@tailwindcss/vite`. No `tailwind.config.js` — theme lives in `ui/src/index.css`.

---

## (a) Typography in use

Counts are utility-class occurrences across `ui/src/**/*.tsx`.

| Token | Uses | Notes |
|-------|------|-------|
| `text-xs` | 386 | Dominant — metadata, labels, chips |
| `text-sm` | 386 | Dominant — body/UI text |
| `text-base` | 18 | |
| `text-lg` | 26 | Section headers |
| `text-xl` | 9 | |
| `text-2xl` | 6 | |
| `text-3xl` | 7 | Page titles |

**Weights:** `font-medium` (252), `font-semibold` (114), `font-bold` (40), `font-normal` (18).

**Fonts (tokenized):** `--font-sans: Inter, system-ui, sans-serif`; `--font-mono: "Fira Code", monospace`.

**Finding:** `xs`/`sm` carry ~90% of text. Default Tailwind fontSize scale is sufficient; no custom sizes needed. T2/T3 should standardize body=`text-sm`, metadata=`text-xs`, headers=`text-lg/xl/3xl`.

---

## (b) Color usage (ad-hoc → semantic)

Top families by occurrence (bg/text/border combined):

| Family | ~Uses | Status |
|--------|-------|--------|
| `gray-*` | ~3,600 | Core neutral; dark-mode-remapped (see below) |
| `accent-*` / `brand-*` | ~225 | **Tokenized** — canonical brand ramp |
| `blue-*` | ~415 | Mostly **info** semantics; some raw |
| `red-*` | ~325 | **danger** semantics |
| `green-*`/`emerald-*` | ~160 | **success** semantics |
| `amber-*`/`yellow-*` | ~190 | **warning** semantics |
| `slate-*`/`orange-*`/`purple-*`/`indigo-*`/`stone-*` | <50 each | Ad-hoc strays — candidates to fold into tokens |

**Tokens established in `@theme` (additive aliases, nothing re-renders until migration):**
- `brand-{50..900}` === `accent-{50..900}` (sky ramp `#0ea5e9` @500)
- `success-{50..900}` → green ramp
- `warning-{50..900}` → amber ramp
- `danger-{50..900}` → red ramp
- `info-{50..900}` → blue ramp

**Hardcoded hex (ad-hoc, to retire in T2/T3):** Solarized-sepia values (`#DFCA88`, `#586E75`, `#B58900`, `#D4B96A`) live as arbitrary classes + theme overrides; GitHub-dark editor hexes (`#58a6ff`, `#0d1117`, `#161b22`, `#30363d`, `#c9d1d9`). These are theme-specific and acceptable for now but should map to tokens where they overlap semantic state.

---

## (c) Spacing / padding patterns

Scale steps by occurrence: `*-2` (675), `*-3` (386), `*-1` (409), `*-4` (308), `*-1.5` (182), `*-0.5` (162), `*-6` (64), then `5/2.5/8/12/10` in the tens.

**Finding:** Usage clusters tightly on the default Tailwind 4px scale (`0.5–4` dominate, `6/8` for section gaps). No custom spacing tokens warranted — standardize on the existing scale.

**Radius:** `rounded` (300), `rounded-lg` (190), `rounded-full` (60), `rounded-md` (58); `sm/2xl/3xl` negligible. Standardize: controls=`rounded-md`, cards/panels=`rounded-lg`, pills/avatars=`rounded-full`.

**Shadows (tokenized):** `--shadow-{sm,base,md,lg,xl}` defined in `@theme`.

---

## (d) Dark-mode gaps

- **Coverage:** 187 / 191 color-using `.tsx` files include `dark:` variants (2,598 `dark:` occurrences). Strong baseline.
- **Mechanism:** `.dark` remaps the `gray-{50..950}` ramp to VS Code Dark+ values (`ui/src/index.css`). `accent`/semantic ramps are **not** dark-remapped — they read identically in both modes (acceptable for brand/state).
- **Sepia theme:** Tailwind v4 bakes `@theme inline` at build time, so CSS-var overrides don't work — sepia is implemented via `!important` utility-class overrides under `.theme-sepia`. Documented constraint; semantic tokens won't auto-theme under sepia.
- **Concrete gaps (non-test components using color utils with NO `dark:`):**
  - `components/agent-chat/CostPanel.tsx`
  - `components/agent-chat/SessionPicker.tsx`
  - `components/chat-host/ChatHost.tsx`
  - `components/layout/SessionInfo.tsx`
  - `components/layout/SidebarHeader.tsx`
  → Flag for T2/T3 dark-mode pass.

---

## Token reference (source of truth: `ui/src/index.css` `@theme inline`)

- **Brand:** `brand-*` / `accent-*` (sky)
- **State:** `success-*`, `warning-*`, `danger-*`, `info-*`
- **Neutral:** Tailwind `gray-*` (dark-remapped under `.dark`)
- **Fonts:** `font-sans` (Inter), `font-mono` (Fira Code)
- **Shadows:** `shadow-{sm,base,md,lg,xl}`
- **Animations:** `animate-{fadeIn,slideIn,slideInRight,slideOutRight}`

## Hand-off to T2/T3
1. Migrate semantic call sites: `blue→info`, `red→danger`, `green/emerald→success`, `amber/yellow→warning`.
2. Fold stray families (`slate/orange/purple/indigo/stone`) into the nearest token.
3. Close the 5 dark-mode gaps listed above.
4. Standardize radius (`md` controls / `lg` cards) and typography roles (`sm` body / `xs` meta).
