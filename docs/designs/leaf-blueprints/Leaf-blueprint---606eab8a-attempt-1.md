# Blueprint — [L3] Input plumbing: shared `cdp-input.ts` + `browser_input` WS

**Todo:** `606eab8a-0860-4900-b4e6-5c9412fccb5f`
**Epic:** `2202faef-64a8-4bef-a285-343af62f21e5`
**Sequencing:** after L2 (Frame transport over WS) — both touch `src/websocket/handler.ts` and the
`FrameMeta` shape (`offsetTop`/`pageScaleFactor`/`deviceWidth`/`deviceHeight`) that L2 introduced.

## Goal

1. Extract the inline CDP `Input.dispatchMouseEvent` / `Input.dispatchKeyEvent` logic out of
   `src/mcp/tools/browser.ts` into a new shared module `src/services/cdp-input.ts` so the MCP
   `browser_*` tools and the live streamed panel use **one** implementation. Pure refactor for the
   tools — **no behavioral change** to `browser_press_key`, `browser_type_text`, `browser_hover`,
   `browser_drag`.
2. Add an inbound `browser_input` WS message (mouse / key / scroll) carried on the existing
   WebSocket. The handler resolves the session's CDP target and dispatches via `cdp-input.ts`.
3. Translate canvas-relative normalized fractions → page coords using the latest L2 frame metadata
   (`offsetTop`, `deviceWidth`, `deviceHeight`, `pageScaleFactor`) so clicks land where the user sees
   them in the panel.

## Files

### CREATE — `src/services/cdp-input.ts`

Client-first helpers (caller owns the CDP connection lifecycle, i.e. the `client` from
`withCDPSession`). Export the functions the tools already need, **plus** the richer primitives the
panel path needs:

- `pressKey(client, key)` — keyDown + keyUp. (replaces browser.ts:163-164 inline body)
- `typeText(client, text)` — per-char keyDown/keyUp with `text` + `key`. (browser.ts:243-244)
- `mouseMove(client, x, y)` — `mouseMoved`. (browser.ts:177)
- `drag(client, sx, sy, tx, ty)` — pressed → moved → released, left button. (browser.ts:237)
- `click(client, x, y, button='left')` — mousePressed + mouseReleased, clickCount 1. (panel click)
- `scroll(client, x, y, deltaX, deltaY)` — `mouseWheel`. (panel scroll)
- `key(client, {key, text?, code?, modifiers?, type?})` — richer key path for the panel: `type`
  `'keyDown'|'keyUp'|'char'`; default sends keyDown+keyUp; supports modifier bitmask + `code`.
- `mousePress(client, x, y, 'down'|'up', button='left')` — single press/release for pointer
  down/up streamed from the panel.

All take `client: any` (matches existing `withCDPSession` callback typing in browser.ts).

### EDIT — `src/mcp/tools/browser.ts`

- Add import: `import { pressKey, typeText, mouseMove, drag } from '../../services/cdp-input.js';`
  (alongside the existing `cdp-session.js` import at the top).
- `browserPressKey` (≈162-166): replace inline `dispatchKeyEvent` pair with `await pressKey(client, key)`.
- `browserHover` (≈169-179): keep DOM box-model lookup; replace the inline `mouseMoved` dispatch
  (line 177) with `await mouseMove(client, x, y)`.
- `browserDrag` (≈225-239): keep DOM box-model lookups; replace the 3 inline mouse dispatches
  (≈237) with `await drag(client, sx, sy, tx, ty)`.
- `browserTypeText` (≈242-246): replace inline per-char loop with `await typeText(client, text)`.
- Do **not** touch `browserClick`/`browserFill`/`browserSelect`/`browserFillForm` — those use
  `el.click()` / `Runtime.callFunctionOn`, not `Input.*`, so they are out of scope.

Net: identical CDP wire behavior for the tools; logic now lives in the shared module.

### EDIT — `src/websocket/handler.ts`

- Add a `browser_input` variant to the `WSMessage` union (near the L2 `browser_frame` variant ≈131):
  `{ type: 'browser_input'; session: string; action: 'mouse'|'key'|'scroll'; xFrac?; yFrac?;
  event?: 'down'|'up'|'move'|'click'; button?: 'left'|'middle'|'right'; deltaX?; deltaY?;
  key?; text?; code?; modifiers?; keyType?: 'keyDown'|'keyUp'|'char' }`. Mouse/scroll coords are
  normalized fractions [0,1] relative to the rendered frame box (mapped server-side).
- Export `type BrowserInputMsg = Extract<WSMessage, { type: 'browser_input' }>`.
- Add field `private onBrowserInput: ((msg: BrowserInputMsg) => void) | null = null;` and setter
  `setOnBrowserInput(cb)` (mirrors `setOnChannelSubscriptionChange`).
- In `handleMessage`, add an `else if (data.type === 'browser_input') { this.onBrowserInput?.(data); }`
  branch (after the `peer_registry` branch ≈278).

### EDIT — `src/server.ts`

Inside the existing `if (screencastService) { … }` block (the L2 subscription wiring ≈214):

- Add `interface FrameMeta { offsetTop; pageScaleFactor; deviceWidth; deviceHeight }` and
  `const lastFrameMeta = new Map<string, FrameMeta>();`.
- In the screencast sink (the `setOnChannelSubscriptionChange` callback that already calls
  `wsHandler.broadcastBrowserFrame`), also `lastFrameMeta.set(frame.sessionName, {…})` from
  `frame.metadata`; on last-unsubscribe (`count === 0`) `lastFrameMeta.delete(session)`.
- Register `wsHandler.setOnBrowserInput(async (msg) => { … })`:
  - dynamic-import `withCDPSession` + `CDP_PORT` from `./services/cdp-session.js` and the
    `./services/cdp-input.js` module (consistent with other lazy imports in server.ts).
  - `const meta = lastFrameMeta.get(msg.session);`
  - `withCDPSession(msg.session, cdpPort, async (client) => { … })`:
    - `action === 'key'` → `cdpInput.key(client, { key, text, code, modifiers, type: keyType })`;
      key events need no coords, dispatch immediately.
    - else (mouse/scroll) require `meta`; if absent, **drop** the event (no frame seen yet).
    - Map: `x = (xFrac ?? 0) * meta.deviceWidth`; `y = meta.offsetTop + (yFrac ?? 0) * meta.deviceHeight`.
      (Comment: if `pageScaleFactor !== 1` for a future pinch-zoom case, divide mapped coords by it.)
    - `scroll` → `cdpInput.scroll(client, x, y, deltaX ?? 0, deltaY ?? 0)`.
    - `event === 'click'` → `cdpInput.click(client, x, y, button ?? 'left')`.
    - `event === 'move'` → `cdpInput.mouseMove(client, x, y)`.
    - `down`/`up` → `cdpInput.mousePress(client, x, y, event, button ?? 'left')`.
  - wrap in try/catch → `console.error('… browser_input dispatch failed …')`; never throw out of the
    WS callback.

## Tests

Extend `src/__tests__/websocket-handler.test.ts` (already exercises `browser_frame` meta ≈572): add a
case that a `browser_input` message routes to the registered `onBrowserInput` callback with the parsed
payload. Coord-mapping math is covered by inspection (pure arithmetic in the server callback).

## Verification

- `npm run test:ci -- src/__tests__/websocket-handler.test.ts`
- `tsc` clean (the new union member + setter typecheck).
- Manual: in `streamed-panel` mode, click/scroll/type in the live panel and confirm the action lands
  at the cursor (offsetTop accounts for the page's top chrome).

## Risks / notes

- `lastFrameMeta` must be cleared on unsubscribe to avoid mapping against a stale layout.
- Key events bypass the `meta` guard (no coords) so typing works even before the first frame arrives.
- Pure refactor of the tools must preserve exact CDP event shapes (button, clickCount, text/key
  fields) — verified field-for-field against browser.ts lines 163-164, 177, 237, 243-244.

```json
{ "schemaVersion": 1, "estimatedFiles": 4, "estimatedTasks": 4,
  "nonEnumerableFanout": false,
  "filesToCreate": ["src/services/cdp-input.ts"],
  "filesToEdit": ["src/mcp/tools/browser.ts", "src/websocket/handler.ts", "src/server.ts"],
  "tasks": [
    { "id": "cdp-input-module", "files": ["src/services/cdp-input.ts"], "description": "Create shared CDP input helpers (pressKey/typeText/mouseMove/drag/click/scroll/key/mousePress)" },
    { "id": "browser-tools-reuse", "files": ["src/mcp/tools/browser.ts"], "description": "Refactor browser_press_key/hover/drag/type_text to call cdp-input.ts (no behavior change)" },
    { "id": "ws-browser-input-msg", "files": ["src/websocket/handler.ts"], "description": "Add browser_input WSMessage variant, BrowserInputMsg, onBrowserInput setter + handleMessage branch" },
    { "id": "server-input-dispatch", "files": ["src/server.ts"], "description": "Cache FrameMeta per session and dispatch browser_input via cdp-input with frac→page coord mapping" }
  ] }
```
