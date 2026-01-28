/**
 * Layout Components
 *
 * Core layout components for the Mermaid Collab UI:
 * - Header: Top navigation bar with logo, theme toggle, session selector
 * - Sidebar: Left sidebar with navigation items, collapsible
 * - SplitPane: Resizable split pane for editor layouts
 * - SessionPanel: Display session information and item list
 * - EditorToolbar: Toolbar for editor with undo/redo, zoom, and overflow menu
 * - BottomTabBar: Fixed bottom navigation bar for mobile with Preview, Chat, Terminal tabs
 * - MobileLayout: Root mobile layout container with header, tab switching, and bottom navigation
 */

export { Header } from './Header';
export type { HeaderProps } from './Header';

export { Sidebar } from './Sidebar';
export type { SidebarProps } from './Sidebar';

export { SplitPane, ThreeWaySplitPane } from './SplitPane';
export type { SplitPaneProps, ThreeWaySplitPaneProps, SplitDirection } from './SplitPane';

export { SessionPanel } from './SessionPanel';
export type { SessionPanelProps, SessionItem } from './SessionPanel';

export { EditorToolbar } from './EditorToolbar';
export type { EditorToolbarProps } from './EditorToolbar';

export { BottomTabBar } from './BottomTabBar';
export type { BottomTabBarProps, MobileTab } from './BottomTabBar';

export { MobileLayout } from './MobileLayout';
export type { MobileLayoutProps, MobileLayoutHandlers } from './MobileLayout';
