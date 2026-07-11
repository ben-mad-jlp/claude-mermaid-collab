# Blueprint — [L4] Streamed BrowserPanel: canvas renderer + mode detection

Leaf: `c256b958-0829-4246-9089-8552845ee2ab`

## Goal

When the server advertises **streamed-panel** mode (a capability flag, NOT
`window.mc` sniffing), `BrowserPanel` must render the live browser into a
`<canvas>` fed by base64 JPEG frames over WebSocket, instead of the empty
placeholder `<div>` that a native Electron `WebContentsView` overlays. In
streamed mode the rAF `setBounds` loop is dead weight (there is no native
overlay to position) and must be short-circuited. The existing tab strip /
address bar / nav chrome are mode-agnostic (they dispatch `browserStore`
actions) and stay untouched.

Multi-server constraint **C3**: the frame subscription MUST be bound to the
specific server connection the active session belongs to — never a process-wide
singleton WS — mirroring the existing per-server artifact routing.

## Existing state / prior art

This leaf builds on L1–L3 work already in the worktree. These collaborators
already exist and are the contract this leaf consumes:

- `ui/src/hooks/useBrowserMode.ts` — `useBrowserMode(server?): 'streamed' | 'native' | 'unknown'`.
  Fetches `GET /api/browser/mode` (via `mc.invokeOnServer(server.id, …)` when
  available, else same-origin `fetch`), reads `data.streamed === true`. Falls
  back to `'native'` on any error. Re-runs on `server.id/host/port` change.
- `ui/src/lib/serverFrameWs.ts` — `getFrameClient(server?)` returns the
  `WebSocketClient` bound to that server (same-origin → shared singleton;
  cross-origin → per-`server.id` cached client). This is the C3 resolver.
- `ui/src/contexts/ServerContext` — `useServers()` → `{ servers }`, `ServerInfo`.
- `ui/src/stores/sessionStore` — `useSessionStore`, `currentSession` (has
  `.name` and `.serverId`).
- `WebSocketClient` (`ui/src/lib/websocket.ts`) — `connect()`, `subscribe(ch)`,
  `unsubscribe(ch)`, `onMessage(cb) → { unsubscribe() }`. Frames arrive as
  messages `{ type:'browser_frame', session, data /* b64 jpeg */, meta }`.

## Files to touch

### 1. CREATE `ui/src/components/browser/StreamedViewport.tsx`

The canvas renderer + per-server frame subscriber. Self-contained so
`BrowserPanel` stays a thin mode switch.

Shape:

```tsx
import { useRef, useEffect } from 'react';
import type { ServerInfo } from '@/contexts/ServerContext';
import { getFrameClient } from '@/lib/serverFrameWs';

export interface FrameMeta {
  offsetTop: number;
  pageScaleFactor: number;
  deviceWidth: number;
  deviceHeight: number;
  timestamp?: number;
}

export function StreamedViewport({
  session,
  server,
  metaRef,            // optional out-param: latest frame meta for L5 coord mapping
}: {
  session: string;
  server?: ServerInfo;
  metaRef?: React.MutableRefObject<FrameMeta | null>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  function paint(dataB64: string) {
    // MVP path: img.src = 'data:image/jpeg;base64,'+data, onload → drawImage.
    // (createImageBitmap is the upgrade; img is fine for MVP.)
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    if (!imgRef.current) imgRef.current = new Image();
    const img = imgRef.current;
    img.onload = () => {
      if (!canvasRef.current) return;
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      ctx.drawImage(img, 0, 0);
    };
    img.src = 'data:image/jpeg;base64,' + dataB64;
  }

  useEffect(() => {
    const client = getFrameClient(server);   // C3: per-server, not singleton
    let mounted = true;
    let sub: { unsubscribe(): void } | null = null;
    client.connect().then(() => {
      if (!mounted) return;
      client.subscribe('browser:' + session);
      sub = client.onMessage((msg) => {
        if (msg.type !== 'browser_frame') return;
        const frame = msg as unknown as { session: string; data: string; meta: FrameMeta };
        if (frame.session !== session) return;   // ignore other sessions on shared client
        if (metaRef) metaRef.current = frame.meta;
        paint(frame.data);
      });
    });
    return () => {
      mounted = false;
      sub?.unsubscribe();
      client.unsubscribe('browser:' + session);
      // Do NOT disconnect() — the client is shared across the app.
    };
  }, [session, server?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return <canvas ref={canvasRef} className="flex-1 w-full h-full object-contain bg-black" />;
}
```

Key correctness points:
- Subscribe channel is exactly `browser:<session>` using `session.name`.
- Guard `frame.session !== session` — a same-origin shared client may carry
  frames for other sessions.
- Cleanup unsubscribes the channel + message handler but NEVER disconnects the
  shared client.
- Effect deps `[session, server?.id]` so switching session/server re-binds.
- `metaRef` keeps the latest `FrameMeta` for L5 coord mapping; optional.

### 2. EDIT `ui/src/components/browser/BrowserPanel.tsx`

a. **Imports** (top): add
   `import { StreamedViewport } from '@/components/browser/StreamedViewport';`,
   `import { useBrowserMode } from '@/hooks/useBrowserMode';`,
   `import { useServers } from '@/contexts/ServerContext';`,
   `import { useSessionStore } from '@/stores/sessionStore';`.

b. **Resolve mode** (after the store selectors, ~line 41):
   ```tsx
   const currentSession = useSessionStore((s) => s.currentSession);
   const { servers } = useServers();
   const server = servers.find((s) => s.id === currentSession?.serverId);
   const mode = useBrowserMode(server);
   const streamed = mode === 'streamed';
   ```

c. **Short-circuit the rAF `setBounds` loop** (the `useEffect` at lines 71–117):
   add `if (streamed) return;` as the FIRST statement of the effect body and add
   `streamed` to the dep array. In streamed mode there is no native overlay, so
   no bounds tracking. Keeping the effect mounted but early-returning is simpler
   and lint-clean than conditionally creating it.

d. **Swap the viewport node** (the `<div ref={viewportRef} className="flex-1" />`
   at ~line 274):
   ```tsx
   {streamed && currentSession
     ? <StreamedViewport session={currentSession.name} server={server} />
     : <div ref={viewportRef} className="flex-1" />}
   ```
   The native placeholder `<div ref={viewportRef}>` is retained for native mode
   and as fallback when there's no current session.

e. Leave the tab strip, nav buttons, address bar, zoom, devtools controls
   EXACTLY as-is — mode-agnostic `browserStore` dispatchers. `embedded` /
   `ResizableColumn` / `viewerVisible` layout branches unchanged.

### 3. CREATE `ui/src/components/browser/StreamedViewport.test.tsx`

UI test (`npm run test:ci`). Cover:
- Mounting subscribes to `browser:<session>` on the client from `getFrameClient`
  (mock the module; assert `subscribe` called with the right channel).
- A delivered `browser_frame` message paints (assert `Image.src` set to
  `data:image/jpeg;base64,…`, or `drawImage` invoked via a canvas-ctx mock).
- Frames for a different `session` are ignored.
- Unmount calls `unsubscribe` on the channel + message-sub but NOT `disconnect`
  (C3: shared client preserved).

## Out of scope (later leaves)
- L5 coordinate mapping / input forwarding (this leaf only stashes `metaRef`).
- `createImageBitmap` performance upgrade (MVP uses `img.src`).
- Server-side `/api/browser/mode` endpoint and frame producer (L1/L2/L3).
- Cross-origin WS auth-header gap (documented in `serverFrameWs.ts`; deferred).

## Verification
- `npm run test:ci -- ui/src/components/browser/StreamedViewport.test.tsx`
- `cd ui && bunx tsc --noEmit` (project typecheck) — no new TS errors.
- Manual: native server → placeholder `<div>` + rAF loop still runs; streamed
  server → `<canvas>` paints frames, no `setBounds` calls.

```json
{ "schemaVersion": 1, "estimatedFiles": 3, "estimatedTasks": 4,
  "nonEnumerableFanout": false,
  "filesToCreate": ["ui/src/components/browser/StreamedViewport.tsx", "ui/src/components/browser/StreamedViewport.test.tsx"],
  "filesToEdit": ["ui/src/components/browser/BrowserPanel.tsx"],
  "tasks": [
    { "id": "streamed-viewport", "files": ["ui/src/components/browser/StreamedViewport.tsx"], "description": "Canvas renderer: per-server getFrameClient, subscribe browser:<session>, paint b64 jpeg frames, stash FrameMeta, clean unsubscribe without disconnect" },
    { "id": "browserpanel-mode-branch", "files": ["ui/src/components/browser/BrowserPanel.tsx"], "description": "Resolve server+mode via useBrowserMode; early-return rAF setBounds loop when streamed; swap placeholder div for StreamedViewport in streamed mode" },
    { "id": "viewport-test", "files": ["ui/src/components/browser/StreamedViewport.test.tsx"], "description": "Tests: subscribe channel, paint on frame, ignore other sessions, unsubscribe-not-disconnect on unmount" },
    { "id": "typecheck-verify", "files": ["ui/src/components/browser/BrowserPanel.tsx"], "description": "Run test:ci + typecheck; confirm native mode unchanged and streamed mode paints" }
  ] }
```
