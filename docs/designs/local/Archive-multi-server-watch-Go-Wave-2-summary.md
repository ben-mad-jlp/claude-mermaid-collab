# Wave 2 Implementation (multi-server-watch)

## Tasks
- **watch-ipc** — `desktop/src/preload/index.ts`: added `mc.setWatchedServers(ids)` + `mc.onWatchEvent(cb)` (subscribes `mc:watch-event`, returns unsubscribe). `desktop/src/main/index.ts`: imported WatchAggregator; module-scope `let aggregator`; IPC `mc:setWatchedServers` resolves ids→creds via `store.get(id)` ({id,host,port,token}) → `aggregator.setWatched(ups)`; instantiate `aggregator = new WatchAggregator(e => mainWindow?.webContents.send('mc:watch-event', e))` after registerIpc(); `aggregator?.stop()` in before-quit.
- **switcher-multiselect** — `ui/src/components/ServerSwitcher.tsx`: imported `useWatchStore`; reactive `watchedIds` + `isWatched`; per-row 👁 toggle (all rows) calling `toggleWatched(s.id)` with `stopPropagation` (independent of the ✓ active selection, dim/filled by watched state); 👁 count badge in the trigger button.

## Verification
- desktop tsc: index.ts + preload clean.
- ui tsc: ServerSwitcher clean.
- Tokens resolved in main only (renderer sends ids); forward sink = webContents.send.

## Wave TSC
Clean across both packages.
