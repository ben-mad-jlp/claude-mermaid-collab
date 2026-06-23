# Wave 1 Implementation

## Tasks
- **types-backend** (`src/types.ts`): Added `SnippetTag`, rewrote `Snippet` with `language`+`tags`, added `ProposedEdit` and `CodeFile` interfaces.
- **types-ui** (`ui/src/types/item.ts`): Added `'code'` to `ItemType`, added `isCodeFile` guard, updated all label/icon/color maps.
- **Cascade fixes**: `snippet-manager.ts` default `language`/`tags`, `App.tsx` typeMap + guard, `ItemCard.tsx` widened icon helper.

## Verification
TypeScript check: zero errors in changed files. Pre-existing unrelated errors unchanged.
