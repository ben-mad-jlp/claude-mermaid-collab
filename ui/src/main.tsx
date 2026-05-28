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
