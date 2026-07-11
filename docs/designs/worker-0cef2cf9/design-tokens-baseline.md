# Design Tokens Baseline (T1)

Visual audit of `ui/src` (635 TS/TSX files) + the canonical token set that T2/T3 will refactor call sites onto.

**Stack:** Tailwind **v4** — there is no `tailwind.config`. The theme lives in `@theme inline { … }` inside `ui/src/index.css`. Dark mode = `.dark` class remapping the gray scale; sepia = `.theme-sepia` utility overrides. **Decision honored: Tailwind theme tokens, not a parallel CSS-var system.**

---

## (a) Typography — sizes actually in use

| Class | Uses | Verdict |
|-------|------|---------|
| `text-xs`  | 386 | core |
| `text-sm`  | 386 | core |
| `text-lg`  | 26  | keep |
| `text-base`| 18  | keep |
| `text-xl`  | 9   | keep |
| `text-3xl` | 7   | keep |
| `text-2xl` | 6   | keep |

Sanctioned scale: `xs, sm, base, lg, xl, 2xl, 3xl`. No 4xl/5xl in use — do not introduce. UI is overwhelmingly `xs`/`sm` driven (dense tooling UI).

### Font weights

| Class | Uses |
|-------|------|
| `font-medium`   | 252 |
| `font-semibold` | 114 |
| `font-bold`     | 40  |
| `font-normal`   | 18  |

Sanctioned weights: `normal, medium, semibold, bold`. Drop everything else from new code.

---

## (b) Color usage

### Brand (`accent-*`) — already tokenized
`accent-50…900` defined in `@theme`. Full ramp in use (heaviest: `bg-accent-900`×26, `bg-accent-100`×20, `text-accent-700`×19). Keep as the brand ramp.

### Gray scale — fully remapped in dark mode
`gray-50…950` in use. Heaviest: `gray-700`×650, `gray-400`×497, `gray-600`×406. `.dark` remaps `gray-50…950` to a VS Code Dark+ palette. **Anomaly:** one stray `gray-750` and one `gray-950` use — `gray-750` is not a Tailwind step and is NOT remapped in dark mode (a real gap; flag for T2/T3 to replace with `gray-700`/`gray-800`).

### Semantic / state colors — ad-hoc, NOT tokenized (the main gap)
Raw palette families used for state, with no semantic names:

| Family | Uses | Intended role |
|--------|------|---------------|
| blue   | 423 | info / selected |
| red    | 325 | danger / error / destructive |
| green  | 158 | success |
| amber  | 113 | warning / active-session |
| yellow | 85  | warning (overlaps amber) |
| slate  | 60  | neutral (overlaps gray) |
| orange | 32  | warning (overlaps amber) |
| purple | 20  | accent-secondary |
| emerald| 19  | success (overlaps green) |
| stone  | 15  | sepia-adjacent neutral |
| indigo | 9   | info (overlaps blue) |
| cyan   | 2   | — |

**Overlap problem:** success is split green/emerald; warning is split amber/yellow/orange; info is split blue/indigo; neutral is split gray/slate/stone. T2/T3 should collapse each cluster onto one semantic token.

### Arbitrary hex (escape hatches) — minimal
Only sepia-theme literals: `bg-[#DFCA88]`×3, `text-[#586E75]`×2, `border-[#B58900]`×1, `bg-[#D4B96A]`×1. Acceptable; leave to the sepia theme.

---

## (c) Spacing / padding patterns

Padding (top): `py-2`×186, `px-3`×184, `px-2`×166, `py-1`×155, `px-4`×149, `py-0.5`×100, `py-1.5`×76, `p-4`×52, `px-1`×51, `p-2`×39, `p-3`×31.

Gap: `gap-2`×168, `gap-1`×67, `gap-3`×53, `gap-1.5`×42, `gap-0.5`×18, `gap-4`×11.

Radius: `rounded`×293, `rounded-lg`×190, `rounded-full`×60, `rounded-md`×58. (`rounded-2xl`/`3xl` ≤1 each.)

Sanctioned spacing steps: `0.5, 1, 1.5, 2, 3, 4, 6`. Sanctioned radii: `DEFAULT, md, lg, full`. Tailwind v4 already ships the full spacing/radius scales — no need to redefine; just constrain new code to this subset.

---

## (d) Dark-mode gaps

Coverage is **strong**: 2596 `dark:` variants. Only 2 files use `bg-white` with no `dark:` in-file — one is a test (`PropertiesPane.test.tsx`), the other is `components/chat-host/ChatHost.tsx` (real gap → T2/T3). Plus the `gray-750` stray noted above.

---

## Token plan applied to `@theme` (this todo)

Added a **semantic color layer** to `ui/src/index.css` `@theme` block — additive aliases that map onto existing ramps, so nothing re-renders until T2/T3 migrate call sites:

- `--color-success-*` → green ramp
- `--color-warning-*` → amber ramp
- `--color-danger-*`  → red ramp
- `--color-info-*`    → blue ramp
- `--color-brand-*`   → alias of `accent-*`

The typography scale (`text-xs…3xl`) and spacing/radius subsets are documented above as the sanctioned baseline; Tailwind v4 defaults already provide them, so they are NOT redefined (redefining would risk silent visual drift). T2/T3 own the call-site migration onto the semantic tokens.
