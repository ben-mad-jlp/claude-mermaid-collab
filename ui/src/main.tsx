/**
 * Application Entry Point
 *
 * Main entry file for the Mermaid Collaboration UI application.
 * Handles:
 * - React DOM rendering to the #root element
 * - Strict mode for development warnings
 * - Global styling initialization
 * - Theme detection from system preferences
 * - React Router for navigation between Collab sections
 *
 * The #root element must exist in index.html
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import App from './App';
import { ServerProvider } from './contexts/ServerContext';
import { SidebarView } from './views/SidebarView';
import './index.css';
import './styles/diagram.css';

/**
 * Recover from stale lazy-chunk loads after a hot-swap deploy.
 *
 * We deploy the UI by atomically swapping `ui/dist` under the live server, which
 * renames the old hashed chunks aside into `dist.bak-*`. Any browser tab that was
 * open before the swap is still running the previous entry bundle, so the first
 * time it lazy-imports a code-split chunk (e.g. mermaid's flowDiagram-v2) it asks
 * for a hash that no longer exists → 404 → "Failed to fetch dynamically imported
 * module" and the diagram fails to render.
 *
 * Vite fires `vite:preloadError` on exactly this failure. The correct recovery is
 * a one-time full reload to pick up the new index + chunk hashes. We guard with a
 * sessionStorage flag so a genuinely-missing chunk (not just stale) can't trigger
 * an infinite reload loop — we reload at most once per tab session, then let the
 * original error surface so it stays visible/debuggable.
 */
const PRELOAD_RELOAD_FLAG = 'vite-preload-reloaded';
window.addEventListener('vite:preloadError', (event) => {
  if (sessionStorage.getItem(PRELOAD_RELOAD_FLAG)) {
    // Already reloaded once this session and still failing — don't loop.
    // Let the error propagate so it's visible rather than silently swallowed.
    return;
  }
  event.preventDefault();
  sessionStorage.setItem(PRELOAD_RELOAD_FLAG, '1');
  window.location.reload();
});

/**
 * Mount the root React component to the DOM
 * Using StrictMode for development warnings and additional checks
 */
const root = document.getElementById('root');

if (!root) {
  throw new Error('Root element (#root) not found in HTML');
}

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        {/* Sidebar View */}
        <Route path="/sidebar" element={<SidebarView />} />

        {/* Main Collab App - catch all other routes */}
        <Route
          path="/*"
          element={
            <ServerProvider>
              <App />
            </ServerProvider>
          }
        />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);

// We mounted successfully — clear the one-shot recovery guard so a LATER hot-swap
// in this same tab session can also auto-recover (the flag only suppresses an
// immediate reload loop when a chunk genuinely can't be fetched).
sessionStorage.removeItem(PRELOAD_RELOAD_FLAG);
