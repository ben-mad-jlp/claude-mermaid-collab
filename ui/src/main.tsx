/**
 * Application Entry Point
 *
 * Main entry file for the Mermaid Collaboration UI application.
 * Handles:
 * - React DOM rendering to the #root element
 * - Strict mode for development warnings
 * - Global styling initialization
 * - Theme detection from system preferences
 * - React Router for navigation between Collab and Kodex sections
 *
 * The #root element must exist in index.html
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import App from './App';
import { KodexLayout } from './pages/kodex/KodexLayout';
import { Dashboard } from './pages/kodex/Dashboard';
import { Topics } from './pages/kodex/Topics';
import { TopicDetail } from './pages/kodex/TopicDetail';
import { Drafts } from './pages/kodex/Drafts';
import { Flags } from './pages/kodex/Flags';
import { Graph } from './pages/kodex/Graph';
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
        {/* Kodex Routes */}
        <Route path="/kodex" element={<KodexLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="topics" element={<Topics />} />
          <Route path="topics/:name" element={<TopicDetail />} />
          <Route path="graph" element={<Graph />} />
          <Route path="drafts" element={<Drafts />} />
          <Route path="flags" element={<Flags />} />
        </Route>

        {/* Main Collab App - catch all other routes */}
        <Route path="/*" element={<App />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
