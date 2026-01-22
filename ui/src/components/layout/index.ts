/**
 * Layout Components
 *
 * Core layout components for the Mermaid Collab UI:
 * - Header: Top navigation bar with logo, theme toggle, session selector
 * - Sidebar: Left sidebar with navigation items, collapsible
 * - SplitPane: Resizable split pane for editor layouts
 * - SessionPanel: Display session information and item list
 */

export { Header } from './Header';
export type { HeaderProps } from './Header';

export { Sidebar } from './Sidebar';
export type { SidebarProps, NavItem } from './Sidebar';

export { SplitPane, ThreeWaySplitPane } from './SplitPane';
export type { SplitPaneProps, ThreeWaySplitPaneProps, SplitDirection } from './SplitPane';

export { SessionPanel } from './SessionPanel';
export type { SessionPanelProps, SessionItem } from './SessionPanel';
