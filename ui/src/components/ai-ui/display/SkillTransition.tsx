/**
 * SkillTransition Component
 *
 * Displays a skill transition with prominent skill name and optional description.
 * Shows visual indicator (arrow) and is visually distinct from other UI components.
 */

import React from 'react';
import type { SkillTransition as SkillTransitionType } from '@/types/skills';

export interface SkillTransitionProps extends SkillTransitionType {
  className?: string;
}

/**
 * SkillTransition Component
 * Displays skill name prominently with optional description and visual indicator
 */
export const SkillTransition: React.FC<SkillTransitionProps> = ({
  skillName,
  description,
  className = '',
}) => {
  return (
    <div
      className={`
        flex items-center gap-3 p-4 bg-blue-50 dark:bg-blue-900/30
        border-l-4 border-blue-500 dark:border-blue-400
        rounded-r-lg
        ${className}
      `}
      aria-label="skill-transition"
    >
      {/* Arrow indicator */}
      <div className="flex-shrink-0 text-blue-500 dark:text-blue-400 text-xl">
        →
      </div>

      {/* Content */}
      <div className="flex-1">
        {/* Skill name - prominent */}
        <div className="text-lg font-bold text-gray-900 dark:text-white">
          {skillName}
        </div>

        {/* Description - optional, smaller text */}
        {description && (
          <div className="text-sm text-gray-600 dark:text-gray-300 mt-1">
            {description}
          </div>
        )}
      </div>
    </div>
  );
};

SkillTransition.displayName = 'SkillTransition';
