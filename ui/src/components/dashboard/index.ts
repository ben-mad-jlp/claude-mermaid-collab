/**
 * Dashboard Components Exports
 *
 * Main dashboard components for browsing sessions and items:
 * - Dashboard: Main dashboard page with split pane layout
 * - SessionCard: Card displaying session information
 * - ItemCard: Card displaying diagram/document information
 * - ItemGrid: Grid layout for displaying multiple items
 * - TaskGraphCard: Card displaying task execution graph
 * - WorkItemsList: List of work items with task graph toggle
 */

export { Dashboard as default, type DashboardProps } from './Dashboard';
export { SessionCard, type SessionCardProps } from './SessionCard';
export { ItemCard, type ItemCardProps, type ItemType } from './ItemCard';
export { ItemGrid, type ItemGridProps, type GridItem } from './ItemGrid';
export { TaskGraphCard, type TaskGraphCardProps } from './TaskGraphCard';
export { WorkItemsList, type WorkItemsListProps } from './WorkItemsList';
