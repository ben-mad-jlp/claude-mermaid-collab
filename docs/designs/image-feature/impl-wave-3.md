# Wave 3 Implementation

## Tasks
- **backend-api-routes**: Wired `ImageManager` into `createManagers()`. Added 5 routes to `src/routes/api.ts`: `GET /api/image/:id/content` (streams binary), `GET /api/image/:id` (metadata), `DELETE /api/image/:id`, `POST /api/image` (accepts BOTH multipart and JSON `{name, source}`), `GET /api/images`. Includes a `loadImageSourceToBuffer` helper (data URI / URL / file path) since `loadImageBytes` in design-ai.ts isn't exported. Routes ordered so `:id/content` matches before `:id`.
- **backend-mcp-tools**: Created `src/mcp/tools/image.ts` with Zod-style schemas and fetch-based handlers (`handleCreateImage` posts JSON `{name, source}` to `/api/image`). Wired into `src/mcp/setup.ts`: import, 4 new tool entries in ListToolsRequestSchema, 4 new cases in CallToolRequestSchema.
- **frontend-image-viewer**: Created `ui/src/components/ImageViewer.tsx` with `<img>` bound to `/api/image/:id/content`, metadata (MIME, size, date), download link, error fallback.
- **websocket-image-events**: Added `addImage`/`removeImage` to the `useSessionStore` destructure and selector in `ui/src/App.tsx`. Added `image_created` and `image_deleted` cases in the WebSocket message switch, guarded by session/project match.

## Verification
- Backend tsc: clean in changed files.
- UI tsc: clean in changed files; only the known Wave 1 carry-forward errors remain (now at App.tsx:968, App.tsx:1395, ItemCard.tsx:290 — lines shifted due to App.tsx edits). Still scheduled for fix in Wave 4.
- All 4 tasks marked completed.
