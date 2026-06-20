import React from 'react';

export interface PillListProps {
  children: React.ReactNode;
  title?: string;
  emptyLabel?: string;
}

export const PillList: React.FC<PillListProps> = ({ children, title, emptyLabel }) => {
  const hasChildren = React.Children.count(children) > 0;
  return (
    <div className="space-y-2">
      {title && (
        <div className="text-3xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
          {title}
        </div>
      )}
      {hasChildren ? (
        <div className="flex flex-wrap gap-2">{children}</div>
      ) : emptyLabel ? (
        <div className="text-xs text-gray-400 dark:text-gray-500">{emptyLabel}</div>
      ) : null}
    </div>
  );
};

export default PillList;
