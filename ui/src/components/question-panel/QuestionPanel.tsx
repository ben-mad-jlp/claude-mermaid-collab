/**
 * QuestionPanel Component
 *
 * Main overlay panel for displaying Claude questions to the user.
 * Features:
 * - Slide-in overlay effect with smooth animations
 * - Handles multiple question states (waiting, answered, dismissed)
 * - Keyboard navigation (Escape to dismiss)
 * - Focus trap for accessibility
 * - Integrates with questionStore hook
 * - Shows loading states and error handling
 * - Responsive design
 */

import React, { useEffect, useRef, useCallback } from 'react';
import { useQuestionStore } from '../../stores/questionStore';
import { QuestionRenderer } from './QuestionRenderer';

export const QuestionPanel: React.FC = () => {
  const {
    currentQuestion,
    submitState,
    dismissQuestion,
    submitResponse,
  } = useQuestionStore();

  const panelRef = useRef<HTMLDivElement>(null);
  const focusableElementsRef = useRef<HTMLElement[]>([]);

  // Handle keyboard events (Escape to dismiss, Tab for focus trap)
  useEffect(() => {
    if (!currentQuestion) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Escape key to dismiss
      if (e.key === 'Escape') {
        dismissQuestion();
        return;
      }

      // Tab key for focus trap
      if (e.key === 'Tab' && focusableElementsRef.current.length > 0) {
        const focusableElements = focusableElementsRef.current;
        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        if (e.shiftKey) {
          // Shift + Tab
          if (document.activeElement === firstElement) {
            e.preventDefault();
            lastElement.focus();
          }
        } else {
          // Tab
          if (document.activeElement === lastElement) {
            e.preventDefault();
            firstElement.focus();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentQuestion, dismissQuestion]);

  // Collect focusable elements for focus trap
  useEffect(() => {
    if (!currentQuestion || !panelRef.current) return;

    const focusableSelectors = [
      'button',
      '[href]',
      'input',
      'select',
      'textarea',
      '[tabindex]:not([tabindex="-1"])',
    ].join(',');

    focusableElementsRef.current = Array.from(
      panelRef.current.querySelectorAll(focusableSelectors)
    );

    // Focus first element when panel opens
    if (focusableElementsRef.current.length > 0) {
      focusableElementsRef.current[0].focus();
    }
  }, [currentQuestion]);

  // If no question, don't render anything
  if (!currentQuestion) {
    return null;
  }

  const handleDismiss = useCallback(() => {
    dismissQuestion();
  }, [dismissQuestion]);

  const handleAction = useCallback(
    async (actionId: string, payload?: any) => {
      try {
        await submitResponse({
          questionId: currentQuestion.id,
          answer: typeof payload === 'string' ? payload : JSON.stringify(payload),
          timestamp: Date.now(),
        });
      } catch (error) {
        console.error('Error submitting response:', error);
      }
    },
    [currentQuestion, submitResponse]
  );

  return (
    <>
      {/* Overlay backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-40 transition-opacity"
        onClick={handleDismiss}
        role="presentation"
        aria-hidden="true"
      />

      {/* Question panel */}
      <div
        ref={panelRef}
        className="fixed right-0 top-0 bottom-0 w-full max-w-xl bg-white dark:bg-slate-900 shadow-2xl z-50 flex flex-col overflow-hidden transition-transform duration-300 ease-out transform translate-x-0"
        role="dialog"
        aria-labelledby="question-header"
        aria-modal="true"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-200 dark:border-slate-800 flex-shrink-0">
          <div>
            <h2
              id="question-header"
              className="text-lg font-semibold text-slate-900 dark:text-white"
            >
              Claude is asking...
            </h2>
            {currentQuestion.context && (
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                {currentQuestion.context}
              </p>
            )}
          </div>
          <button
            onClick={handleDismiss}
            className="inline-flex items-center justify-center w-8 h-8 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            aria-label="Dismiss question"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Content area - scrollable */}
        <div className="flex-1 overflow-y-auto p-6">
          {submitState.error && (
            <div className="mb-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900 rounded-lg flex items-start gap-3">
              <svg
                className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                  clipRule="evenodd"
                />
              </svg>
              <div>
                <h3 className="font-medium text-red-900 dark:text-red-200">
                  Error
                </h3>
                <p className="text-sm text-red-700 dark:text-red-300 mt-1">
                  {submitState.error}
                </p>
              </div>
            </div>
          )}

          {submitState.success ? (
            <div className="p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-900 rounded-lg">
              <p className="text-sm font-medium text-green-900 dark:text-green-200">
                Response submitted successfully
              </p>
            </div>
          ) : (
            <QuestionRenderer
              question={currentQuestion}
              onAction={handleAction}
              isLoading={submitState.loading}
            />
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-slate-200 dark:border-slate-800 p-6 flex-shrink-0">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Press ESC to dismiss</span>
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                // In a real implementation, this would show instructions
                // for answering in the terminal
              }}
              className="text-blue-600 dark:text-blue-400 hover:underline"
            >
              Answer in terminal →
            </a>
          </div>
        </div>
      </div>
    </>
  );
};

QuestionPanel.displayName = 'QuestionPanel';

export default QuestionPanel;
