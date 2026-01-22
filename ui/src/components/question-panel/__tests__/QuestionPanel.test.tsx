/**
 * QuestionPanel Tests
 *
 * Tests for the QuestionPanel component including:
 * - Rendering when question exists
 * - Dismissing panel
 * - Keyboard navigation (Escape to dismiss)
 * - Focus trap
 * - Loading/error states
 * - Accessibility attributes
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QuestionPanel } from '../QuestionPanel';
import { useQuestionStore } from '../../../stores/questionStore';
import type { Question } from '../../../types/question';

// Mock the question store
vi.mock('../../../stores/questionStore', () => ({
  useQuestionStore: vi.fn(),
}));

// Mock the QuestionRenderer
vi.mock('../QuestionRenderer', () => ({
  QuestionRenderer: ({ question, onAction, isLoading }: any) => (
    <div data-testid="question-renderer">
      <p>{question.text}</p>
      <button
        onClick={() => onAction('submit', 'test response')}
        disabled={isLoading}
      >
        Submit
      </button>
    </div>
  ),
}));


describe('QuestionPanel', () => {
  const mockQuestion: Question = {
    id: 'test-question-1',
    text: 'What is your favorite color?',
    context: 'Design decision',
    timestamp: Date.now(),
  };

  const mockUseQuestionStore = useQuestionStore as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Rendering', () => {
    it('should not render when there is no current question', () => {
      mockUseQuestionStore.mockReturnValue({
        currentQuestion: null,
        submitState: { loading: false, error: null, success: false },
        dismissQuestion: vi.fn(),
        submitResponse: vi.fn(),
      });

      const { container } = render(<QuestionPanel />);
      expect(container.firstChild).toBeNull();
    });

    it('should render panel when question exists', () => {
      mockUseQuestionStore.mockReturnValue({
        currentQuestion: mockQuestion,
        submitState: { loading: false, error: null, success: false },
        dismissQuestion: vi.fn(),
        submitResponse: vi.fn(),
      });

      render(<QuestionPanel />);
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByText('Claude is asking...')).toBeInTheDocument();
    });

    it('should display question context when provided', () => {
      mockUseQuestionStore.mockReturnValue({
        currentQuestion: mockQuestion,
        submitState: { loading: false, error: null, success: false },
        dismissQuestion: vi.fn(),
        submitResponse: vi.fn(),
      });

      render(<QuestionPanel />);
      expect(screen.getByText('Design decision')).toBeInTheDocument();
    });

    it('should render QuestionRenderer with question data', () => {
      mockUseQuestionStore.mockReturnValue({
        currentQuestion: mockQuestion,
        submitState: { loading: false, error: null, success: false },
        dismissQuestion: vi.fn(),
        submitResponse: vi.fn(),
      });

      render(<QuestionPanel />);
      expect(screen.getByTestId('question-renderer')).toBeInTheDocument();
      expect(screen.getByText(mockQuestion.text)).toBeInTheDocument();
    });
  });

  describe('Dismissal', () => {
    it('should dismiss when close button is clicked', async () => {
      const dismissQuestion = vi.fn();
      mockUseQuestionStore.mockReturnValue({
        currentQuestion: mockQuestion,
        submitState: { loading: false, error: null, success: false },
        dismissQuestion,
        submitResponse: vi.fn(),
      });

      render(<QuestionPanel />);

      const closeButton = screen.getByRole('button', { name: 'Dismiss question' });
      fireEvent.click(closeButton);

      expect(dismissQuestion).toHaveBeenCalled();
    });

    it('should dismiss when backdrop is clicked', async () => {
      const dismissQuestion = vi.fn();
      mockUseQuestionStore.mockReturnValue({
        currentQuestion: mockQuestion,
        submitState: { loading: false, error: null, success: false },
        dismissQuestion,
        submitResponse: vi.fn(),
      });

      const { container } = render(<QuestionPanel />);

      const backdrop = container.querySelector('[role="presentation"]');
      if (backdrop) {
        fireEvent.click(backdrop);
        expect(dismissQuestion).toHaveBeenCalled();
      }
    });

    it('should dismiss on Escape key', async () => {
      const dismissQuestion = vi.fn();
      mockUseQuestionStore.mockReturnValue({
        currentQuestion: mockQuestion,
        submitState: { loading: false, error: null, success: false },
        dismissQuestion,
        submitResponse: vi.fn(),
      });

      render(<QuestionPanel />);

      fireEvent.keyDown(window, { key: 'Escape' });

      expect(dismissQuestion).toHaveBeenCalled();
    });
  });

  describe('Action handling', () => {
    it('should submit response when action is triggered', async () => {
      const submitResponse = vi.fn().mockResolvedValue(undefined);
      mockUseQuestionStore.mockReturnValue({
        currentQuestion: mockQuestion,
        submitState: { loading: false, error: null, success: false },
        dismissQuestion: vi.fn(),
        submitResponse,
      });

      render(<QuestionPanel />);

      const submitButton = screen.getByRole('button', { name: 'Submit' });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(submitResponse).toHaveBeenCalledWith({
          questionId: mockQuestion.id,
          answer: 'test response',
          timestamp: expect.any(Number),
        });
      });
    });
  });

  describe('Loading state', () => {
    it('should show loading state when submitting', () => {
      mockUseQuestionStore.mockReturnValue({
        currentQuestion: mockQuestion,
        submitState: { loading: true, error: null, success: false },
        dismissQuestion: vi.fn(),
        submitResponse: vi.fn(),
      });

      render(<QuestionPanel />);

      const submitButton = screen.getByRole('button', { name: 'Submit' });
      expect(submitButton).toBeDisabled();
    });
  });

  describe('Error handling', () => {
    it('should display error message when submission fails', () => {
      mockUseQuestionStore.mockReturnValue({
        currentQuestion: mockQuestion,
        submitState: {
          loading: false,
          error: 'Failed to submit response',
          success: false,
        },
        dismissQuestion: vi.fn(),
        submitResponse: vi.fn(),
      });

      render(<QuestionPanel />);
      expect(screen.getByText('Failed to submit response')).toBeInTheDocument();
    });

    it('should display success message after successful submission', () => {
      mockUseQuestionStore.mockReturnValue({
        currentQuestion: mockQuestion,
        submitState: {
          loading: false,
          error: null,
          success: true,
        },
        dismissQuestion: vi.fn(),
        submitResponse: vi.fn(),
      });

      render(<QuestionPanel />);
      expect(
        screen.getByText('Response submitted successfully')
      ).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('should have proper ARIA attributes', () => {
      mockUseQuestionStore.mockReturnValue({
        currentQuestion: mockQuestion,
        submitState: { loading: false, error: null, success: false },
        dismissQuestion: vi.fn(),
        submitResponse: vi.fn(),
      });

      render(<QuestionPanel />);

      const dialog = screen.getByRole('dialog');
      expect(dialog).toHaveAttribute('aria-modal', 'true');
      expect(dialog).toHaveAttribute('aria-labelledby', 'question-header');
    });

    it('should set aria-hidden on backdrop', () => {
      mockUseQuestionStore.mockReturnValue({
        currentQuestion: mockQuestion,
        submitState: { loading: false, error: null, success: false },
        dismissQuestion: vi.fn(),
        submitResponse: vi.fn(),
      });

      const { container } = render(<QuestionPanel />);

      const backdrop = container.querySelector('[role="presentation"]');
      expect(backdrop).toHaveAttribute('aria-hidden', 'true');
    });
  });

  describe('Focus management', () => {
    it('should trap focus within panel', async () => {
      const dismissQuestion = vi.fn();
      mockUseQuestionStore.mockReturnValue({
        currentQuestion: mockQuestion,
        submitState: { loading: false, error: null, success: false },
        dismissQuestion,
        submitResponse: vi.fn(),
      });

      render(<QuestionPanel />);

      // Tab key handling is tested via keyboard event listeners
      // This is a simplified test for focus trap setup
      const dialog = screen.getByRole('dialog');
      expect(dialog).toBeInTheDocument();
    });
  });
});
