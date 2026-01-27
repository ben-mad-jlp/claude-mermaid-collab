import { describe, it, expect, beforeEach } from 'vitest';
import { UIManager, uiManager, RenderUIRequest, UIResponse } from '../ui-manager';

describe('UIManager', () => {
  let manager: UIManager;

  beforeEach(() => {
    manager = new UIManager();
  });

  describe('renderUI - validation', () => {
    it('should throw when project is missing', async () => {
      const request: RenderUIRequest = {
        project: '',
        session: 'test-session',
        ui: { type: 'button' },
      };

      try {
        await manager.renderUI(request);
        expect.unreachable('Should have thrown');
      } catch (error: any) {
        expect(error.message).toContain('project and session required');
      }
    });

    it('should throw when session is missing', async () => {
      const request: RenderUIRequest = {
        project: '/test/project',
        session: '',
        ui: { type: 'button' },
      };

      try {
        await manager.renderUI(request);
        expect.unreachable('Should have thrown');
      } catch (error: any) {
        expect(error.message).toContain('project and session required');
      }
    });

    it('should throw when ui is missing', async () => {
      const request: RenderUIRequest = {
        project: '/test/project',
        session: 'test-session',
        ui: null,
      };

      try {
        await manager.renderUI(request);
        expect.unreachable('Should have thrown');
      } catch (error: any) {
        expect(error.message).toContain('ui must be an object');
      }
    });

    it('should throw when ui is not an object', async () => {
      const request: RenderUIRequest = {
        project: '/test/project',
        session: 'test-session',
        ui: 'not-an-object',
      };

      try {
        await manager.renderUI(request);
        expect.unreachable('Should have thrown');
      } catch (error: any) {
        expect(error.message).toContain('ui must be an object');
      }
    });

    it('should throw when ui.type is missing', async () => {
      const request: RenderUIRequest = {
        project: '/test/project',
        session: 'test-session',
        ui: { props: {} },
      };

      try {
        await manager.renderUI(request);
        expect.unreachable('Should have thrown');
      } catch (error: any) {
        expect(error.message).toContain('ui must have a type');
      }
    });

  });

  describe('renderUI - non-blocking mode', () => {
    it('should return immediately with completed=true for non-blocking', async () => {
      const request: RenderUIRequest = {
        project: '/test/project',
        session: 'test-session',
        ui: { type: 'button' },
        blocking: false,
      };

      const response = await manager.renderUI(request);

      expect(response.completed).toBe(true);
      expect(response.source).toBe('terminal');
      expect(response.action).toBeUndefined();
    });

    it('should not store pending UI for non-blocking mode', async () => {
      const request: RenderUIRequest = {
        project: '/test/project',
        session: 'test-session',
        ui: { type: 'button' },
        blocking: false,
      };

      await manager.renderUI(request);

      const sessionKey = '/test/project:test-session';
      expect(manager.getPendingUI(sessionKey)).toBeNull();
    });
  });

  describe('renderUI - blocking mode', () => {
    it('should create a pending UI in blocking mode', async () => {
      const request: RenderUIRequest = {
        project: '/test/project',
        session: 'test-session',
        ui: { type: 'button' },
        blocking: true,
      };

      // Start the render but don't await
      const renderPromise = manager.renderUI(request);

      // Give it a moment to set up the promise
      await new Promise(resolve => setTimeout(resolve, 10));

      const sessionKey = '/test/project:test-session';
      const pending = manager.getPendingUI(sessionKey);

      expect(pending).not.toBeNull();
      expect(pending?.uiId).toBeDefined();
      expect(pending?.project).toBe('/test/project');
      expect(pending?.session).toBe('test-session');
      expect(pending?.blocking).toBe(true);

      // Clean up
      manager.dismissUI(sessionKey);
      renderPromise.catch(() => {}); // Suppress unhandled rejection
    });

    it('should use default blocking=true', async () => {
      const request: RenderUIRequest = {
        project: '/test/project',
        session: 'test-session',
        ui: { type: 'button' },
        // blocking not specified
      };

      const renderPromise = manager.renderUI(request);

      await new Promise(resolve => setTimeout(resolve, 10));

      const sessionKey = '/test/project:test-session';
      const pending = manager.getPendingUI(sessionKey);

      expect(pending?.blocking).toBe(true);

      manager.dismissUI(sessionKey);
      renderPromise.catch(() => {}); // Suppress unhandled rejection
    });

  });

  describe('receiveResponse', () => {
    it('should resolve blocking render when response received', async () => {
      const request: RenderUIRequest = {
        project: '/test/project',
        session: 'test-session',
        ui: { type: 'button' },
        blocking: true,
      };

      const renderPromise = manager.renderUI(request);

      await new Promise(resolve => setTimeout(resolve, 10));

      const sessionKey = '/test/project:test-session';
      const pending = manager.getPendingUI(sessionKey);
      const uiId = pending!.uiId;

      const success = manager.receiveResponse(sessionKey, uiId, {
        action: 'click',
        data: { value: 'test' },
      });

      expect(success).toBe(true);

      const response = await renderPromise;
      expect(response.completed).toBe(true);
      expect(response.source).toBe('browser');
      expect(response.action).toBe('click');
      expect(response.data).toEqual({ value: 'test' });
    });

    it('should return false when no pending UI exists', async () => {
      const sessionKey = 'nonexistent:session';
      const success = manager.receiveResponse(sessionKey, 'some-ui-id', {
        action: 'click',
      });

      expect(success).toBe(false);
    });

    it('should return false when uiId does not match', async () => {
      const request: RenderUIRequest = {
        project: '/test/project',
        session: 'test-session',
        ui: { type: 'button' },
      };

      const renderPromise = manager.renderUI(request);

      await new Promise(resolve => setTimeout(resolve, 10));

      const sessionKey = '/test/project:test-session';

      const success = manager.receiveResponse(sessionKey, 'wrong-ui-id', {
        action: 'click',
      });

      expect(success).toBe(false);

      // Clean up
      manager.dismissUI(sessionKey);
      renderPromise.catch(() => {}); // Suppress unhandled rejection
    });

    it('should use browser as default source', async () => {
      const request: RenderUIRequest = {
        project: '/test/project',
        session: 'test-session',
        ui: { type: 'button' },
      };

      const renderPromise = manager.renderUI(request);

      await new Promise(resolve => setTimeout(resolve, 10));

      const sessionKey = '/test/project:test-session';
      const pending = manager.getPendingUI(sessionKey);
      const uiId = pending!.uiId;

      manager.receiveResponse(sessionKey, uiId, {
        action: 'click',
        // source not specified
      });

      const response = await renderPromise;
      expect(response.source).toBe('browser');
    });

    it('should override source when provided', async () => {
      const request: RenderUIRequest = {
        project: '/test/project',
        session: 'test-session',
        ui: { type: 'button' },
      };

      const renderPromise = manager.renderUI(request);

      await new Promise(resolve => setTimeout(resolve, 10));

      const sessionKey = '/test/project:test-session';
      const pending = manager.getPendingUI(sessionKey);
      const uiId = pending!.uiId;

      manager.receiveResponse(sessionKey, uiId, {
        source: 'terminal',
        action: 'click',
      });

      const response = await renderPromise;
      expect(response.source).toBe('terminal');
    });

    it('should clean up pending UI after response', async () => {
      const request: RenderUIRequest = {
        project: '/test/project',
        session: 'test-session',
        ui: { type: 'button' },
      };

      const renderPromise = manager.renderUI(request);

      await new Promise(resolve => setTimeout(resolve, 10));

      const sessionKey = '/test/project:test-session';
      const pending = manager.getPendingUI(sessionKey);
      const uiId = pending!.uiId;

      manager.receiveResponse(sessionKey, uiId, { action: 'click' });

      await renderPromise;

      expect(manager.getPendingUI(sessionKey)).toBeNull();
    });
  });

  describe('getPendingUI', () => {
    it('should return null for non-existent session', () => {
      const pending = manager.getPendingUI('nonexistent:session');
      expect(pending).toBeNull();
    });

    it('should return pending UI for existing session', async () => {
      const request: RenderUIRequest = {
        project: '/test/project',
        session: 'test-session',
        ui: { type: 'button', props: { label: 'Click me' } },
      };

      const renderPromise = manager.renderUI(request);

      await new Promise(resolve => setTimeout(resolve, 10));

      const sessionKey = '/test/project:test-session';
      const pending = manager.getPendingUI(sessionKey);

      expect(pending).not.toBeNull();
      expect(pending?.project).toBe('/test/project');
      expect(pending?.session).toBe('test-session');
      expect(pending?.uiId).toBeDefined();
      expect(pending?.blocking).toBe(true);
      expect(pending?.createdAt).toBeGreaterThan(0);

      manager.dismissUI(sessionKey);
      renderPromise.catch(() => {}); // Suppress unhandled rejection
    });
  });

  describe('dismissUI', () => {
    it('should reject pending render when dismissed', async () => {
      const request: RenderUIRequest = {
        project: '/test/project',
        session: 'test-session',
        ui: { type: 'button' },
      };

      const renderPromise = manager.renderUI(request);

      await new Promise(resolve => setTimeout(resolve, 10));

      const sessionKey = '/test/project:test-session';
      const success = manager.dismissUI(sessionKey);

      expect(success).toBe(true);

      try {
        await renderPromise;
        expect.unreachable('Should have rejected');
      } catch (error: any) {
        expect(error.message).toBe('UI dismissed');
      }
    });

    it('should return false when no pending UI exists', () => {
      const success = manager.dismissUI('nonexistent:session');
      expect(success).toBe(false);
    });

    it('should clean up pending UI after dismissal', async () => {
      const request: RenderUIRequest = {
        project: '/test/project',
        session: 'test-session',
        ui: { type: 'button' },
      };

      const renderPromise = manager.renderUI(request);

      await new Promise(resolve => setTimeout(resolve, 10));

      const sessionKey = '/test/project:test-session';
      manager.dismissUI(sessionKey);

      expect(manager.getPendingUI(sessionKey)).toBeNull();

      try {
        await renderPromise;
      } catch {
        // Expected
      }
    });
  });

  describe('edge cases', () => {
    it('should handle multiple sessions independently', async () => {
      const request1: RenderUIRequest = {
        project: '/project1',
        session: 'session1',
        ui: { type: 'button' },
      };

      const request2: RenderUIRequest = {
        project: '/project2',
        session: 'session2',
        ui: { type: 'button' },
      };

      const render1 = manager.renderUI(request1);
      const render2 = manager.renderUI(request2);

      await new Promise(resolve => setTimeout(resolve, 10));

      const sessionKey1 = '/project1:session1';
      const sessionKey2 = '/project2:session2';

      const pending1 = manager.getPendingUI(sessionKey1);
      const pending2 = manager.getPendingUI(sessionKey2);

      expect(pending1?.project).toBe('/project1');
      expect(pending2?.project).toBe('/project2');

      // Respond to first render
      manager.receiveResponse(sessionKey1, pending1!.uiId, { action: 'click' });

      // Second render should still be pending
      expect(manager.getPendingUI(sessionKey2)).not.toBeNull();

      manager.dismissUI(sessionKey2);
      render2.catch(() => {}); // Suppress unhandled rejection
    });

    it('should replace existing pending UI for same session', async () => {
      const request1: RenderUIRequest = {
        project: '/test/project',
        session: 'test-session',
        ui: { type: 'button' },
      };

      const render1 = manager.renderUI(request1);

      await new Promise(resolve => setTimeout(resolve, 10));

      const sessionKey = '/test/project:test-session';
      const pending1 = manager.getPendingUI(sessionKey);
      const uiId1 = pending1!.uiId;

      // Start a second render for the same session
      const request2: RenderUIRequest = {
        project: '/test/project',
        session: 'test-session',
        ui: { type: 'input' },
      };

      const render2 = manager.renderUI(request2);

      await new Promise(resolve => setTimeout(resolve, 10));

      const pending2 = manager.getPendingUI(sessionKey);
      const uiId2 = pending2!.uiId;

      // The uiIds should be different
      expect(uiId1).not.toBe(uiId2);

      // Old response should be stale
      const oldSuccess = manager.receiveResponse(sessionKey, uiId1, {
        action: 'click',
      });
      expect(oldSuccess).toBe(false);

      // New response should work
      const newSuccess = manager.receiveResponse(sessionKey, uiId2, {
        action: 'submit',
      });
      expect(newSuccess).toBe(true);

      // First render will never resolve, clean up after
      manager.dismissUI(sessionKey);
      render1.catch(() => {
        // Expected - first render was dismissed
      });

      // Second render completed successfully
      const response = await render2;
      expect(response.action).toBe('submit');
    });

    it('should handle empty props object', async () => {
      const request: RenderUIRequest = {
        project: '/test/project',
        session: 'test-session',
        ui: { type: 'button', props: {} },
        blocking: false,
      };

      const response = await manager.renderUI(request);
      expect(response.completed).toBe(true);
    });

  });

  describe('singleton instance', () => {
    it('should provide a singleton instance', () => {
      expect(uiManager).toBeDefined();
      expect(uiManager).toBeInstanceOf(UIManager);
    });
  });
});
