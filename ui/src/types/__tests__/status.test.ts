/**
 * Status Types Test Suite
 * Verifies that status types are properly defined and exported
 */

import {
  AgentStatus,
  StatusState,
  StatusResponse,
} from '../status';

describe('Status Types', () => {
  describe('AgentStatus type', () => {
    it('should accept valid status values', () => {
      const workingStatus: AgentStatus = 'working';
      const waitingStatus: AgentStatus = 'waiting';
      const idleStatus: AgentStatus = 'idle';

      expect(workingStatus).toBe('working');
      expect(waitingStatus).toBe('waiting');
      expect(idleStatus).toBe('idle');
    });
  });

  describe('StatusState interface', () => {
    it('should have required status property', () => {
      const state: StatusState = {
        status: 'idle',
      };

      expect(state.status).toBe('idle');
    });

    it('should support optional message property', () => {
      const state: StatusState = {
        status: 'working',
        message: 'Processing request',
      };

      expect(state.status).toBe('working');
      expect(state.message).toBe('Processing request');
    });

    it('should allow all agent status values', () => {
      const states: StatusState[] = [
        { status: 'working', message: 'Running' },
        { status: 'waiting', message: 'Waiting for input' },
        { status: 'idle' },
      ];

      expect(states).toHaveLength(3);
      expect(states[0].status).toBe('working');
      expect(states[1].status).toBe('waiting');
      expect(states[2].status).toBe('idle');
    });
  });

  describe('StatusResponse interface', () => {
    it('should have required status and lastActivity properties', () => {
      const response: StatusResponse = {
        status: 'idle',
        lastActivity: '2024-01-23T10:30:00Z',
      };

      expect(response.status).toBe('idle');
      expect(response.lastActivity).toBe('2024-01-23T10:30:00Z');
    });

    it('should support optional message property', () => {
      const response: StatusResponse = {
        status: 'working',
        message: 'Running tests',
        lastActivity: '2024-01-23T10:30:00Z',
      };

      expect(response.status).toBe('working');
      expect(response.message).toBe('Running tests');
      expect(response.lastActivity).toBe('2024-01-23T10:30:00Z');
    });

    it('should accept all agent status values', () => {
      const responses: StatusResponse[] = [
        { status: 'working', message: 'Processing', lastActivity: '2024-01-23T10:30:00Z' },
        { status: 'waiting', message: 'Waiting', lastActivity: '2024-01-23T10:30:01Z' },
        { status: 'idle', lastActivity: '2024-01-23T10:30:02Z' },
      ];

      expect(responses).toHaveLength(3);
      expect(responses[0].status).toBe('working');
      expect(responses[1].status).toBe('waiting');
      expect(responses[2].status).toBe('idle');
    });
  });
});
