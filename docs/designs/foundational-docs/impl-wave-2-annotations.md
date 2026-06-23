# Wave 2 — Phase 1.6 Annotations

## Tasks
- **hardbreak-schema**: Added `hardBreakStyle` $nodeSchema with style attr ('spaces' | 'backslash' | 'html'). parseMarkdown reads `node.data.style`; toMarkdown emits matching literal. Registered in `fidelityPlugins`.
- **trailing-whitespace-join**: Added `join` array to `bulletStringifyOption` returned options — consults `left.data.rawTrailing`, counts newlines minus 1 to derive blank-line count.
- **wire-raw-positions**: Imported `rawPositionsPlugin` in MilkdownEditor.tsx and registered it FIRST in the plugin array (before commonmark / diagramEmbedRemarkPlugin).

## Files changed
- `ui/src/components/editors/milkdown/serializerConfig.ts`
- `ui/src/components/editors/milkdown/MilkdownEditor.tsx`

## Verification
- tsc clean on changed files
- rawPositions: 7/7
- roundTrip: 13/16 (3 failing — final-gate assesses against blueprint criteria)
