# Wave 3 Implementation

## Tasks
- **code-file-manager** (`src/services/code-file-manager.ts` NEW): CodeFileManager extends ArtifactManager<CodeFile>. Idempotent createCodeFile by filePath, updateContent, markPushed, markSynced, setProposedEdit, clearProposedEdit.
- **snippet-manager-v2** (`src/services/snippet-manager.ts`): Rewrote to extend ArtifactManager<Snippet>. buildRecord handles new flat format, old envelope, and plain-text. Backwards-compat aliases preserved.
- **pseudo-tree-v2** (`PseudoTreeBody.tsx`, `PseudoFileTree.tsx`): Added codeArtifactPaths prop, linkedSet computation, teal dot indicator on matched file nodes.
- **pin-to-artifact** (`promote-code-file.ts`, `CodeFileView.tsx`, `code-api.ts`): Updated promote to call POST /api/code/create; added Pin button to CodeFileView; added /create route handler.
- **cleanup-deletions** (`UnifiedEditor.tsx`, `GlobalSearch.tsx`, `artifactTreeSelectors.ts`): Removed SnippetGroupView inline component, removed envelope.linked checks, updated selectors to use type:'code' filter.

## Verification
TypeScript check: zero new errors across all changed files.
