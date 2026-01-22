/**
 * QuestionRenderer Component
 *
 * Renders question UI using ai-ui-registry and AIUIRenderer.
 * Handles:
 * - Flexible UI definitions from Claude
 * - Simple text questions (fallback)
 * - Complex nested UI structures
 * - Action callbacks and validation
 * - Loading states
 * - Error handling
 */

import React, { useMemo, useCallback } from 'react';
import type { Question } from '../../types/question';
import type { UIComponent } from '../../types/ai-ui';
import { AIUIRenderer, ActionCallback } from '../ai-ui/renderer';
import { validateComponent, hasComponent } from '../ai-ui/registry';

export interface QuestionRendererProps {
  question: Question;
  onAction: ActionCallback;
  isLoading?: boolean;
}

/**
 * Simple text question fallback component
 */
const SimpleTextQuestion: React.FC<{
  text: string;
  isLoading?: boolean;
  onSubmit?: () => void;
}> = ({ text, isLoading, onSubmit }) => {
  const [response, setResponse] = React.useState('');

  return (
    <div className="space-y-4">
      <div className="prose prose-sm dark:prose-invert max-w-none">
        <p className="text-base text-slate-900 dark:text-slate-100">
          {text}
        </p>
      </div>

      <div className="space-y-3">
        <textarea
          value={response}
          onChange={(e) => setResponse(e.target.value)}
          placeholder="Type your response here..."
          disabled={isLoading}
          className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          rows={4}
        />

        <button
          onClick={() => {
            if (response.trim() && onSubmit) {
              onSubmit();
            }
          }}
          disabled={!response.trim() || isLoading}
          className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 dark:disabled:bg-slate-700 text-white font-medium rounded-lg transition-colors disabled:cursor-not-allowed"
        >
          {isLoading ? 'Submitting...' : 'Submit'}
        </button>
      </div>
    </div>
  );
};

/**
 * Renders question UI using ai-ui-registry
 * Handles both structured UI definitions and simple text questions
 */
export const QuestionRenderer: React.FC<QuestionRendererProps> = ({
  question,
  onAction,
  isLoading = false,
}) => {
  // Create UI definition from question
  const uiComponent = useMemo((): UIComponent => {
    // If question already has UI structure, use it
    if (question.text && question.text.startsWith('{')) {
      try {
        return JSON.parse(question.text);
      } catch (error) {
        console.warn('Failed to parse question UI definition:', error);
      }
    }

    // Fallback: create a Card component with the text
    return {
      type: 'Card',
      props: {
        title: 'Question',
      },
      children: [
        {
          type: 'Markdown',
          props: {
            content: question.text || 'No question text provided',
          },
        },
      ],
    };
  }, [question.text]);

  // Validate component is registered
  const isValidComponent = useMemo(() => {
    try {
      validateComponent(uiComponent.type);
      return true;
    } catch (error) {
      console.warn('Invalid UI component type:', error);
      return false;
    }
  }, [uiComponent.type]);

  // Wrap action handler to prevent submission when loading
  const handleAction = useCallback(
    async (actionId: string, payload?: any) => {
      if (isLoading) return;
      await onAction(actionId, payload);
    },
    [onAction, isLoading]
  );

  // If component is not valid or registered, show simple text fallback
  if (!isValidComponent) {
    return (
      <SimpleTextQuestion
        text={question.text}
        isLoading={isLoading}
        onSubmit={() => handleAction('submit', question.text)}
      />
    );
  }

  // Render the UI component with action handler
  return (
    <div className="opacity-75 pointer-events-none" style={{ opacity: isLoading ? 0.6 : 1 }}>
      <AIUIRenderer
        component={uiComponent}
        onAction={handleAction}
        componentProps={{
          disabled: isLoading,
        }}
      />
    </div>
  );
};

QuestionRenderer.displayName = 'QuestionRenderer';

export default QuestionRenderer;
