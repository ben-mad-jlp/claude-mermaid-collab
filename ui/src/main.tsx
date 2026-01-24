/**
 * Application Entry Point
 *
 * Main entry file for the Mermaid Collaboration UI application.
 * Handles:
 * - React DOM rendering to the #root element
 * - Strict mode for development warnings
 * - Global styling initialization
 * - Theme detection from system preferences
 *
 * The #root element must exist in index.html
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
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
    <App />
  </React.StrictMode>
);
