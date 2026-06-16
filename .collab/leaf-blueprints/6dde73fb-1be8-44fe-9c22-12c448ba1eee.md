# [L5] Input forwarding from canvas — Implementation Blueprint

## Goal

Close the interactivity loop for the **streamed** BrowserPanel: attach
pointer/keyboard/wheel listeners to the streamed `<canvas>`, convert
canvas-relative coordinates into normalized frame fractions, and emit
`browser_input` WS messages on the bound server connection. Coalesce
high-frequency `mousemove`/`wheel` with `requestAnimationFrame` to bound the
outbound message rate. The human can then click/type/scroll the streamed page.

## What already exists (L3 + L4) — do NOT re-build

- **Server inbound handler is complete** (`src/server.ts:257-291`,
  `src/services/cdp-input.ts`). It accepts `browser_input` and maps fractions →
  page coords: `x = xFrac * deviceWidth`, `y = offsetTop + yFrac * deviceHeight`.
  It already dispatches every case we need:
  - `action: 'scroll'` → `cdpInput.scroll(client, x, y, deltaX, deltaY)`
  - `action: 'mouse'`, `event: 'click'` → `click`
  - `action: 'mouse'`, `event: 'move'` → `mouseMove`
  - `action: 'mouse'`, `event: 'down' | 'up'` → `mousePress`
  - `action: 'key'` → `cdpInput.key(client, { key, text, code, modifiers, type: keyType })`
- **WS message shape** is the `browser_input` variant of `WSMessage`
  (`src/websocket/handler.ts:140-146`). Client just sends a plain object of this
  shape; the server reads `msg.action / event / xFrac / yFrac / deltaX / deltaY /
  button / key / text / code / modifiers / keyType`.
- **Canvas + frame subscription** live in
  `ui/src/components/browser/StreamedViewport.tsx`. The component already:
  - holds `canvasRef` (the `<canvas>`),
  - sets `canvas.width/height` to the frame's natural pixel size in `paint()`
    (so canvas-internal dims === frame device pixels, aspect === deviceWidth:deviceHeight),
  - accepts an **optional `metaRef: MutableRefObject<FrameMeta | null>`** and
    keeps the latest `FrameMeta` in `lastMetaRef`/`metaRef` on every frame.
- **The bound WS client** is obtained via `getFrameClient(server)`
  (`ui/src/lib/serverFrameWs.ts`) — same shared/cached client the frame
  subscription uses. `WebSocketClient.send(obj)` (`ui/src/lib/websocket.ts:234`)
  serializes and queues if not yet open.

## Key facts that shape the implementation

1. **`object-contain` letterboxing.** The canvas CSS is
   `flex-1 w-full h-full object-contain bg-black` — the frame image is fit
   (not stretched) inside the element, so there are letterbox bands. Mapping a
   pointer event MUST account for this: compute the displayed image box from the
   element rect and the canvas-internal aspect ratio, then derive fractions
   relative to that inner box (clamped to `[0,1]`), NOT relative to the element.
2. **Fractions, not pixels.** The server multiplies by `deviceWidth/Height`
   itself, so the client sends `xFrac`/`yFrac` in `[0,1]`. No need to read
   `FrameMeta` on the client for coordinate math — the aspect comes from
   `canvas.width/height`. (`metaRef` is therefore optional for L5; we rely on
   the canvas dims, which are already the device pixel size.)
3. **Keyboard focus.** A `<canvas>` does not receive `keydown` unless focusable.
   Add `tabIndex={0}` and focus it on `pointerdown` so typing targets the page.
4. **Coalescing.** `mousemove` and `wheel` fire far faster than 60fps. Keep the
   latest pending move position and the accumulated wheel deltas in refs; flush
   at most once per `rAF`. `click`, `pointerdown/up`, and key events are sent
   immediately (low frequency, latency-sensitive).
5. **Prevent default / stop propagation** on the canvas's own listeners so the
   host app (scroll, context menu, browser shortcuts) doesn't also react.

## Files & changes

### CREATE `ui/src/components/browser/streamedInput.ts`

Pure, unit-testable helpers (no React) so the coordinate math and modifier
packing are covered by tests:

- `export interface InputFrac { xFrac: number; yFrac: number }`
- `export function canvasPointToFrac(canvas: HTMLCanvasElement, clientX: number, clientY: number): InputFrac`
  - `const rect = canvas.getBoundingClientRect();`
  - If `canvas.width`/`canvas.height` are 0, return `{xFrac:0,yFrac:0}`.
  - Compute the `object-contain` displayed box:
    `const scale = Math.min(rect.width / canvas.width, rect.height / canvas.height);`
    `const dispW = canvas.width * scale, dispH = canvas.height * scale;`
    `const offX = rect.left + (rect.width - dispW) / 2;`
    `const offY = rect.top + (rect.height - dispH) / 2;`
  - `const xFrac = clamp01((clientX - offX) / dispW);`
    `const yFrac = clamp01((clientY - offY) / dispH);`
  - `clamp01 = (n) => Math.max(0, Math.min(1, n))` (local helper).
- `export function cdpModifiers(e: { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): number`
  - CDP bitmask: `Alt=1, Ctrl=2, Meta=4, Shift=8`. OR the set flags.
- `export function isPrintable(key: string): boolean` — `key.length === 1`
  (used to populate `text` only for character keys; non-printable keys like
  `Enter`/`ArrowLeft` send `key`/`code` with no `text`).

### EDIT `ui/src/components/browser/StreamedViewport.tsx`

1. Add `tabIndex={0}` to the `<canvas>` (focusable for keydown) and keep the
   existing classes; add `outline-none` to avoid a focus ring on the bare canvas.
2. Add a **second `useEffect`** (keyed on `[session, server?.id]`, alongside the
   existing frame-subscription effect) that wires input. It:
   - grabs `const canvas = canvasRef.current; if (!canvas) return;`
   - gets the bound client: `const client = getFrameClient(server);` (already imported).
   - defines `const sessionKey = session;` and a `send` closure:
     `const send = (m) => client.send({ type: 'browser_input', session: sessionKey, ...m });`
   - **Coalescing state** (in `useRef`s declared in the component body, or
     closure vars inside the effect): `pendingMove: InputFrac | null`,
     `wheelAccum: { x: number; y: number; pt: InputFrac } | null`, `rafId: number`.
   - `scheduleFlush()` — if `rafId` unset, `rafId = requestAnimationFrame(flush)`.
   - `flush()` — reset `rafId`; if `pendingMove` send
     `{ action:'mouse', event:'move', xFrac, yFrac }`; if `wheelAccum` send
     `{ action:'scroll', xFrac, yFrac, deltaX, deltaY }`; null both out.
   - **Listeners (attach to `canvas`, `{ passive:false }` for wheel):**
     - `pointermove` → `pendingMove = canvasPointToFrac(canvas, e.clientX, e.clientY); scheduleFlush();`
     - `pointerdown` → `e.preventDefault(); canvas.focus();` then send immediately
       `{ action:'mouse', event:'down', button, ...frac }` where
       `button = ['left','middle','right'][e.button] ?? 'left'`. Also
       `canvas.setPointerCapture?.(e.pointerId)` so drags keep reporting.
     - `pointerup` → send `{ action:'mouse', event:'up', button, ...frac }`.
       (We rely on down/up rather than `click`; the server supports both. Do NOT
       also send a separate `click` — down+up already produce a click on the page.)
     - `contextmenu` → `e.preventDefault()` (let right-button down/up drive it).
     - `wheel` → `e.preventDefault();` accumulate
       `wheelAccum = { pt: frac, x: (prev.x||0)+e.deltaX, y: (prev.y||0)+e.deltaY }; scheduleFlush();`
     - `keydown` / `keyup` → `e.preventDefault();` send
       `{ action:'key', keyType: e.type === 'keydown' ? 'keyDown' : 'keyUp',
          key: e.key, code: e.code, text: isPrintable(e.key) ? e.key : undefined,
          modifiers: cdpModifiers(e) }`.
   - **Cleanup**: `cancelAnimationFrame(rafId)` and `removeEventListener` for
     each. Do NOT disconnect the shared client.
3. Import the new helpers: `import { canvasPointToFrac, cdpModifiers, isPrintable } from './streamedInput';`

> Note on `metaRef`: L5 does not need it for math (aspect comes from canvas
> dims). Leave the existing optional `metaRef` prop intact; do not require it.
> `BrowserPanel.tsx` renders `<StreamedViewport session=… server=… />` and needs
> **no change** — input is self-contained in the canvas component.

### EDIT `ui/src/components/browser/StreamedViewport.test.tsx`

Add focused tests:
- `canvasPointToFrac` letterbox math: stub a canvas with `width/height` and a
  mocked `getBoundingClientRect` (wider-than-tall element with a square frame)
  and assert center → `{0.5,0.5}`, an out-of-image point clamps to `0`/`1`.
- `cdpModifiers` packs Ctrl+Shift → `2|8 === 10`.
- Component-level: render `StreamedViewport`, mock `getFrameClient` to return a
  client with a spied `send`, dispatch a `pointerdown` on the canvas, and assert
  `send` was called with a `{ type:'browser_input', action:'mouse', event:'down' }`
  payload. (Follow the existing mock style already in this test file for
  `getFrameClient`/`client.subscribe`/`onMessage`.)

## Verification

- `npm run test:ci -- ui/src/components/browser/StreamedViewport.test.tsx`
- `cd ui && bunx tsc --noEmit` (UI is **Bun-managed — never `npm install`**).
- Manual: in a streamed session, click a link / type in a field / scroll the
  streamed canvas and confirm the page reacts; confirm move/wheel traffic is
  rAF-bounded (no per-event flood) via the network panel.

## Risks / notes

- The server drops mouse/scroll events when no `FrameMeta` is cached yet
  (`src/server.ts:274`), so very-early input before the first frame is silently
  ignored — acceptable.
- `pointermove` without a button still streams move events (hover). That is
  intended (the page gets hover state); rAF coalescing keeps it cheap.
- Keep `passive:false` on `wheel` and `keydown`/`keyup` so `preventDefault`
  actually suppresses host-app scrolling/shortcuts.

```json
{ "schemaVersion": 1, "estimatedFiles": 3, "estimatedTasks": 3,
  "nonEnumerableFanout": false,
  "filesToCreate": ["ui/src/components/browser/streamedInput.ts"],
  "filesToEdit": ["ui/src/components/browser/StreamedViewport.tsx", "ui/src/components/browser/StreamedViewport.test.tsx"],
  "tasks": [
    { "id": "input-helpers", "files": ["ui/src/components/browser/streamedInput.ts"], "description": "Pure helpers: canvasPointToFrac (object-contain letterbox → [0,1] fractions), cdpModifiers bitmask, isPrintable." },
    { "id": "canvas-listeners", "files": ["ui/src/components/browser/StreamedViewport.tsx"], "description": "Add tabIndex/focus + input useEffect: pointer/wheel/key listeners → browser_input on getFrameClient(server), with rAF coalescing of move/wheel." },
    { "id": "input-tests", "files": ["ui/src/components/browser/StreamedViewport.test.tsx"], "description": "Unit tests for frac/modifier math + component test asserting pointerdown emits a browser_input send." }
  ] }
```
