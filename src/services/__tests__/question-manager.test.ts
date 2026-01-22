import { describe, it, expect, beforeEach } from 'bun:test';
import { QuestionManager, Question, QuestionResponse } from '../question-manager';

describe('QuestionManager', () => {
  let manager: QuestionManager;

  beforeEach(() => {
    manager = new QuestionManager();
  });

  describe('receiveQuestion()', () => {
    it('should store a question for a session', () => {
      const sessionName = 'test-session';
      const question: Question = {
        id: 'q1',
        text: 'Do you want to proceed?',
        timestamp: Date.now(),
      };

      manager.receiveQuestion(sessionName, question);

      expect(manager.getQuestion(sessionName)).toEqual(question);
    });

    it('should allow source property for browser or terminal', () => {
      const sessionName = 'test-session';
      const question: Question = {
        id: 'q1',
        text: 'Do you want to proceed?',
        timestamp: Date.now(),
        source: 'browser',
      };

      manager.receiveQuestion(sessionName, question);

      expect(manager.getQuestion(sessionName)?.source).toBe('browser');
    });

    it('should allow source to be terminal', () => {
      const sessionName = 'test-session';
      const question: Question = {
        id: 'q1',
        text: 'Do you want to proceed?',
        timestamp: Date.now(),
        source: 'terminal',
      };

      manager.receiveQuestion(sessionName, question);

      expect(manager.getQuestion(sessionName)?.source).toBe('terminal');
    });

    it('should replace existing pending question for same session', () => {
      const sessionName = 'test-session';
      const question1: Question = {
        id: 'q1',
        text: 'First question?',
        timestamp: Date.now(),
      };
      const question2: Question = {
        id: 'q2',
        text: 'Second question?',
        timestamp: Date.now(),
      };

      manager.receiveQuestion(sessionName, question1);
      manager.receiveQuestion(sessionName, question2);

      expect(manager.getQuestion(sessionName)).toEqual(question2);
    });

    it('should throw error for empty session name', () => {
      const question: Question = {
        id: 'q1',
        text: 'Test question?',
        timestamp: Date.now(),
      };

      expect(() => manager.receiveQuestion('', question)).toThrow('Session name cannot be empty');
      expect(() => manager.receiveQuestion('   ', question)).toThrow('Session name cannot be empty');
    });

    it('should throw error for missing question object', () => {
      expect(() => manager.receiveQuestion('session', null as any)).toThrow('Question object is required');
    });

    it('should throw error for missing question id', () => {
      const question: Question = {
        id: '',
        text: 'Test question?',
        timestamp: Date.now(),
      };

      expect(() => manager.receiveQuestion('session', question)).toThrow('Question must have id and text properties');
    });

    it('should throw error for missing question text', () => {
      const question = {
        id: 'q1',
        text: '',
        timestamp: Date.now(),
      } as Question;

      expect(() => manager.receiveQuestion('session', question)).toThrow('Question must have id and text properties');
    });

    it('should handle multiple sessions independently', () => {
      const question1: Question = {
        id: 'q1',
        text: 'Question for session 1?',
        timestamp: Date.now(),
      };
      const question2: Question = {
        id: 'q2',
        text: 'Question for session 2?',
        timestamp: Date.now(),
      };

      manager.receiveQuestion('session-1', question1);
      manager.receiveQuestion('session-2', question2);

      expect(manager.getQuestion('session-1')).toEqual(question1);
      expect(manager.getQuestion('session-2')).toEqual(question2);
    });
  });

  describe('receiveResponse()', () => {
    it('should move question from pending to history when response matches', () => {
      const sessionName = 'test-session';
      const question: Question = {
        id: 'q1',
        text: 'Do you want to proceed?',
        timestamp: Date.now(),
      };

      manager.receiveQuestion(sessionName, question);

      const response: QuestionResponse = {
        questionId: 'q1',
        response: 'yes',
        timestamp: Date.now(),
      };

      const result = manager.receiveResponse(sessionName, response);

      expect(result).toBe(true);
      expect(manager.getQuestion(sessionName)).toBeNull();
      expect(manager.getHistory(sessionName)).toContain(response);
    });

    it('should return false when response does not match pending question', () => {
      const sessionName = 'test-session';
      const question: Question = {
        id: 'q1',
        text: 'Do you want to proceed?',
        timestamp: Date.now(),
      };

      manager.receiveQuestion(sessionName, question);

      const response: QuestionResponse = {
        questionId: 'q2',
        response: 'yes',
        timestamp: Date.now(),
      };

      const result = manager.receiveResponse(sessionName, response);

      expect(result).toBe(false);
      expect(manager.getQuestion(sessionName)).toEqual(question);
      expect(manager.getHistory(sessionName)).toHaveLength(0);
    });

    it('should return false when no pending question exists', () => {
      const sessionName = 'test-session';
      const response: QuestionResponse = {
        questionId: 'q1',
        response: 'yes',
        timestamp: Date.now(),
      };

      const result = manager.receiveResponse(sessionName, response);

      expect(result).toBe(false);
      expect(manager.getHistory(sessionName)).toHaveLength(0);
    });

    it('should accumulate multiple responses in history', () => {
      const sessionName = 'test-session';

      // Add first question and response
      manager.receiveQuestion(sessionName, {
        id: 'q1',
        text: 'First question?',
        timestamp: Date.now(),
      });
      const response1: QuestionResponse = {
        questionId: 'q1',
        response: 'yes',
        timestamp: Date.now(),
      };
      manager.receiveResponse(sessionName, response1);

      // Add second question and response
      manager.receiveQuestion(sessionName, {
        id: 'q2',
        text: 'Second question?',
        timestamp: Date.now(),
      });
      const response2: QuestionResponse = {
        questionId: 'q2',
        response: 'no',
        timestamp: Date.now(),
      };
      manager.receiveResponse(sessionName, response2);

      const history = manager.getHistory(sessionName);
      expect(history).toHaveLength(2);
      expect(history[0]).toEqual(response1);
      expect(history[1]).toEqual(response2);
    });

    it('should throw error for empty session name', () => {
      const response: QuestionResponse = {
        questionId: 'q1',
        response: 'yes',
        timestamp: Date.now(),
      };

      expect(() => manager.receiveResponse('', response)).toThrow('Session name cannot be empty');
    });

    it('should throw error for missing response object', () => {
      expect(() => manager.receiveResponse('session', null as any)).toThrow('Response object is required');
    });

    it('should throw error for missing response properties', () => {
      expect(() =>
        manager.receiveResponse('session', {
          questionId: '',
          response: 'yes',
          timestamp: Date.now(),
        })
      ).toThrow('Response must have questionId and response properties');

      expect(() =>
        manager.receiveResponse('session', {
          questionId: 'q1',
          response: undefined,
          timestamp: Date.now(),
        } as any)
      ).toThrow('Response must have questionId and response properties');
    });
  });

  describe('dismissQuestion()', () => {
    it('should remove pending question', () => {
      const sessionName = 'test-session';
      const question: Question = {
        id: 'q1',
        text: 'Do you want to proceed?',
        timestamp: Date.now(),
      };

      manager.receiveQuestion(sessionName, question);
      const result = manager.dismissQuestion(sessionName);

      expect(result).toBe(true);
      expect(manager.getQuestion(sessionName)).toBeNull();
    });

    it('should return false when no pending question exists', () => {
      const result = manager.dismissQuestion('nonexistent-session');

      expect(result).toBe(false);
    });

    it('should not affect history when dismissing', () => {
      const sessionName = 'test-session';
      const question: Question = {
        id: 'q1',
        text: 'Do you want to proceed?',
        timestamp: Date.now(),
      };

      manager.receiveQuestion(sessionName, question);

      const response: QuestionResponse = {
        questionId: 'q1',
        response: 'yes',
        timestamp: Date.now(),
      };

      manager.receiveResponse(sessionName, response);

      // Add new question and dismiss it
      manager.receiveQuestion(sessionName, {
        id: 'q2',
        text: 'Another question?',
        timestamp: Date.now(),
      });

      manager.dismissQuestion(sessionName);

      expect(manager.getHistory(sessionName)).toHaveLength(1);
      expect(manager.getQuestion(sessionName)).toBeNull();
    });

    it('should throw error for empty session name', () => {
      expect(() => manager.dismissQuestion('')).toThrow('Session name cannot be empty');
    });
  });

  describe('getQuestion()', () => {
    it('should return the pending question for a session', () => {
      const sessionName = 'test-session';
      const question: Question = {
        id: 'q1',
        text: 'Do you want to proceed?',
        timestamp: Date.now(),
      };

      manager.receiveQuestion(sessionName, question);

      expect(manager.getQuestion(sessionName)).toEqual(question);
    });

    it('should return null when no pending question exists', () => {
      expect(manager.getQuestion('nonexistent-session')).toBeNull();
    });

    it('should throw error for empty session name', () => {
      expect(() => manager.getQuestion('')).toThrow('Session name cannot be empty');
    });
  });

  describe('getHistory()', () => {
    it('should return empty array when no history exists', () => {
      expect(manager.getHistory('test-session')).toEqual([]);
    });

    it('should return all responses for a session', () => {
      const sessionName = 'test-session';

      // Add first question and response
      manager.receiveQuestion(sessionName, {
        id: 'q1',
        text: 'First question?',
        timestamp: Date.now(),
      });
      const response1: QuestionResponse = {
        questionId: 'q1',
        response: 'yes',
        timestamp: Date.now(),
      };
      manager.receiveResponse(sessionName, response1);

      // Add second question and response
      manager.receiveQuestion(sessionName, {
        id: 'q2',
        text: 'Second question?',
        timestamp: Date.now(),
      });
      const response2: QuestionResponse = {
        questionId: 'q2',
        response: 'no',
        timestamp: Date.now(),
      };
      manager.receiveResponse(sessionName, response2);

      const history = manager.getHistory(sessionName);
      expect(history).toHaveLength(2);
      expect(history[0]).toEqual(response1);
      expect(history[1]).toEqual(response2);
    });

    it('should throw error for empty session name', () => {
      expect(() => manager.getHistory('')).toThrow('Session name cannot be empty');
    });

    it('should not include pending questions in history', () => {
      const sessionName = 'test-session';

      manager.receiveQuestion(sessionName, {
        id: 'q1',
        text: 'Question?',
        timestamp: Date.now(),
      });

      const history = manager.getHistory(sessionName);
      expect(history).toHaveLength(0);
    });
  });

  describe('clearHistory()', () => {
    it('should clear history for a session', () => {
      const sessionName = 'test-session';

      manager.receiveQuestion(sessionName, {
        id: 'q1',
        text: 'Question?',
        timestamp: Date.now(),
      });

      const response: QuestionResponse = {
        questionId: 'q1',
        response: 'yes',
        timestamp: Date.now(),
      };

      manager.receiveResponse(sessionName, response);
      expect(manager.getHistory(sessionName)).toHaveLength(1);

      const result = manager.clearHistory(sessionName);

      expect(result).toBe(true);
      expect(manager.getHistory(sessionName)).toHaveLength(0);
    });

    it('should return false when no history exists', () => {
      const result = manager.clearHistory('nonexistent-session');

      expect(result).toBe(false);
    });

    it('should not affect pending questions when clearing history', () => {
      const sessionName = 'test-session';

      manager.receiveQuestion(sessionName, {
        id: 'q1',
        text: 'Question?',
        timestamp: Date.now(),
      });

      const response: QuestionResponse = {
        questionId: 'q1',
        response: 'yes',
        timestamp: Date.now(),
      };

      manager.receiveResponse(sessionName, response);

      const newQuestion: Question = {
        id: 'q2',
        text: 'New question?',
        timestamp: Date.now(),
      };

      manager.receiveQuestion(sessionName, newQuestion);
      manager.clearHistory(sessionName);

      expect(manager.getQuestion(sessionName)).toEqual(newQuestion);
      expect(manager.getHistory(sessionName)).toHaveLength(0);
    });

    it('should throw error for empty session name', () => {
      expect(() => manager.clearHistory('')).toThrow('Session name cannot be empty');
    });
  });

  describe('clearSession()', () => {
    it('should clear both pending questions and history', () => {
      const sessionName = 'test-session';

      manager.receiveQuestion(sessionName, {
        id: 'q1',
        text: 'Question?',
        timestamp: Date.now(),
      });

      const response: QuestionResponse = {
        questionId: 'q1',
        response: 'yes',
        timestamp: Date.now(),
      };

      manager.receiveResponse(sessionName, response);

      manager.receiveQuestion(sessionName, {
        id: 'q2',
        text: 'Another question?',
        timestamp: Date.now(),
      });

      manager.clearSession(sessionName);

      expect(manager.getQuestion(sessionName)).toBeNull();
      expect(manager.getHistory(sessionName)).toHaveLength(0);
    });

    it('should throw error for empty session name', () => {
      expect(() => manager.clearSession('')).toThrow('Session name cannot be empty');
    });
  });

  describe('getPendingSessionNames()', () => {
    it('should return all sessions with pending questions', () => {
      manager.receiveQuestion('session-1', {
        id: 'q1',
        text: 'Question 1?',
        timestamp: Date.now(),
      });

      manager.receiveQuestion('session-2', {
        id: 'q2',
        text: 'Question 2?',
        timestamp: Date.now(),
      });

      const names = manager.getPendingSessionNames();

      expect(names).toHaveLength(2);
      expect(names).toContain('session-1');
      expect(names).toContain('session-2');
    });

    it('should return empty array when no pending questions exist', () => {
      expect(manager.getPendingSessionNames()).toEqual([]);
    });

    it('should not include sessions after dismissing their questions', () => {
      manager.receiveQuestion('session-1', {
        id: 'q1',
        text: 'Question 1?',
        timestamp: Date.now(),
      });

      manager.dismissQuestion('session-1');

      expect(manager.getPendingSessionNames()).toEqual([]);
    });
  });

  describe('getHistorySessions()', () => {
    it('should return all sessions with question history', () => {
      // Add history to session-1
      manager.receiveQuestion('session-1', {
        id: 'q1',
        text: 'Question 1?',
        timestamp: Date.now(),
      });
      manager.receiveResponse('session-1', {
        questionId: 'q1',
        response: 'yes',
        timestamp: Date.now(),
      });

      // Add history to session-2
      manager.receiveQuestion('session-2', {
        id: 'q2',
        text: 'Question 2?',
        timestamp: Date.now(),
      });
      manager.receiveResponse('session-2', {
        questionId: 'q2',
        response: 'no',
        timestamp: Date.now(),
      });

      const names = manager.getHistorySessions();

      expect(names).toHaveLength(2);
      expect(names).toContain('session-1');
      expect(names).toContain('session-2');
    });

    it('should return empty array when no history exists', () => {
      expect(manager.getHistorySessions()).toEqual([]);
    });

    it('should not include sessions after clearing history', () => {
      manager.receiveQuestion('session-1', {
        id: 'q1',
        text: 'Question?',
        timestamp: Date.now(),
      });
      manager.receiveResponse('session-1', {
        questionId: 'q1',
        response: 'yes',
        timestamp: Date.now(),
      });

      manager.clearHistory('session-1');

      expect(manager.getHistorySessions()).toEqual([]);
    });
  });

  describe('hasPendingQuestion()', () => {
    it('should return true when pending question exists', () => {
      manager.receiveQuestion('session-1', {
        id: 'q1',
        text: 'Question?',
        timestamp: Date.now(),
      });

      expect(manager.hasPendingQuestion('session-1')).toBe(true);
    });

    it('should return false when no pending question exists', () => {
      expect(manager.hasPendingQuestion('session-1')).toBe(false);
    });

    it('should return false after dismissing question', () => {
      manager.receiveQuestion('session-1', {
        id: 'q1',
        text: 'Question?',
        timestamp: Date.now(),
      });

      manager.dismissQuestion('session-1');

      expect(manager.hasPendingQuestion('session-1')).toBe(false);
    });

    it('should return false after responding to question', () => {
      manager.receiveQuestion('session-1', {
        id: 'q1',
        text: 'Question?',
        timestamp: Date.now(),
      });

      manager.receiveResponse('session-1', {
        questionId: 'q1',
        response: 'yes',
        timestamp: Date.now(),
      });

      expect(manager.hasPendingQuestion('session-1')).toBe(false);
    });

    it('should throw error for empty session name', () => {
      expect(() => manager.hasPendingQuestion('')).toThrow('Session name cannot be empty');
    });
  });

  describe('integration scenarios', () => {
    it('should handle complete question lifecycle', () => {
      const sessionName = 'workflow-session';

      // 1. Add question
      const question: Question = {
        id: 'q1',
        text: 'Proceed with deployment?',
        timestamp: Date.now(),
        source: 'browser',
      };
      manager.receiveQuestion(sessionName, question);

      expect(manager.hasPendingQuestion(sessionName)).toBe(true);
      expect(manager.getQuestion(sessionName)).toEqual(question);

      // 2. Respond to question
      const response: QuestionResponse = {
        questionId: 'q1',
        response: 'approved',
        timestamp: Date.now(),
      };
      const responded = manager.receiveResponse(sessionName, response);

      expect(responded).toBe(true);
      expect(manager.hasPendingQuestion(sessionName)).toBe(false);

      // 3. Check history
      const history = manager.getHistory(sessionName);
      expect(history).toHaveLength(1);
      expect(history[0]).toEqual(response);
    });

    it('should handle multiple questions in sequence', () => {
      const sessionName = 'multi-question-session';

      // Process first question
      manager.receiveQuestion(sessionName, {
        id: 'q1',
        text: 'Question 1?',
        timestamp: Date.now(),
      });
      manager.receiveResponse(sessionName, {
        questionId: 'q1',
        response: 'response-1',
        timestamp: Date.now(),
      });

      // Process second question
      manager.receiveQuestion(sessionName, {
        id: 'q2',
        text: 'Question 2?',
        timestamp: Date.now(),
      });
      manager.receiveResponse(sessionName, {
        questionId: 'q2',
        response: 'response-2',
        timestamp: Date.now(),
      });

      // Process third question
      manager.receiveQuestion(sessionName, {
        id: 'q3',
        text: 'Question 3?',
        timestamp: Date.now(),
      });
      manager.receiveResponse(sessionName, {
        questionId: 'q3',
        response: 'response-3',
        timestamp: Date.now(),
      });

      const history = manager.getHistory(sessionName);
      expect(history).toHaveLength(3);
      expect(history.map(r => r.response)).toEqual(['response-1', 'response-2', 'response-3']);
    });

    it('should handle session cleanup on project completion', () => {
      const session1 = 'project-1-session';
      const session2 = 'project-2-session';

      // Add data to both sessions
      manager.receiveQuestion(session1, {
        id: 'q1',
        text: 'Question 1?',
        timestamp: Date.now(),
      });
      manager.receiveQuestion(session2, {
        id: 'q2',
        text: 'Question 2?',
        timestamp: Date.now(),
      });

      // Respond to first session
      manager.receiveResponse(session1, {
        questionId: 'q1',
        response: 'yes',
        timestamp: Date.now(),
      });

      // Clear first session completely
      manager.clearSession(session1);

      // Verify session 1 is clean
      expect(manager.getQuestion(session1)).toBeNull();
      expect(manager.getHistory(session1)).toHaveLength(0);
      expect(manager.hasPendingQuestion(session1)).toBe(false);

      // Verify session 2 is unaffected
      expect(manager.getQuestion(session2)).not.toBeNull();
      expect(manager.getPendingSessionNames()).toContain(session2);
    });
  });
});
