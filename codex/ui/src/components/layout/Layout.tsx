/**
 * Layout Component
 *
 * Main layout wrapper for the Codex dashboard.
 * Provides a sidebar navigation and content area structure.
 */

import React from 'react';
import { Sidebar } from './Sidebar';

export interface LayoutProps {
  /** Page content */
  children: React.ReactNode;
  /** Optional additional class name */
  className?: string;
}

/**
 * Layout component - Main wrapper with sidebar and content area
 */
export const Layout: React.FC<LayoutProps> = ({ children, className = '' }) => {
  return (
    <div className={`flex h-screen bg-gray-50 dark:bg-gray-900 ${className}`}>
      {/* Sidebar Navigation */}
      <Sidebar />

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto">
        <div className="h-full">{children}</div>
      </main>
    </div>
  );
};

export default Layout;
