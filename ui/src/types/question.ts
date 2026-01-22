/**
 * Question Types - Core types for Claude question management
 */

export interface Question {
  id: string;
  text: string;
  context?: string;
  timestamp: number;
}

export interface QuestionResponse {
  questionId: string;
  answer: string;
  timestamp: number;
}

export interface QuestionSubmitState {
  loading: boolean;
  error: string | null;
  success: boolean;
}
