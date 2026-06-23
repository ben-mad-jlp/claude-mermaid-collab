# Bug: Switching to blueprint/task-graph/task-details tab doesn't load the document

## Repro
Chromedev test `tab-switch-document-load-bug-hunt` opens 4 tabs (3 docs + 1 blueprint `bp-milkdown-parity`) then switches between them using sequential, reverse, ping-pong, and rapid-burst patterns. After every switch the active tab name is compared to `[data-testid=editor-toolbar-title]`.

**Mismatches found (run 2026-04-18T22-27):**
| Switch | active tab | editor shows |
|---|---|---|
| A-seq → idx 3 (bp-milkdown-parity) | bp-milkdown-parity | review-completeness-milkdown-parity |
| B-rev → idx 3 | bp-milkdown-parity | review-completeness-milkdown-parity |
| C-ping → idx 3 | bp-milkdown-parity | design-milkdown-parity |
| D-rapid-burst end (idx 3) | bp-milkdown-parity | review-completeness-milkdown-parity |

Every time the active tab changes to the blueprint tab, the editor continues to render whatever document was selected before. Switches between the three regular document tabs always match correctly.

## Root cause
`ui/src/components/layout/tabs/TabBar.tsx:77-98` — `activateTab` dispatches selection only for `kind === 'embed'`, `'code-file'`, or `'artifact'`:

```ts
if (tab.kind === 'embed') { s.selectEmbed(tab.artifactId); return; }
if (tab.kind === 'code-file') { s.selectPseudoPath(tab.artifactId); return; }
if (tab.kind === 'artifact' && tab.artifactType) {
  switch (tab.artifactType) { /* diagram/document/design/... */ }
}
```

There is no branch for `kind === 'blueprint'`, `'task-graph'`, or `'task-details'` — even though the sidebar creates tabs with those kinds (`ArtifactTree.tsx:54-61` for blueprints, `293` for `__task_graph__`). `setActive(tab.id)` runs so the tab bar highlights correctly, but no `selectXxx` action fires, so the editor keeps the prior selection.

## Fix sketch
Add cases for blueprint / task-graph / task-details in `activateTab`, calling the corresponding selection action on `useSessionStore` (e.g. `selectBlueprint`, `selectTaskGraph`, `selectTaskDetails` — or whatever names the store exposes today).

## Test asset
Saved director test: `tab-switch-document-load-bug-hunt` (session `tab-switch-debug`). Re-run with `run_test testId=tab-switch-document-load-bug-hunt` after the fix — `report.mismatches` should be empty.
