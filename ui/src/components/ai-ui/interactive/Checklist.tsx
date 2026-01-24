import React, { useState, useCallback, ReactNode } from 'react';

export interface ChecklistSubItem {
  id: string;
  label: string;
  completed?: boolean;
}

export interface ChecklistItem {
  id: string;
  label: string;
  completed?: boolean;
  required?: boolean;
  subItems?: ChecklistSubItem[];
}

export interface ChecklistProps {
  items: ChecklistItem[];
  allowCheck?: boolean;
  showProgress?: boolean;
  allRequired?: boolean;
  onItemChange?: (itemId: string, completed: boolean) => void;
  onSubItemChange?: (itemId: string, subItemId: string, completed: boolean) => void;
  className?: string;
}

/**
 * Checklist Component
 * Trackable task list with completion status and optional sub-items
 *
 * Features:
 * - Main items and optional sub-items
 * - Visual completion tracking
 * - Progress indicator
 * - Required items highlighting
 * - Expandable sections
 * - Dark mode support
 */
export const Checklist: React.FC<ChecklistProps> = ({
  items,
  allowCheck = true,
  showProgress = true,
  allRequired = false,
  onItemChange,
  onSubItemChange,
  className = '',
}) => {
  // Normalize items to ensure each has a unique id
  const normalizedItems = React.useMemo(() =>
    (items || []).map((item, index) => ({
      ...item,
      id: item.id || `item-${index}`,
    })),
    [items]
  );

  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [itemStates, setItemStates] = useState<Record<string, boolean>>(
    normalizedItems.reduce((acc, item) => ({ ...acc, [item.id]: item.completed || false }), {})
  );
  const [subItemStates, setSubItemStates] = useState<Record<string, Record<string, boolean>>>(
    normalizedItems.reduce((acc, item) => {
      if (item.subItems) {
        acc[item.id] = item.subItems.reduce(
          (subAcc, subItem, subIndex) => ({
            ...subAcc,
            [subItem.id || `subitem-${subIndex}`]: subItem.completed || false
          }),
          {}
        );
      }
      return acc;
    }, {} as Record<string, Record<string, boolean>>)
  );

  const toggleItem = useCallback(
    (itemId: string) => {
      setItemStates((prev) => {
        const updated = { ...prev, [itemId]: !prev[itemId] };
        onItemChange?.(itemId, updated[itemId]);
        return updated;
      });
    },
    [onItemChange]
  );

  const toggleSubItem = useCallback(
    (itemId: string, subItemId: string) => {
      setSubItemStates((prev) => {
        const updated = {
          ...prev,
          [itemId]: {
            ...prev[itemId],
            [subItemId]: !prev[itemId]?.[subItemId],
          },
        };
        onSubItemChange?.(itemId, subItemId, updated[itemId][subItemId]);
        return updated;
      });
    },
    [onSubItemChange]
  );

  const toggleExpand = (itemId: string) => {
    setExpandedItems((prev) => {
      const updated = new Set(prev);
      if (updated.has(itemId)) {
        updated.delete(itemId);
      } else {
        updated.add(itemId);
      }
      return updated;
    });
  };

  // Calculate progress
  const totalItems = normalizedItems.length;
  const completedItems = normalizedItems.filter((item) => itemStates[item.id]).length;
  const completionPercentage = (completedItems / totalItems) * 100;

  // Calculate required items
  const requiredItems = normalizedItems.filter((item) => item.required || allRequired);
  const completedRequiredItems = requiredItems.filter((item) => itemStates[item.id]).length;
  const allRequiredComplete = completedRequiredItems === requiredItems.length;

  return (
    <div className={`checklist w-full ${className}`}>
      {/* Progress Section */}
      {showProgress && (
        <div className="mb-6 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
          <div className="flex justify-between items-center mb-2">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Progress</h3>
            <span className="text-sm text-gray-600 dark:text-gray-400">
              {completedItems}/{totalItems}
            </span>
          </div>

          <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden mb-3">
            <div
              className="h-full bg-green-500 dark:bg-green-600 transition-all duration-300"
              style={{ width: `${completionPercentage}%` }}
              role="progressbar"
              aria-valuenow={Math.round(completionPercentage)}
              aria-valuemin={0}
              aria-valuemax={100}
            />
          </div>

          {requiredItems.length > 0 && (
            <p className="text-xs text-gray-600 dark:text-gray-400">
              Required items:{' '}
              <span className={allRequiredComplete ? 'text-green-600 dark:text-green-500' : 'text-orange-600 dark:text-orange-500'}>
                {completedRequiredItems}/{requiredItems.length}
              </span>
            </p>
          )}
        </div>
      )}

      {/* Items List */}
      <div className="space-y-2">
        {normalizedItems.map((item) => {
          const isCompleted = itemStates[item.id];
          const hasSubItems = item.subItems && item.subItems.length > 0;
          const isExpanded = expandedItems.has(item.id);
          const isRequired = item.required || allRequired;

          return (
            <div key={item.id}>
              {/* Main Item */}
              <div
                className={`flex items-center gap-3 p-3 rounded-lg border transition-all ${
                  isCompleted
                    ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
                    : isRequired
                    ? 'bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800'
                    : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                }`}
              >
                {/* Expand/Collapse Button */}
                {hasSubItems && (
                  <button
                    onClick={() => toggleExpand(item.id)}
                    className="p-1 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
                    aria-expanded={isExpanded}
                    aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${item.label}`}
                  >
                    {isExpanded ? (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                      </svg>
                    ) : (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    )}
                  </button>
                )}
                {!hasSubItems && <div className="w-6" />}

                {/* Checkbox */}
                {allowCheck && (
                  <button
                    onClick={() => toggleItem(item.id)}
                    className={`flex-shrink-0 w-5 h-5 rounded border-2 transition-all flex items-center justify-center ${
                      isCompleted
                        ? 'bg-green-500 dark:bg-green-600 border-green-500 dark:border-green-600'
                        : isRequired
                        ? 'bg-orange-100 dark:bg-orange-900 border-orange-300 dark:border-orange-700 hover:border-orange-400 dark:hover:border-orange-600'
                        : 'bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500'
                    }`}
                    aria-label={`Toggle ${item.label}`}
                    aria-pressed={isCompleted}
                  >
                    {isCompleted && (
                      <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    )}
                  </button>
                )}

                {/* Label */}
                <span
                  className={`flex-1 ${
                    isCompleted
                      ? 'text-gray-500 dark:text-gray-400 line-through'
                      : 'text-gray-900 dark:text-white'
                  }`}
                >
                  {item.label}
                  {isRequired && (
                    <span className="ml-2 text-xs font-semibold text-orange-600 dark:text-orange-500">
                      Required
                    </span>
                  )}
                </span>
              </div>

              {/* Sub-items */}
              {hasSubItems && isExpanded && (
                <div className="ml-8 mt-2 space-y-2">
                  {item.subItems!.map((subItem) => {
                    const isSubCompleted = subItemStates[item.id]?.[subItem.id] || false;
                    return (
                      <div
                        key={subItem.id}
                        className={`flex items-center gap-3 p-2 rounded-lg border transition-all ${
                          isSubCompleted
                            ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
                            : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                        }`}
                      >
                        {/* Checkbox */}
                        {allowCheck && (
                          <button
                            onClick={() => toggleSubItem(item.id, subItem.id)}
                            className={`flex-shrink-0 w-4 h-4 rounded border-2 transition-all flex items-center justify-center ${
                              isSubCompleted
                                ? 'bg-green-500 dark:bg-green-600 border-green-500 dark:border-green-600'
                                : 'bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500'
                            }`}
                            aria-label={`Toggle ${subItem.label}`}
                            aria-pressed={isSubCompleted}
                          >
                            {isSubCompleted && (
                          <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        )}
                          </button>
                        )}

                        {/* Label */}
                        <span
                          className={`text-sm ${
                            isSubCompleted
                              ? 'text-gray-500 dark:text-gray-400 line-through'
                              : 'text-gray-900 dark:text-white'
                          }`}
                        >
                          {subItem.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default Checklist;
