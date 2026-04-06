/**
 * Application Entry Point
 *
 * Main entry file for the Mermaid Collaboration UI application.
 * Handles:
 * - React DOM rendering to the #root element
 * - Strict mode for development warnings
 * - Global styling initialization
 * - Theme detection from system preferences
 * - React Router for navigation between Collab, Onboarding, and Pseudo sections
 *
 * The #root element must exist in index.html
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import App from './App';
import { OnboardingLayout } from './pages/onboarding/OnboardingLayout';
import { BrowseDashboard } from './pages/onboarding/BrowseDashboard';
import { TopicDetail as OnboardingTopicDetail } from './pages/onboarding/TopicDetail';
import { SearchResults } from './pages/onboarding/SearchResults';
import { WelcomeScreen } from './pages/onboarding/WelcomeScreen';
import { OnboardingDashboard } from './pages/onboarding/OnboardingDashboard';
import { TopicGraph } from './pages/onboarding/TopicGraph';
import { TeamDashboard } from './pages/onboarding/TeamDashboard';
import PseudoPage from './pages/pseudo/PseudoPage';
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
        {/* Onboarding Routes */}
        <Route path="/onboarding" element={<OnboardingLayout />}>
          <Route index element={<BrowseDashboard />} />
          <Route path="topic/:name" element={<OnboardingTopicDetail />} />
          <Route path="search" element={<SearchResults />} />
          <Route path="welcome" element={<WelcomeScreen />} />
          <Route path="dashboard" element={<OnboardingDashboard />} />
          <Route path="graph" element={<TopicGraph />} />
          <Route path="team" element={<TeamDashboard />} />
        </Route>

        {/* Pseudo Viewer Routes */}
        <Route path="/pseudo/*" element={<PseudoPage />} />

        {/* Main Collab App - catch all other routes */}
        <Route path="/*" element={<App />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
