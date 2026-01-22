/**
 * Server-side question state manager
 * Handles storing, responding to, and tracking questions per session
 */

export interface Question {
  id: string;
  text: string;
  timestamp: number;
  source?: 'browser' | 'terminal';
}

export interface QuestionResponse {
  questionId: string;
  response: string;
  timestamp: number;
}

export interface QuestionHistory {
  questions: QuestionResponse[];
}

/**
 * QuestionManager handles storing pending questions per session,
 * managing user responses, and tracking question history.
 */
export class QuestionManager {
  // Store pending questions per session: Map<sessionName, Question>
  private pendingQuestions: Map<string, Question> = new Map();

  // Store question history per session: Map<sessionName, QuestionResponse[]>
  private questionHistory: Map<string, QuestionResponse[]> = new Map();

  /**
   * Store a pending question for a session.
   * If a question already exists for this session, it will be replaced.
   */
  receiveQuestion(sessionName: string, question: Question): void {
    if (!sessionName || !sessionName.trim()) {
      throw new Error('Session name cannot be empty');
    }
    if (!question) {
      throw new Error('Question object is required');
    }
    if (!question.id || !question.text) {
      throw new Error('Question must have id and text properties');
    }

    this.pendingQuestions.set(sessionName, question);
  }

  /**
   * Handle a user response to a pending question.
   * Moves the question from pending to history with the response.
   * Returns true if a matching pending question was found and processed.
   */
  receiveResponse(sessionName: string, response: QuestionResponse): boolean {
    if (!sessionName || !sessionName.trim()) {
      throw new Error('Session name cannot be empty');
    }
    if (!response) {
      throw new Error('Response object is required');
    }
    if (!response.questionId || response.response === undefined) {
      throw new Error('Response must have questionId and response properties');
    }

    const pendingQuestion = this.pendingQuestions.get(sessionName);

    // Check if the response matches the pending question
    if (!pendingQuestion || pendingQuestion.id !== response.questionId) {
      return false;
    }

    // Add to history
    if (!this.questionHistory.has(sessionName)) {
      this.questionHistory.set(sessionName, []);
    }
    this.questionHistory.get(sessionName)!.push(response);

    // Remove from pending
    this.pendingQuestions.delete(sessionName);

    return true;
  }

  /**
   * Dismiss a pending question without responding.
   * Removes the question from pending state.
   * Returns true if a question was dismissed, false if no pending question existed.
   */
  dismissQuestion(sessionName: string): boolean {
    if (!sessionName || !sessionName.trim()) {
      throw new Error('Session name cannot be empty');
    }

    if (this.pendingQuestions.has(sessionName)) {
      this.pendingQuestions.delete(sessionName);
      return true;
    }

    return false;
  }

  /**
   * Get the current pending question for a session.
   * Returns null if no pending question exists.
   */
  getQuestion(sessionName: string): Question | null {
    if (!sessionName || !sessionName.trim()) {
      throw new Error('Session name cannot be empty');
    }

    return this.pendingQuestions.get(sessionName) || null;
  }

  /**
   * Get the question history for a session.
   * Returns an empty array if no history exists.
   */
  getHistory(sessionName: string): QuestionResponse[] {
    if (!sessionName || !sessionName.trim()) {
      throw new Error('Session name cannot be empty');
    }

    return this.questionHistory.get(sessionName) || [];
  }

  /**
   * Clear the question history for a session.
   * Only clears history, not pending questions.
   */
  clearHistory(sessionName: string): boolean {
    if (!sessionName || !sessionName.trim()) {
      throw new Error('Session name cannot be empty');
    }

    if (this.questionHistory.has(sessionName)) {
      this.questionHistory.delete(sessionName);
      return true;
    }

    return false;
  }

  /**
   * Clear all data for a session (both pending and history).
   * Useful for session cleanup.
   */
  clearSession(sessionName: string): void {
    if (!sessionName || !sessionName.trim()) {
      throw new Error('Session name cannot be empty');
    }

    this.pendingQuestions.delete(sessionName);
    this.questionHistory.delete(sessionName);
  }

  /**
   * Get all sessions with pending questions.
   */
  getPendingSessionNames(): string[] {
    return Array.from(this.pendingQuestions.keys());
  }

  /**
   * Get all sessions with history.
   */
  getHistorySessions(): string[] {
    return Array.from(this.questionHistory.keys());
  }

  /**
   * Check if a session has a pending question.
   */
  hasPendingQuestion(sessionName: string): boolean {
    if (!sessionName || !sessionName.trim()) {
      throw new Error('Session name cannot be empty');
    }

    return this.pendingQuestions.has(sessionName);
  }
}

// Singleton instance for convenience
export const questionManager = new QuestionManager();
