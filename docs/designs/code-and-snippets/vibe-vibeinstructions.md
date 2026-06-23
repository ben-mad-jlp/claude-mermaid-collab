# Vibe: code-and-snippets

## Goal
[Not yet defined]

## Context
[No context recorded]

## Currently Doing
- Implementing code file / snippet type split (bp-code-snippet-type-split, now archived)
- All 18 blueprint tasks complete and committed (7373e71)
- Post-commit bug fixes: promote-code-file path concatenation → removed node:path import (browser compat), code files now in dedicated codeFiles Zustand store (separate from snippets)
- CodeEditor refactored to use MonacoWrapper directly — no longer wraps SnippetEditor (which would fail since code files aren't in the snippets store)
- PaneContent.tsx: added case 'code' → renders CodeEditor; ArtifactTree uses artifactType 'code' for code file nodes
- Outstanding: uncommitted UI fixes (promote-code-file.ts, api.ts getCodeFiles/getCodeFile, useDataLoader.ts, sessionStore codeFiles slice, ArtifactTree, PaneContent, CodeEditor, SnippetEditor) — needs commit
- Next step: test code file open/edit/push flow end-to-end, then commit the UI fixes

## Agent Mode
Enabled