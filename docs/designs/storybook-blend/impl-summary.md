# Implementation Summary: Embed Artifact Type

## Files Created (6)
- `src/services/embed-manager.ts` — EmbedManager class (create, list, get, delete, initialize)
- `src/mcp/tools/embed.ts` — 5 MCP tool schemas + handlers (3 generic + 2 Storybook)
- `ui/src/types/embed.ts` — Frontend Embed + StorybookMetadata interfaces
- `ui/src/components/EmbedViewer.tsx` — Iframe viewer with phone frame toggle, refresh, loading/error states
- `ui/src/api/embeds.ts` — API client (fetchEmbeds, deleteEmbed)

## Files Modified (10)
- `src/types.ts` — Added Embed, EmbedMeta, EmbedListItem interfaces
- `src/mcp/setup.ts` — Registered 5 MCP tools + case handlers
- `src/routes/api.ts` — Added 3 routes (POST, GET, DELETE) + EmbedManager in createManagers()
- `src/websocket/handler.ts` — Added embed_created, embed_deleted to WSMessage union
- `src/services/session-registry.ts` — Added 'embeds' to resolvePath
- `ui/src/stores/sessionStore.ts` — Added embed state, actions, mutual-exclusion
- `ui/src/components/layout/Sidebar.tsx` — Added collapsible Embeds section
- `ui/src/App.tsx` — Added EmbedViewer routing, WS handlers, handleDeleteEmbed
- `ui/src/types/item.ts` — Added 'embed' to ItemType + all Record maps
- `ui/src/components/layout/EditorToolbar.tsx` — Added 'embed' to itemType prop

## MCP Tools Available
1. `create_embed` — Create a generic embed from any URL
2. `list_embeds` — List all embeds in a session
3. `delete_embed` — Delete an embed by ID
4. `create_storybook_embed` — Create embed from a Storybook story ID
5. `list_storybook_stories` — Discover stories from a running Storybook

## Wave Execution
- Wave 1: backend-types, frontend-types ✓
- Wave 2: embed-manager, websocket-events, frontend-store, frontend-api ✓
- Wave 3: api-routes, embed-viewer, sidebar-section, websocket-ui ✓
- Wave 4: mcp-tools-generic, app-routing ✓ (1 fix cycle for ItemType propagation)
- Wave 5: mcp-tools-storybook ✓