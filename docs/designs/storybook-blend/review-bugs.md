# Bug Review (Post-Fix)

## Previously Fixed Bugs - Verified

1. **create return value** - Confirmed: `handleCreateEmbed` returns `{ success: true, id: data.id }` correctly.
2. **Type annotations** - Confirmed: `Embed`, `EmbedMeta`, `EmbedListItem` types exist in both `src/types.ts` and `ui/src/types/embed.ts`.
3. **Schema types** - Confirmed: schemas use correct JSON Schema `type: 'string'` / `type: 'object'` etc.
4. **API URLs** - Confirmed: MCP tool uses `/api/embed` (POST), `/api/embeds` (GET), `/api/embed/:id` (DELETE), matching the routes in `api.ts`.

---

## NEW Bugs Found

### Bug 1: Embeds not loaded on session load (Important)

- **Severity:** Important
- **File:** `ui/src/hooks/useDataLoader.ts`, line ~127
- **What's wrong:** `loadSessionItems` fetches diagrams, documents, designs, spreadsheets, and snippets but does NOT fetch embeds. The store has `setEmbeds` but it is never called during session load. Embeds only appear via WebSocket `embed_created` events during the current session -- if you reload the page or switch sessions, all embeds disappear from the sidebar.
- **Fix:** Add embeds to the `Promise.all` in `loadSessionItems`:
  ```ts
  const [diagrams, documents, designs, spreadsheets, snippets, embeds] = await Promise.all([
    api.getDiagrams(project, session),
    api.getDocuments(project, session),
    api.getDesigns(project, session),
    api.getSpreadsheets(project, session),
    api.getSnippets(project, session),
    embedsApi.fetchEmbeds(session, project),  // from ui/src/api/embeds.ts
  ]);
  // ...
  setEmbeds(embeds);
  ```
  Also add `setEmbeds` to the `useCallback` dependency array.

### Bug 2: WebSocket broadcast missing embed fields (Important)

- **Severity:** Important
- **File:** `src/routes/api.ts`, the `POST /api/embed` route (around the broadcast block)
- **What's wrong:** The `wsHandler.broadcast` for `embed_created` omits `subtype`, `width`, `height`, and `storybook` fields. The client-side handler in `App.tsx` destructures all these from the message, so they will always be `undefined`. Storybook embeds won't render with the phone frame toggle or metadata until a full reload (which itself is broken per Bug 1).
- **Fix:** Include all embed fields in the broadcast:
  ```ts
  wsHandler.broadcast({
    type: 'embed_created',
    id: embed.id,
    name,
    url: embedUrl,
    subtype: embed.subtype,
    width: embed.width,
    height: embed.height,
    createdAt: embed.createdAt,
    storybook: embed.storybook,
    project: params.project,
    session: params.session,
  });
  ```

### Bug 3: delete_embed MCP handler missing session validation (Minor)

- **Severity:** Minor
- **File:** `src/mcp/setup.ts`, the `case 'delete_embed'` block
- **What's wrong:** The validation checks `if (!project || !id)` but does not check `!session`. The `deleteEmbedSchema` has `required: ['project', 'id']` -- session is not required. If neither `session` nor `todoId` is provided, `session` will be `undefined`, and `handleDeleteEmbed` will call the API with `session=undefined` as a literal query string, which will fail or produce incorrect behavior on the server side.
- **Fix:** Add session to the validation:
  ```ts
  if (!project || !session || !id) throw new Error('Missing required: project, session (or todoId), id');
  ```
  Or add `'session'` to the schema's `required` array (alongside the todoId alternative).

---

## Summary

| # | Severity | File | Issue |
|---|----------|------|-------|
| 1 | Important | `ui/src/hooks/useDataLoader.ts` | Embeds never loaded on session load/refresh |
| 2 | Important | `src/routes/api.ts` | WebSocket broadcast omits subtype/width/height/storybook |
| 3 | Minor | `src/mcp/setup.ts` | delete_embed doesn't validate session param |
