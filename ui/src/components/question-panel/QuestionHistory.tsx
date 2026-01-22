/**
 * QuestionHistory Component
 *
 * Displays history of previous questions and responses.
 * Features:
 * - Lists past questions in reverse chronological order
 * - Shows question text and response status
 * - Expandable history items
 * - Optional collapsible history panel
 * - Responsive design
 * - Clear history option
 */

import React, { useState, useCallback } from 'react';
import { useQuestionStore } from '../../stores/questionStore';
import type { Question } from '../../types/question';

export interface QuestionHistoryProps {
  /**
   * Whether to show the history panel
   * If false, only shows in a modal/drawer
   */
  inline?: boolean;
  /**
   * Maximum number of items to display
   */
  maxItems?: number;
  /**
   * Callback when an item is selected
   */
  onSelectItem?: (question: Question) => void;
}

/**
 * Single history item component
 */
const HistoryItem: React.FC<{
  question: Question;
  isExpanded: boolean;
  onToggle: () => void;
  onSelect?: (question: Question) => void;
}> = ({ question, isExpanded, onToggle, onSelect }) => {
  // Truncate question text for display
  const displayText = question.text.substring(0, 80) + (question.text.length > 80 ? '...' : '');
  const timestamp = new Date(question.timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className="border-b border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
      <button
        onClick={onToggle}
        className="w-full text-left p-3 flex items-start gap-2 group"
      >
        <div className="flex-shrink-0 w-5 h-5 flex items-center justify-center text-slate-400 dark:text-slate-500 group-hover:text-slate-600 dark:group-hover:text-slate-400">
          {isExpanded ? (
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 14l-7 7m0 0l-7-7m7 7V3"
              />
            </svg>
          ) : (
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 5l7 7-7 7"
              />
            </svg>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
            {displayText}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {timestamp}
          </p>
        </div>
      </button>

      {/* Expanded details */}
      {isExpanded && (
        <div className="px-3 pb-3 pl-7 space-y-2">
          <div>
            <p className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase">
              Question
            </p>
            <p className="text-sm text-slate-700 dark:text-slate-300 mt-1 whitespace-pre-wrap break-words">
              {question.text}
            </p>
          </div>

          {question.context && (
            <div>
              <p className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase">
                Context
              </p>
              <p className="text-sm text-slate-700 dark:text-slate-300 mt-1">
                {question.context}
              </p>
            </div>
          )}

          {onSelect && (
            <button
              onClick={() => onSelect(question)}
              className="inline-block text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
            >
              View in panel →
            </button>
          )}
        </div>
      )}
    </div>
  );
};

/**
 * Question history component
 * Displays previous questions and responses
 */
export const QuestionHistory: React.FC<QuestionHistoryProps> = ({
  inline = false,
  maxItems = 10,
  onSelectItem,
}) => {
  const { questionHistory, clearHistory } = useQuestionStore();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Get history items (limit to maxItems)
  const historyItems = questionHistory.slice(0, maxItems);

  const handleToggle = useCallback((questionId: string) => {
    setExpandedId((prev) => (prev === questionId ? null : questionId));
  }, []);

  const handleClearHistory = useCallback(() => {
    if (window.confirm('Are you sure you want to clear question history?')) {
      clearHistory();
    }
  }, [clearHistory]);

  if (historyItems.length === 0) {
    return (
      <div className={`text-center py-6 ${inline ? '' : 'px-4'}`}>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          No question history yet
        </p>
      </div>
    );
  }

  const containerClass = inline
    ? 'bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden'
    : '';

  return (
    <div className={containerClass}>
      {/* Header */}
      <div className={`flex items-center justify-between ${inline ? 'p-4 border-b border-slate-200 dark:border-slate-800' : ''}`}>
        <h3 className="font-semibold text-slate-900 dark:text-white">
          Question History ({historyItems.length})
        </h3>
        <button
          onClick={handleClearHistory}
          className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
          aria-label="Clear history"
        >
          <svg
            className="w-3 h-3"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fillRule="evenodd"
              d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
              clipRule="evenodd"
            />
          </svg>
          Clear
        </button>
      </div>

      {/* History items */}
      <div className="divide-y divide-slate-200 dark:divide-slate-700">
        {historyItems.map((question) => (
          <HistoryItem
            key={question.id}
            question={question}
            isExpanded={expandedId === question.id}
            onToggle={() => handleToggle(question.id)}
            onSelect={onSelectItem}
          />
        ))}
      </div>

      {/* Footer message if there are more items */}
      {questionHistory.length > maxItems && (
        <div className="p-3 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-200 dark:border-slate-700">
          <p className="text-xs text-slate-600 dark:text-slate-400">
            Showing {maxItems} of {questionHistory.length} questions
          </p>
        </div>
      )}
    </div>
  );
};

QuestionHistory.displayName = 'QuestionHistory';

export default QuestionHistory;
