/**
 * FilterBar Component
 *
 * Filter controls for the topic list including confidence tiers,
 * flag/draft toggles, stale filter, and sorting options.
 */

import React from 'react';
import type { ConfidenceTier, TopicFilters, TopicSortBy, SortOrder } from '../../types';

export interface FilterBarProps {
  /** Current filter values */
  filters: TopicFilters;
  /** Callback when filters change */
  onFiltersChange: (filters: TopicFilters) => void;
  /** Current sort field */
  sortBy: TopicSortBy;
  /** Callback when sort field changes */
  onSortByChange: (sortBy: TopicSortBy) => void;
  /** Current sort order */
  sortOrder: SortOrder;
  /** Callback when sort order changes */
  onSortOrderChange: (sortOrder: SortOrder) => void;
  /** Optional additional class name */
  className?: string;
}

/**
 * Confidence tier options
 */
const CONFIDENCE_TIERS: { value: ConfidenceTier; label: string }[] = [
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

/**
 * Sort field options
 */
const SORT_OPTIONS: { value: TopicSortBy; label: string }[] = [
  { value: 'name', label: 'Name' },
  { value: 'confidence', label: 'Confidence' },
  { value: 'lastVerified', label: 'Last Verified' },
  { value: 'accessCount', label: 'Access Count' },
];

/**
 * FilterBar component - Filter and sort controls for topic list
 */
export const FilterBar: React.FC<FilterBarProps> = ({
  filters,
  onFiltersChange,
  sortBy,
  onSortByChange,
  sortOrder,
  onSortOrderChange,
  className = '',
}) => {
  // Handle confidence checkbox change
  const handleConfidenceChange = (tier: ConfidenceTier, checked: boolean) => {
    const currentConfidence = filters.confidence || [];
    const newConfidence = checked
      ? [...currentConfidence, tier]
      : currentConfidence.filter((c) => c !== tier);

    onFiltersChange({
      ...filters,
      confidence: newConfidence.length > 0 ? newConfidence : undefined,
    });
  };

  // Handle boolean toggle changes
  const handleToggleChange = (
    key: 'hasFlags' | 'hasDraft',
    checked: boolean
  ) => {
    onFiltersChange({
      ...filters,
      [key]: checked ? true : undefined,
    });
  };

  // Handle stale toggle
  const handleStaleChange = (checked: boolean) => {
    onFiltersChange({
      ...filters,
      staleDays: checked ? 30 : undefined,
    });
  };

  return (
    <div
      className={`
        flex flex-wrap items-center gap-6
        p-4
        bg-white dark:bg-gray-800
        border border-gray-200 dark:border-gray-700
        rounded-lg
        ${className}
      `}
    >
      {/* Confidence Tier Filters */}
      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
          Confidence
        </span>
        <div className="flex items-center gap-4">
          {CONFIDENCE_TIERS.map((tier) => (
            <label
              key={tier.value}
              className="flex items-center gap-2 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={(filters.confidence || []).includes(tier.value)}
                onChange={(e) =>
                  handleConfidenceChange(tier.value, e.target.checked)
                }
                className="
                  w-4 h-4
                  rounded
                  border-gray-300 dark:border-gray-600
                  text-accent-600 dark:text-accent-500
                  focus:ring-accent-500 dark:focus:ring-accent-400
                  bg-white dark:bg-gray-700
                "
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">
                {tier.label}
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* Divider */}
      <div className="hidden sm:block w-px h-10 bg-gray-200 dark:bg-gray-700" />

      {/* Toggle Filters */}
      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
          Filters
        </span>
        <div className="flex items-center gap-4">
          {/* Has Flags Toggle */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={filters.hasFlags === true}
              onChange={(e) => handleToggleChange('hasFlags', e.target.checked)}
              className="
                w-4 h-4
                rounded
                border-gray-300 dark:border-gray-600
                text-accent-600 dark:text-accent-500
                focus:ring-accent-500 dark:focus:ring-accent-400
                bg-white dark:bg-gray-700
              "
            />
            <span className="text-sm text-gray-700 dark:text-gray-300">
              Has Flags
            </span>
          </label>

          {/* Has Draft Toggle */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={filters.hasDraft === true}
              onChange={(e) => handleToggleChange('hasDraft', e.target.checked)}
              className="
                w-4 h-4
                rounded
                border-gray-300 dark:border-gray-600
                text-accent-600 dark:text-accent-500
                focus:ring-accent-500 dark:focus:ring-accent-400
                bg-white dark:bg-gray-700
              "
            />
            <span className="text-sm text-gray-700 dark:text-gray-300">
              Has Draft
            </span>
          </label>

          {/* Stale Toggle */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={filters.staleDays !== undefined}
              onChange={(e) => handleStaleChange(e.target.checked)}
              className="
                w-4 h-4
                rounded
                border-gray-300 dark:border-gray-600
                text-accent-600 dark:text-accent-500
                focus:ring-accent-500 dark:focus:ring-accent-400
                bg-white dark:bg-gray-700
              "
            />
            <span className="text-sm text-gray-700 dark:text-gray-300">
              Stale (&gt;30 days)
            </span>
          </label>
        </div>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Sort Controls */}
      <div className="flex items-center gap-3">
        {/* Sort By Dropdown */}
        <div className="flex flex-col gap-1">
          <label
            htmlFor="sort-by"
            className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide"
          >
            Sort By
          </label>
          <select
            id="sort-by"
            value={sortBy}
            onChange={(e) => onSortByChange(e.target.value as TopicSortBy)}
            className="
              px-3 py-1.5
              text-sm
              bg-white dark:bg-gray-700
              border border-gray-300 dark:border-gray-600
              rounded-md
              text-gray-700 dark:text-gray-300
              focus:outline-none focus:ring-2 focus:ring-accent-500 dark:focus:ring-accent-400
            "
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        {/* Sort Order Toggle */}
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
            Order
          </span>
          <button
            type="button"
            onClick={() =>
              onSortOrderChange(sortOrder === 'asc' ? 'desc' : 'asc')
            }
            className="
              flex items-center gap-1
              px-3 py-1.5
              text-sm
              bg-white dark:bg-gray-700
              border border-gray-300 dark:border-gray-600
              rounded-md
              text-gray-700 dark:text-gray-300
              hover:bg-gray-50 dark:hover:bg-gray-600
              focus:outline-none focus:ring-2 focus:ring-accent-500 dark:focus:ring-accent-400
              transition-colors
            "
            aria-label={`Sort ${sortOrder === 'asc' ? 'ascending' : 'descending'}`}
          >
            {sortOrder === 'asc' ? (
              <>
                <svg
                  className="w-4 h-4"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path
                    fillRule="evenodd"
                    d="M5.293 7.707a1 1 0 010-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 01-1.414 1.414L11 5.414V17a1 1 0 11-2 0V5.414L6.707 7.707a1 1 0 01-1.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
                Asc
              </>
            ) : (
              <>
                <svg
                  className="w-4 h-4"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path
                    fillRule="evenodd"
                    d="M14.707 12.293a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 111.414-1.414L9 14.586V3a1 1 0 012 0v11.586l2.293-2.293a1 1 0 011.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
                Desc
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default FilterBar;
