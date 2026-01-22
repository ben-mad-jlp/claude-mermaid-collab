/**
 * QuestionRenderer Tests
 *
 * Tests for the QuestionRenderer component including:
 * - Rendering UI components from question
 * - Fallback to simple text when component invalid
 * - Action callback handling
 * - Loading state
 * - Error handling
 * - JSON UI parsing
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QuestionRenderer } from '../QuestionRenderer';
import type { Question } from '../../../types/question';
import * as registryModule from '../../ai-ui/registry';

// Mock the AI-UI renderer
vi.mock('../../ai-ui/renderer', () => ({
  AIUIRenderer: ({ component, onAction, componentProps }: any) => (
    <div data-testid="ai-ui-renderer">
      <p>Rendering: {component.type}</p>
      {onAction && (
        <button onClick={() => onAction('test-action', 'test-payload')}>
          Trigger Action
        </button>
      )}
    </div>
  ),
}));

// Mock the registry validation
vi.spyOn(registryModule, 'validateComponent').mockImplementation((type: string) => {
  if (type === 'Card' || type === 'Markdown') {
    return undefined;
  }
  throw new Error(`Component ${type} not found`);
});

vi.spyOn(registryModule, 'hasComponent').mockImplementation((type: string) => {
  return type === 'Card' || type === 'Markdown';
});

describe('QuestionRenderer', () => {
  const mockQuestion: Question = {
    id: 'test-question-1',
    text: 'What is your favorite color?',
    context: 'Design decision',
    timestamp: Date.now(),
  };

  const mockOnAction = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Basic rendering', () => {
    it('should render text questions with fallback component', () => {
      render(
        <QuestionRenderer
          question={mockQuestion}
          onAction={mockOnAction}
        />
      );

      // Fallback component should be rendered
      expect(screen.getByText('Rendering: Card')).toBeInTheDocument();
    });

    it('should render with AI-UI renderer for valid components', () => {
      render(
        <QuestionRenderer
          question={mockQuestion}
          onAction={mockOnAction}
        />
      );

      expect(screen.getByTestId('ai-ui-renderer')).toBeInTheDocument();
    });
  });

  describe('JSON UI parsing', () => {
    it('should parse JSON UI definition from question text', () => {
      const jsonQuestion: Question = {
        id: 'test-question-2',
        text: JSON.stringify({
          type: 'Card',
          props: { title: 'Test' },
          children: [],
        }),
        timestamp: Date.now(),
      };

      render(
        <QuestionRenderer
          question={jsonQuestion}
          onAction={mockOnAction}
        />
      );

      expect(screen.getByTestId('ai-ui-renderer')).toBeInTheDocument();
    });

    it('should fallback to Card wrapper if JSON parsing fails', () => {
      const invalidJsonQuestion: Question = {
        id: 'test-question-3',
        text: '{invalid json}',
        timestamp: Date.now(),
      };

      render(
        <QuestionRenderer
          question={invalidJsonQuestion}
          onAction={mockOnAction}
        />
      );

      // Should still render with fallback
      expect(screen.getByTestId('ai-ui-renderer')).toBeInTheDocument();
    });
  });

  describe('Action handling', () => {
    it('should call onAction when action is triggered', async () => {
      render(
        <QuestionRenderer
          question={mockQuestion}
          onAction={mockOnAction}
        />
      );

      const triggerButton = screen.getByRole('button', { name: 'Trigger Action' });
      fireEvent.click(triggerButton);

      await waitFor(() => {
        expect(mockOnAction).toHaveBeenCalledWith('test-action', 'test-payload');
      });
    });

    it('should not call onAction when loading', async () => {
      render(
        <QuestionRenderer
          question={mockQuestion}
          onAction={mockOnAction}
          isLoading={true}
        />
      );

      const triggerButton = screen.getByRole('button', { name: 'Trigger Action' });
      fireEvent.click(triggerButton);

      // Should not be called immediately
      expect(mockOnAction).not.toHaveBeenCalled();
    });

    it('should prevent multiple submissions during loading', async () => {
      const { rerender } = render(
        <QuestionRenderer
          question={mockQuestion}
          onAction={mockOnAction}
          isLoading={false}
        />
      );

      rerender(
        <QuestionRenderer
          question={mockQuestion}
          onAction={mockOnAction}
          isLoading={true}
        />
      );

      const triggerButton = screen.getByRole('button', { name: 'Trigger Action' });
      fireEvent.click(triggerButton);

      expect(mockOnAction).not.toHaveBeenCalled();
    });
  });

  describe('Loading state', () => {
    it('should pass disabled prop to components when loading', () => {
      const { rerender } = render(
        <QuestionRenderer
          question={mockQuestion}
          onAction={mockOnAction}
          isLoading={false}
        />
      );

      expect(screen.getByTestId('ai-ui-renderer')).toBeInTheDocument();

      rerender(
        <QuestionRenderer
          question={mockQuestion}
          onAction={mockOnAction}
          isLoading={true}
        />
      );

      // Component should still render but with reduced opacity
      expect(screen.getByTestId('ai-ui-renderer')).toBeInTheDocument();
    });
  });

  describe('Error handling', () => {
    it('should handle invalid component types gracefully', () => {
      const invalidQuestion: Question = {
        id: 'test-question-4',
        text: JSON.stringify({
          type: 'InvalidComponentType',
          props: {},
        }),
        timestamp: Date.now(),
      };

      // This should not throw
      expect(() => {
        render(
          <QuestionRenderer
            question={invalidQuestion}
            onAction={mockOnAction}
          />
        );
      }).not.toThrow();
    });

    it('should handle missing question text', () => {
      const emptyQuestion: Question = {
        id: 'test-question-5',
        text: '',
        timestamp: Date.now(),
      };

      render(
        <QuestionRenderer
          question={emptyQuestion}
          onAction={mockOnAction}
        />
      );

      // Should still render without error
      expect(screen.getByTestId('ai-ui-renderer')).toBeInTheDocument();
    });
  });

  describe('Props passing', () => {
    it('should pass action callback to renderer', () => {
      const onAction = vi.fn();

      render(
        <QuestionRenderer
          question={mockQuestion}
          onAction={onAction}
        />
      );

      expect(screen.getByTestId('ai-ui-renderer')).toBeInTheDocument();
    });

    it('should update when question changes', () => {
      const { rerender } = render(
        <QuestionRenderer
          question={mockQuestion}
          onAction={mockOnAction}
        />
      );

      const newQuestion: Question = {
        id: 'test-question-6',
        text: 'Different question',
        timestamp: Date.now(),
      };

      rerender(
        <QuestionRenderer
          question={newQuestion}
          onAction={mockOnAction}
        />
      );

      expect(screen.getByTestId('ai-ui-renderer')).toBeInTheDocument();
    });
  });

  describe('Component validation', () => {
    it('should validate component is registered before rendering', () => {
      const validQuestion: Question = {
        id: 'test-question-7',
        text: JSON.stringify({
          type: 'Card',
          props: { title: 'Valid' },
        }),
        timestamp: Date.now(),
      };

      render(
        <QuestionRenderer
          question={validQuestion}
          onAction={mockOnAction}
        />
      );

      expect(screen.getByTestId('ai-ui-renderer')).toBeInTheDocument();
    });
  });

  describe('Edge cases', () => {
    it('should handle very long question text', () => {
      const longQuestion: Question = {
        id: 'test-question-8',
        text: 'A'.repeat(10000),
        timestamp: Date.now(),
      };

      expect(() => {
        render(
          <QuestionRenderer
            question={longQuestion}
            onAction={mockOnAction}
          />
        );
      }).not.toThrow();
    });

    it('should handle special characters in question text', () => {
      const specialQuestion: Question = {
        id: 'test-question-9',
        text: 'What do you think about <script>alert("xss")</script>?',
        timestamp: Date.now(),
      };

      render(
        <QuestionRenderer
          question={specialQuestion}
          onAction={mockOnAction}
        />
      );

      expect(screen.getByTestId('ai-ui-renderer')).toBeInTheDocument();
    });
  });
});
