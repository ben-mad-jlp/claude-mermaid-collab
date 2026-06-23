# Wave 2 Implementation

## Tasks
- **artifact-manager-base** (`src/services/artifact-manager.ts` NEW): Generic `ArtifactManager<T>` base class extracted from SnippetManager pattern. Abstract `buildRecord` hook, full CRUD + history.
- **unified-editor-routing** (`UnifiedEditor.tsx`): Replaced JSON.parse/linked routing with direct `item.type` switch. `'code'` → CodeEditor with codeFileId, `'snippet'` → SnippetGroupView.
- **code-editor-v2** (`CodeEditor.tsx`): Prop `snippetId` → `codeFileId`, removed `parseLinkedEnvelope` and `buildLinkedSnippetRefs`, replaced envelope useMemo with direct field reads, fixed `proposedEdit` type annotation.
- **snippet-editor-tags** (`SnippetEditor.tsx`): Removed filePath display from toolbar, added SnippetTag interface, tag state, tag strip JSX with file-exists resolution, addTag/removeTag/saveTags handlers.
- **artifact-tree-split** (`ArtifactTree.tsx`): Added `'code-files'` section ID, split snippetNodes into codeFileNodes (type:'code') and snippetNodes (type:'snippet'), added Code Files section render before Snippets.

## Verification
TypeScript check: zero new errors in changed files after one fix (proposedEdit type annotation).
