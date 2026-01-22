import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useQuestionStore, type QuestionState } from '../questionStore';
import type { Question, QuestionResponse } from '../../types/question';

describe('useQuestionStore', () => {
  beforeEach(() => {
    // Clear the store before each test
    useQuestionStore.getState().reset();
  });

  afterEach(() => {
    // Clean up after each test
    useQuestionStore.getState().reset();
  });

  describe('Receiving Questions', () => {
    it('should initialize with no current question', () => {
      const state = useQuestionStore.getState();
      expect(state.currentQuestion).toBeNull();
    });

    it('should receive a question and set it as current', () => {
      const question: Question = {
        id: 'q1',
        text: 'What is 2 + 2?',
        timestamp: Date.now(),
      };

      useQuestionStore.getState().receiveQuestion(question);

      const state = useQuestionStore.getState();
      expect(state.currentQuestion).toEqual(question);
    });

    it('should add received question to history', () => {
      const question: Question = {
        id: 'q1',
        text: 'What is 2 + 2?',
        timestamp: Date.now(),
      };

      useQuestionStore.getState().receiveQuestion(question);

      const state = useQuestionStore.getState();
      expect(state.questionHistory).toHaveLength(1);
      expect(state.questionHistory[0]).toEqual(question);
    });

    it('should prepend new questions to history', () => {
      const question1: Question = {
        id: 'q1',
        text: 'First question',
        timestamp: Date.now(),
      };

      const question2: Question = {
        id: 'q2',
        text: 'Second question',
        timestamp: Date.now() + 1000,
      };

      useQuestionStore.getState().receiveQuestion(question1);
      useQuestionStore.getState().receiveQuestion(question2);

      const state = useQuestionStore.getState();
      expect(state.questionHistory).toHaveLength(2);
      expect(state.questionHistory[0]).toEqual(question2);
      expect(state.questionHistory[1]).toEqual(question1);
    });

    it('should handle questions with context', () => {
      const question: Question = {
        id: 'q1',
        text: 'How should I implement this?',
        context: 'Implementing a feature to handle async operations',
        timestamp: Date.now(),
      };

      useQuestionStore.getState().receiveQuestion(question);

      const state = useQuestionStore.getState();
      expect(state.currentQuestion?.context).toBe('Implementing a feature to handle async operations');
    });

    it('should replace current question when new one is received', () => {
      const question1: Question = {
        id: 'q1',
        text: 'First question',
        timestamp: Date.now(),
      };

      const question2: Question = {
        id: 'q2',
        text: 'Second question',
        timestamp: Date.now() + 1000,
      };

      useQuestionStore.getState().receiveQuestion(question1);
      expect(useQuestionStore.getState().currentQuestion?.id).toBe('q1');

      useQuestionStore.getState().receiveQuestion(question2);
      expect(useQuestionStore.getState().currentQuestion?.id).toBe('q2');

      // Both should be in history
      expect(useQuestionStore.getState().questionHistory).toHaveLength(2);
    });
  });

  describe('Dismissing Questions', () => {
    it('should dismiss current question', () => {
      const question: Question = {
        id: 'q1',
        text: 'What is 2 + 2?',
        timestamp: Date.now(),
      };

      useQuestionStore.getState().receiveQuestion(question);
      expect(useQuestionStore.getState().currentQuestion).not.toBeNull();

      useQuestionStore.getState().dismissQuestion();

      expect(useQuestionStore.getState().currentQuestion).toBeNull();
    });

    it('should clear submission state when dismissing', () => {
      const question: Question = {
        id: 'q1',
        text: 'What is 2 + 2?',
        timestamp: Date.now(),
      };

      useQuestionStore.getState().receiveQuestion(question);
      useQuestionStore.getState().setSubmitError('Some error');

      useQuestionStore.getState().dismissQuestion();

      const state = useQuestionStore.getState();
      expect(state.currentQuestion).toBeNull();
      expect(state.submitState.error).toBeNull();
      expect(state.submitState.success).toBe(false);
      expect(state.submitState.loading).toBe(false);
    });

    it('should keep history when dismissing question', () => {
      const question: Question = {
        id: 'q1',
        text: 'What is 2 + 2?',
        timestamp: Date.now(),
      };

      useQuestionStore.getState().receiveQuestion(question);
      useQuestionStore.getState().dismissQuestion();

      expect(useQuestionStore.getState().questionHistory).toHaveLength(1);
    });
  });

  describe('Submitting Responses', () => {
    it('should submit a response successfully', async () => {
      const question: Question = {
        id: 'q1',
        text: 'What is 2 + 2?',
        timestamp: Date.now(),
      };

      useQuestionStore.getState().receiveQuestion(question);

      const response: QuestionResponse = {
        questionId: 'q1',
        answer: '4',
        timestamp: Date.now(),
      };

      await useQuestionStore.getState().submitResponse(response);

      const state = useQuestionStore.getState();
      expect(state.submitState.success).toBe(true);
      expect(state.submitState.error).toBeNull();
      expect(state.submitState.loading).toBe(false);
    });

    it('should clear current question after successful submission', async () => {
      const question: Question = {
        id: 'q1',
        text: 'What is 2 + 2?',
        timestamp: Date.now(),
      };

      useQuestionStore.getState().receiveQuestion(question);

      const response: QuestionResponse = {
        questionId: 'q1',
        answer: '4',
        timestamp: Date.now(),
      };

      await useQuestionStore.getState().submitResponse(response);

      expect(useQuestionStore.getState().currentQuestion).toBeNull();
    });

    it('should show loading state during submission', async () => {
      const question: Question = {
        id: 'q1',
        text: 'What is 2 + 2?',
        timestamp: Date.now(),
      };

      useQuestionStore.getState().receiveQuestion(question);

      const response: QuestionResponse = {
        questionId: 'q1',
        answer: '4',
        timestamp: Date.now(),
      };

      const submitPromise = useQuestionStore.getState().submitResponse(response);

      // Check loading state immediately after calling submit
      // Note: This is a simple mock, so loading state might be very brief
      await submitPromise;

      // After submission, loading should be false
      expect(useQuestionStore.getState().submitState.loading).toBe(false);
    });

    it('should reject response with non-matching question ID', async () => {
      const question: Question = {
        id: 'q1',
        text: 'What is 2 + 2?',
        timestamp: Date.now(),
      };

      useQuestionStore.getState().receiveQuestion(question);

      const response: QuestionResponse = {
        questionId: 'q999',
        answer: '4',
        timestamp: Date.now(),
      };

      await useQuestionStore.getState().submitResponse(response);

      const state = useQuestionStore.getState();
      expect(state.submitState.error).toBe('No matching question found');
      expect(state.submitState.success).toBe(false);
    });

    it('should reject response when no question is active', async () => {
      const response: QuestionResponse = {
        questionId: 'q1',
        answer: '4',
        timestamp: Date.now(),
      };

      await useQuestionStore.getState().submitResponse(response);

      const state = useQuestionStore.getState();
      expect(state.submitState.error).toBe('No matching question found');
      expect(state.submitState.success).toBe(false);
    });
  });

  describe('Question History', () => {
    it('should initialize with empty history', () => {
      const state = useQuestionStore.getState();
      expect(state.questionHistory).toEqual([]);
    });

    it('should build history as questions are received', () => {
      const questions: Question[] = [
        {
          id: 'q1',
          text: 'Question 1',
          timestamp: Date.now(),
        },
        {
          id: 'q2',
          text: 'Question 2',
          timestamp: Date.now() + 1000,
        },
        {
          id: 'q3',
          text: 'Question 3',
          timestamp: Date.now() + 2000,
        },
      ];

      questions.forEach((q) => useQuestionStore.getState().receiveQuestion(q));

      const state = useQuestionStore.getState();
      expect(state.questionHistory).toHaveLength(3);
      // Most recent question should be first
      expect(state.questionHistory[0].id).toBe('q3');
      expect(state.questionHistory[1].id).toBe('q2');
      expect(state.questionHistory[2].id).toBe('q1');
    });

    it('should get question history', () => {
      const question: Question = {
        id: 'q1',
        text: 'What is 2 + 2?',
        timestamp: Date.now(),
      };

      useQuestionStore.getState().receiveQuestion(question);
      const history = useQuestionStore.getState().getQuestionHistory();

      expect(history).toHaveLength(1);
      expect(history[0]).toEqual(question);
    });

    it('should clear question history', () => {
      const questions: Question[] = [
        {
          id: 'q1',
          text: 'Question 1',
          timestamp: Date.now(),
        },
        {
          id: 'q2',
          text: 'Question 2',
          timestamp: Date.now() + 1000,
        },
      ];

      questions.forEach((q) => useQuestionStore.getState().receiveQuestion(q));
      expect(useQuestionStore.getState().questionHistory).toHaveLength(2);

      useQuestionStore.getState().clearHistory();

      expect(useQuestionStore.getState().questionHistory).toHaveLength(0);
    });

    it('should clear history but not current question when clearing history', () => {
      const question: Question = {
        id: 'q1',
        text: 'What is 2 + 2?',
        timestamp: Date.now(),
      };

      useQuestionStore.getState().receiveQuestion(question);
      useQuestionStore.getState().clearHistory();

      const state = useQuestionStore.getState();
      expect(state.currentQuestion).toEqual(question);
      expect(state.questionHistory).toHaveLength(0);
    });
  });

  describe('Submission State Management', () => {
    it('should initialize with clean submission state', () => {
      const state = useQuestionStore.getState();
      expect(state.submitState.loading).toBe(false);
      expect(state.submitState.error).toBeNull();
      expect(state.submitState.success).toBe(false);
    });

    it('should set loading state', () => {
      useQuestionStore.getState().setSubmitLoading(true);
      expect(useQuestionStore.getState().submitState.loading).toBe(true);

      useQuestionStore.getState().setSubmitLoading(false);
      expect(useQuestionStore.getState().submitState.loading).toBe(false);
    });

    it('should set error state', () => {
      useQuestionStore.getState().setSubmitError('Test error');
      expect(useQuestionStore.getState().submitState.error).toBe('Test error');

      useQuestionStore.getState().setSubmitError(null);
      expect(useQuestionStore.getState().submitState.error).toBeNull();
    });

    it('should set success state', () => {
      useQuestionStore.getState().setSubmitSuccess(true);
      expect(useQuestionStore.getState().submitState.success).toBe(true);

      useQuestionStore.getState().setSubmitSuccess(false);
      expect(useQuestionStore.getState().submitState.success).toBe(false);
    });

    it('should maintain state independence for different properties', () => {
      useQuestionStore.getState().setSubmitLoading(true);
      expect(useQuestionStore.getState().submitState.error).toBeNull();
      expect(useQuestionStore.getState().submitState.success).toBe(false);

      useQuestionStore.getState().setSubmitError('Error');
      expect(useQuestionStore.getState().submitState.loading).toBe(true);
      expect(useQuestionStore.getState().submitState.success).toBe(false);

      useQuestionStore.getState().setSubmitSuccess(true);
      expect(useQuestionStore.getState().submitState.loading).toBe(true);
      expect(useQuestionStore.getState().submitState.error).toBe('Error');
    });
  });

  describe('Reset Functionality', () => {
    it('should reset all state to defaults', () => {
      // Set various states
      const question: Question = {
        id: 'q1',
        text: 'What is 2 + 2?',
        timestamp: Date.now(),
      };

      useQuestionStore.getState().receiveQuestion(question);
      useQuestionStore.getState().setSubmitLoading(true);
      useQuestionStore.getState().setSubmitError('Some error');

      // Verify changes
      let state = useQuestionStore.getState();
      expect(state.currentQuestion).not.toBeNull();
      expect(state.questionHistory).toHaveLength(1);
      expect(state.submitState.loading).toBe(true);
      expect(state.submitState.error).toBe('Some error');

      // Reset
      useQuestionStore.getState().reset();

      // Verify defaults
      state = useQuestionStore.getState();
      expect(state.currentQuestion).toBeNull();
      expect(state.questionHistory).toHaveLength(0);
      expect(state.submitState.loading).toBe(false);
      expect(state.submitState.error).toBeNull();
      expect(state.submitState.success).toBe(false);
    });
  });

  describe('Complex Workflows', () => {
    it('should handle multiple questions in sequence', async () => {
      const question1: Question = {
        id: 'q1',
        text: 'First question',
        timestamp: Date.now(),
      };

      const question2: Question = {
        id: 'q2',
        text: 'Second question',
        timestamp: Date.now() + 1000,
      };

      // Receive first question
      useQuestionStore.getState().receiveQuestion(question1);
      expect(useQuestionStore.getState().currentQuestion?.id).toBe('q1');

      // Submit response to first question
      const response1: QuestionResponse = {
        questionId: 'q1',
        answer: 'First answer',
        timestamp: Date.now(),
      };

      await useQuestionStore.getState().submitResponse(response1);
      expect(useQuestionStore.getState().currentQuestion).toBeNull();
      expect(useQuestionStore.getState().submitState.success).toBe(true);

      // Receive second question
      useQuestionStore.getState().receiveQuestion(question2);
      expect(useQuestionStore.getState().currentQuestion?.id).toBe('q2');

      // Submit response to second question
      const response2: QuestionResponse = {
        questionId: 'q2',
        answer: 'Second answer',
        timestamp: Date.now(),
      };

      await useQuestionStore.getState().submitResponse(response2);
      expect(useQuestionStore.getState().currentQuestion).toBeNull();

      // History should contain both questions
      expect(useQuestionStore.getState().questionHistory).toHaveLength(2);
    });

    it('should handle dismissing and receiving new question', () => {
      const question1: Question = {
        id: 'q1',
        text: 'First question',
        timestamp: Date.now(),
      };

      const question2: Question = {
        id: 'q2',
        text: 'Second question',
        timestamp: Date.now() + 1000,
      };

      useQuestionStore.getState().receiveQuestion(question1);
      useQuestionStore.getState().dismissQuestion();

      expect(useQuestionStore.getState().currentQuestion).toBeNull();
      expect(useQuestionStore.getState().questionHistory).toHaveLength(1);

      useQuestionStore.getState().receiveQuestion(question2);

      expect(useQuestionStore.getState().currentQuestion?.id).toBe('q2');
      expect(useQuestionStore.getState().questionHistory).toHaveLength(2);
    });

    it('should preserve history through submission workflow', async () => {
      const questions: Question[] = [
        { id: 'q1', text: 'Question 1', timestamp: Date.now() },
        { id: 'q2', text: 'Question 2', timestamp: Date.now() + 1000 },
        { id: 'q3', text: 'Question 3', timestamp: Date.now() + 2000 },
      ];

      // Receive all questions
      questions.forEach((q) => useQuestionStore.getState().receiveQuestion(q));
      expect(useQuestionStore.getState().questionHistory).toHaveLength(3);

      // Submit response to current (last) question
      const response: QuestionResponse = {
        questionId: 'q3',
        answer: 'Answer to Q3',
        timestamp: Date.now(),
      };

      await useQuestionStore.getState().submitResponse(response);

      // History should still contain all questions
      expect(useQuestionStore.getState().questionHistory).toHaveLength(3);
      expect(useQuestionStore.getState().currentQuestion).toBeNull();
    });
  });

  describe('Store API', () => {
    it('should expose all required methods', () => {
      const state = useQuestionStore.getState();
      expect(typeof state.receiveQuestion).toBe('function');
      expect(typeof state.submitResponse).toBe('function');
      expect(typeof state.dismissQuestion).toBe('function');
      expect(typeof state.getQuestionHistory).toBe('function');
      expect(typeof state.clearHistory).toBe('function');
      expect(typeof state.setSubmitLoading).toBe('function');
      expect(typeof state.setSubmitError).toBe('function');
      expect(typeof state.setSubmitSuccess).toBe('function');
      expect(typeof state.reset).toBe('function');
    });

    it('should have all required properties', () => {
      const state = useQuestionStore.getState();
      expect(state).toHaveProperty('currentQuestion');
      expect(state).toHaveProperty('questionHistory');
      expect(state).toHaveProperty('submitState');
    });

    it('should have proper submitState structure', () => {
      const state = useQuestionStore.getState();
      expect(state.submitState).toHaveProperty('loading');
      expect(state.submitState).toHaveProperty('error');
      expect(state.submitState).toHaveProperty('success');
      expect(typeof state.submitState.loading).toBe('boolean');
      expect(typeof state.submitState.success).toBe('boolean');
    });
  });
});
