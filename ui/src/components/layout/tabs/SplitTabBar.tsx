import React from 'react';
import TabBar from './TabBar';
import PinnedTabBar from './PinnedTabBar';
import type { TabDescriptor } from '../../../stores/tabsStore';

export interface SplitTabBarProps {
  onContextMenu?: (e: React.MouseEvent, tab: TabDescriptor) => void;
  /** Accepted for API compat; ignored in single-pane model. */
  primarySizePercent?: number;
}

export function SplitTabBar({ onContextMenu }: SplitTabBarProps) {
  return (
    <div data-testid="single-tab-bar">
      <PinnedTabBar />
      <TabBar onContextMenu={onContextMenu} />
    </div>
  );
}

SplitTabBar.displayName = 'SplitTabBar';
export default SplitTabBar;
