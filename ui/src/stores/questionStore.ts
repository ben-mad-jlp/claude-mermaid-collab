/**
 * Question Store - Zustand store for managing Claude questions
 * Handles question state, history, and response submission
 */

import { create } from 'zustand';
import type { Question, QuestionResponse, QuestionSubmitState } from '../types/question';
import { getWebSocketClient } from '../lib/websocket';

export interface QuestionState {
  // Current question
  currentQuestion: Question | null;

  // Question history
  questionHistory: Question[];

  // Response submission state
  submitState: QuestionSubmitState;

  // Actions
  receiveQuestion: (question: Question) => void;
  submitResponse: (response: QuestionResponse) => Promise<void>;
  dismissQuestion: () => void;
  getQuestionHistory: () => Question[];
  clearHistory: () => void;
  setSubmitLoading: (loading: boolean) => void;
  setSubmitError: (error: string | null) => void;
  setSubmitSuccess: (success: boolean) => void;
  reset: () => void;
}

/**
 * Submit question response via WebSocket
 * Sends response to Claude Code question handler
 * Fire-and-forget pattern: message is sent but response is not awaited
 */
async function submitQuestionResponse(response: QuestionResponse): Promise<void> {
  const client = getWebSocketClient();
  client.send({
    type: 'submit_question_response',
    questionId: response.questionId,
    answer: response.answer,
    timestamp: Date.now(),
  });
}

export const useQuestionStore = create<QuestionState>((set, get) => ({
  // Initial state
  currentQuestion: null,
  questionHistory: [],
  submitState: {
    loading: false,
    error: null,
    success: false,
  },

  // Actions
  receiveQuestion: (question: Question) => {
    set((state) => ({
      currentQuestion: question,
      questionHistory: [question, ...state.questionHistory],
    }));
  },

  submitResponse: async (response: QuestionResponse) => {
    const state = get();

    // Validate that we have a current question matching the response
    if (!state.currentQuestion || state.currentQuestion.id !== response.questionId) {
      set({
        submitState: {
          loading: false,
          error: 'No matching question found',
          success: false,
        },
      });
      return;
    }

    try {
      set({
        submitState: {
          loading: true,
          error: null,
          success: false,
        },
      });

      // Call API to submit response
      await submitQuestionResponse(response);

      set({
        submitState: {
          loading: false,
          error: null,
          success: true,
        },
      });

      // Clear current question after successful submission
      set({ currentQuestion: null });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to submit response';
      set({
        submitState: {
          loading: false,
          error: errorMessage,
          success: false,
        },
      });
    }
  },

  dismissQuestion: () => {
    set({ currentQuestion: null });
    // Clear any previous submission error/success state when dismissing
    set({
      submitState: {
        loading: false,
        error: null,
        success: false,
      },
    });
  },

  getQuestionHistory: () => {
    return get().questionHistory;
  },

  clearHistory: () => {
    set({ questionHistory: [] });
  },

  setSubmitLoading: (loading: boolean) => {
    set((state) => ({
      submitState: {
        ...state.submitState,
        loading,
      },
    }));
  },

  setSubmitError: (error: string | null) => {
    set((state) => ({
      submitState: {
        ...state.submitState,
        error,
      },
    }));
  },

  setSubmitSuccess: (success: boolean) => {
    set((state) => ({
      submitState: {
        ...state.submitState,
        success,
      },
    }));
  },

  reset: () => {
    set({
      currentQuestion: null,
      questionHistory: [],
      submitState: {
        loading: false,
        error: null,
        success: false,
      },
    });
  },
}));
