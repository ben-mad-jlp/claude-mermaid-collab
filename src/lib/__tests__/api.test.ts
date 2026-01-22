/**
 * Comprehensive tests for HTTP API client
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { APIClient, type APIError } from '../api';

// Mock fetch globally
global.fetch = vi.fn();

describe('APIClient', () => {
  let client: APIClient;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    client = new APIClient('http://localhost:3737');
    fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockClear();
  });

  afterEach(() => {
    fetchMock.mockClear();
  });

  describe('Session Operations', () => {
    describe('getSessions', () => {
      it('should fetch all sessions', async () => {
        const mockSessions = [
          { project: '/path/to/project1', session: 'session1', lastAccess: '2026-01-22T10:00:00Z' },
          { project: '/path/to/project2', session: 'session2', lastAccess: '2026-01-22T11:00:00Z' },
        ];

        fetchMock.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ sessions: mockSessions }),
        });

        const result = await client.getSessions();

        expect(result).toEqual(mockSessions);
        expect(fetchMock).toHaveBeenCalledWith(
          'http://localhost:3737/api/sessions',
          expect.objectContaining({ method: 'GET' })
        );
      });

      it('should handle empty session list', async () => {
        fetchMock.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ sessions: [] }),
        });

        const result = await client.getSessions();

        expect(result).toEqual([]);
      });

      it('should handle network errors', async () => {
        fetchMock.mockRejectedValueOnce(new Error('Network timeout'));

        await expect(client.getSessions()).rejects.toThrow('Network error');
      });

      it('should handle invalid JSON response', async () => {
        fetchMock.mockResolvedValueOnce({
          ok: true,
          json: async () => {
            throw new Error('Invalid JSON');
          },
        });

        await expect(client.getSessions()).rejects.toThrow('Invalid JSON response');
      });

      it('should handle server errors', async () => {
        fetchMock.mockResolvedValueOnce({
          ok: false,
          status: 500,
          json: async () => ({ error: 'Internal server error' }),
        });

        const promise = client.getSessions();

        await expect(promise).rejects.toThrow('Internal server error');
        const error = await promise.catch(e => e) as APIError;
        expect(error.status).toBe(500);
      });
    });

    describe('createSession', () => {
      it('should create a new session', async () => {
        fetchMock.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ success: true, project: '/path/to/project', session: 'new-session' }),
        });

        const result = await client.createSession('/path/to/project', 'new-session');

        expect(result.project).toBe('/path/to/project');
        expect(result.session).toBe('new-session');
        expect(result.lastAccess).toBeDefined();
        expect(fetchMock).toHaveBeenCalledWith(
          'http://localhost:3737/api/sessions',
          expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({ project: '/path/to/project', session: 'new-session' }),
          })
        );
      });

      it('should handle validation errors when creating session', async () => {
        fetchMock.mockResolvedValueOnce({
          ok: false,
          status: 400,
          json: async () => ({ error: 'Invalid session name' }),
        });

        await expect(
          client.createSession('/path/to/project', '')
        ).rejects.toThrow('Invalid session name');
      });
    });

    describe('deleteSession', () => {
      it('should delete a session', async () => {
        fetchMock.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ success: true }),
        });

        const result = await client.deleteSession('/path/to/project', 'session-to-delete');

        expect(result).toBe(true);
        expect(fetchMock).toHaveBeenCalledWith(
          'http://localhost:3737/api/sessions',
          expect.objectContaining({
            method: 'DELETE',
            body: JSON.stringify({ project: '/path/to/project', session: 'session-to-delete' }),
          })
        );
      });

      it('should handle session not found', async () => {
        fetchMock.mockResolvedValueOnce({
          ok: false,
          status: 404,
          json: async () => ({ error: 'Session not found' }),
        });

        await expect(
          client.deleteSession('/path/to/project', 'nonexistent')
        ).rejects.toThrow('Session not found');
      });
    });
  });

  describe('Diagram Operations', () => {
    const projectPath = '/path/to/project';
    const sessionName = 'test-session';

    describe('getDiagram', () => {
      it('should fetch a diagram by ID', async () => {
        const mockDiagram = {
          id: 'diagram-1',
          name: 'Test Diagram',
          content: 'graph TD\n  A --> B',
          lastModified: 1642771200000,
        };

        fetchMock.mockResolvedValueOnce({
          ok: true,
          json: async () => mockDiagram,
        });

        const result = await client.getDiagram(projectPath, sessionName, 'diagram-1');

        expect(result).toEqual(mockDiagram);
        expect(fetchMock).toHaveBeenCalledWith(
          expect.stringContaining(`/api/diagram/diagram-1?project=${encodeURIComponent(projectPath)}&session=${encodeURIComponent(sessionName)}`),
          expect.objectContaining({ method: 'GET' })
        );
      });

      it('should handle diagram not found', async () => {
        fetchMock.mockResolvedValueOnce({
          ok: false,
          status: 404,
          json: async () => ({ error: 'Diagram not found' }),
        });

        await expect(
          client.getDiagram(projectPath, sessionName, 'nonexistent')
        ).rejects.toThrow('Diagram not found');
      });
    });

    describe('listDiagrams', () => {
      it('should list all diagrams', async () => {
        const mockDiagrams = [
          { name: 'diagram1.mmd', path: '/path/to/diagram1.mmd', lastModified: 1642771200000 },
          { name: 'diagram2.mmd', path: '/path/to/diagram2.mmd', lastModified: 1642771300000 },
        ];

        fetchMock.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ diagrams: mockDiagrams }),
        });

        const result = await client.listDiagrams(projectPath, sessionName);

        expect(result).toEqual(mockDiagrams);
      });

      it('should handle empty diagram list', async () => {
        fetchMock.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ diagrams: [] }),
        });

        const result = await client.listDiagrams(projectPath, sessionName);

        expect(result).toEqual([]);
      });
    });

    describe('createDiagram', () => {
      it('should create a new diagram', async () => {
        fetchMock.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: 'new-diagram-id', success: true }),
        });

        const result = await client.createDiagram(
          projectPath,
          sessionName,
          'My Diagram',
          'graph TD\n  A --> B'
        );

        expect(result).toBe('new-diagram-id');
        expect(fetchMock).toHaveBeenCalledWith(
          expect.stringContaining('/api/diagram?'),
          expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({ name: 'My Diagram', content: 'graph TD\n  A --> B' }),
          })
        );
      });

      it('should validate diagram content before creating', async () => {
        fetchMock.mockResolvedValueOnce({
          ok: false,
          status: 400,
          json: async () => ({ error: 'Invalid Mermaid syntax' }),
        });

        await expect(
          client.createDiagram(projectPath, sessionName, 'Bad Diagram', 'invalid syntax {')
        ).rejects.toThrow('Invalid Mermaid syntax');
      });
    });

    describe('updateDiagram', () => {
      it('should update an existing diagram', async () => {
        fetchMock.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ success: true }),
        });

        await client.updateDiagram(
          projectPath,
          sessionName,
          'diagram-1',
          'graph TD\n  A --> B --> C'
        );

        expect(fetchMock).toHaveBeenCalledWith(
          expect.stringContaining('/api/diagram/diagram-1?'),
          expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({ content: 'graph TD\n  A --> B --> C' }),
          })
        );
      });

      it('should handle update errors', async () => {
        fetchMock.mockResolvedValueOnce({
          ok: false,
          status: 404,
          json: async () => ({ error: 'Diagram not found' }),
        });

        await expect(
          client.updateDiagram(projectPath, sessionName, 'nonexistent', 'content')
        ).rejects.toThrow('Diagram not found');
      });
    });

    describe('patchDiagram', () => {
      it('should patch a diagram with search-replace', async () => {
        fetchMock.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ success: true }),
        });

        await client.patchDiagram(
          projectPath,
          sessionName,
          'diagram-1',
          'A --> B',
          'A --> B --> C'
        );

        expect(fetchMock).toHaveBeenCalledWith(
          expect.stringContaining('/api/diagram/diagram-1?'),
          expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({
              content: null,
              patch: { oldString: 'A --> B', newString: 'A --> B --> C' },
            }),
          })
        );
      });
    });

    describe('deleteDiagram', () => {
      it('should delete a diagram', async () => {
        fetchMock.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ success: true }),
        });

        await client.deleteDiagram(projectPath, sessionName, 'diagram-to-delete');

        expect(fetchMock).toHaveBeenCalledWith(
          expect.stringContaining('/api/diagram/diagram-to-delete?'),
          expect.objectContaining({ method: 'DELETE' })
        );
      });

      it('should handle delete errors', async () => {
        fetchMock.mockResolvedValueOnce({
          ok: false,
          status: 404,
          json: async () => ({ error: 'Diagram not found' }),
        });

        await expect(
          client.deleteDiagram(projectPath, sessionName, 'nonexistent')
        ).rejects.toThrow('Diagram not found');
      });
    });
  });

  describe('Document Operations', () => {
    const projectPath = '/path/to/project';
    const sessionName = 'test-session';

    describe('getDocument', () => {
      it('should fetch a document by ID', async () => {
        const mockDocument = {
          id: 'doc-1',
          name: 'Design Document',
          content: '# Design\n\nThis is a design doc.',
          lastModified: 1642771200000,
        };

        fetchMock.mockResolvedValueOnce({
          ok: true,
          json: async () => mockDocument,
        });

        const result = await client.getDocument(projectPath, sessionName, 'doc-1');

        expect(result).toEqual(mockDocument);
      });

      it('should handle document not found', async () => {
        fetchMock.mockResolvedValueOnce({
          ok: false,
          status: 404,
          json: async () => ({ error: 'Document not found' }),
        });

        await expect(
          client.getDocument(projectPath, sessionName, 'nonexistent')
        ).rejects.toThrow('Document not found');
      });
    });

    describe('getDocumentClean', () => {
      it('should fetch clean document content', async () => {
        fetchMock.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ content: '# Design\n\nClean content' }),
        });

        const result = await client.getDocumentClean(projectPath, sessionName, 'doc-1');

        expect(result).toBe('# Design\n\nClean content');
        expect(fetchMock).toHaveBeenCalledWith(
          expect.stringContaining('/api/document/doc-1/clean?'),
          expect.anything()
        );
      });
    });

    describe('listDocuments', () => {
      it('should list all documents', async () => {
        const mockDocuments = [
          { name: 'design.md', path: '/path/to/design.md', lastModified: 1642771200000 },
          { name: 'api.md', path: '/path/to/api.md', lastModified: 1642771300000 },
        ];

        fetchMock.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ documents: mockDocuments }),
        });

        const result = await client.listDocuments(projectPath, sessionName);

        expect(result).toEqual(mockDocuments);
      });

      it('should handle empty document list', async () => {
        fetchMock.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ documents: [] }),
        });

        const result = await client.listDocuments(projectPath, sessionName);

        expect(result).toEqual([]);
      });
    });

    describe('createDocument', () => {
      it('should create a new document', async () => {
        fetchMock.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: 'new-doc-id', success: true }),
        });

        const result = await client.createDocument(
          projectPath,
          sessionName,
          'New Document',
          '# Design\n\nContent'
        );

        expect(result).toBe('new-doc-id');
        expect(fetchMock).toHaveBeenCalledWith(
          expect.stringContaining('/api/document?'),
          expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({ name: 'New Document', content: '# Design\n\nContent' }),
          })
        );
      });
    });

    describe('updateDocument', () => {
      it('should update an existing document', async () => {
        fetchMock.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ success: true }),
        });

        await client.updateDocument(
          projectPath,
          sessionName,
          'doc-1',
          '# Updated Design\n\nNew content'
        );

        expect(fetchMock).toHaveBeenCalledWith(
          expect.stringContaining('/api/document/doc-1?'),
          expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({ content: '# Updated Design\n\nNew content' }),
          })
        );
      });
    });

    describe('patchDocument', () => {
      it('should patch a document with search-replace', async () => {
        fetchMock.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ success: true }),
        });

        await client.patchDocument(
          projectPath,
          sessionName,
          'doc-1',
          '## Old Section',
          '## New Section'
        );

        expect(fetchMock).toHaveBeenCalledWith(
          expect.stringContaining('/api/document/doc-1?'),
          expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({
              content: null,
              patch: { oldString: '## Old Section', newString: '## New Section' },
            }),
          })
        );
      });
    });

    describe('deleteDocument', () => {
      it('should delete a document', async () => {
        fetchMock.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ success: true }),
        });

        await client.deleteDocument(projectPath, sessionName, 'doc-to-delete');

        expect(fetchMock).toHaveBeenCalledWith(
          expect.stringContaining('/api/document/doc-to-delete?'),
          expect.objectContaining({ method: 'DELETE' })
        );
      });
    });
  });

  describe('Validation & Rendering Operations', () => {
    describe('validateDiagram', () => {
      it('should validate diagram syntax', async () => {
        fetchMock.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ valid: true }),
        });

        const result = await client.validateDiagram('graph TD\n  A --> B');

        expect(result.valid).toBe(true);
        expect(fetchMock).toHaveBeenCalledWith(
          'http://localhost:3737/api/validate',
          expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({ content: 'graph TD\n  A --> B' }),
          })
        );
      });

      it('should return validation error for invalid syntax', async () => {
        fetchMock.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            valid: false,
            error: 'Unexpected token',
            line: 1,
          }),
        });

        const result = await client.validateDiagram('invalid {');

        expect(result.valid).toBe(false);
        expect(result.error).toBe('Unexpected token');
        expect(result.line).toBe(1);
      });
    });

    describe('renderDiagramSVG', () => {
      it('should render diagram as SVG', async () => {
        const mockSVG = '<svg>...</svg>';

        fetchMock.mockResolvedValueOnce({
          ok: true,
          text: async () => mockSVG,
        });

        const result = await client.renderDiagramSVG('/path/to/project', 'session', 'diagram-1');

        expect(result).toBe(mockSVG);
        expect(fetchMock).toHaveBeenCalledWith(
          expect.stringContaining('/api/render/diagram-1?')
        );
      });

      it('should handle render errors', async () => {
        fetchMock.mockResolvedValueOnce({
          ok: false,
          status: 400,
          json: async () => ({ error: 'Invalid diagram' }),
        });

        await expect(
          client.renderDiagramSVG('/path/to/project', 'session', 'invalid')
        ).rejects.toThrow('Invalid diagram');
      });
    });

    describe('getDiagramThumbnail', () => {
      it('should get diagram thumbnail', async () => {
        const mockThumbnail = '<svg>thumbnail</svg>';

        fetchMock.mockResolvedValueOnce({
          ok: true,
          text: async () => mockThumbnail,
        });

        const result = await client.getDiagramThumbnail('/path/to/project', 'session', 'diagram-1');

        expect(result).toBe(mockThumbnail);
        expect(fetchMock).toHaveBeenCalledWith(
          expect.stringContaining('/api/thumbnail/diagram-1?')
        );
      });

      it('should handle thumbnail errors', async () => {
        fetchMock.mockResolvedValueOnce({
          ok: false,
          status: 404,
          json: async () => ({ error: 'Diagram not found' }),
        });

        await expect(
          client.getDiagramThumbnail('/path/to/project', 'session', 'nonexistent')
        ).rejects.toThrow('Diagram not found');
      });
    });

    describe('transpileDiagram', () => {
      it('should transpile SMACH diagram to Mermaid', async () => {
        const mockMermaid = 'graph TD\n  A --> B';

        fetchMock.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ mermaid: mockMermaid }),
        });

        const result = await client.transpileDiagram('/path/to/project', 'session', 'smach-1');

        expect(result).toBe(mockMermaid);
        expect(fetchMock).toHaveBeenCalledWith(
          expect.stringContaining('/api/transpile/smach-1?'),
          expect.objectContaining({ method: 'GET' })
        );
      });

      it('should handle transpile errors for non-SMACH diagrams', async () => {
        fetchMock.mockResolvedValueOnce({
          ok: false,
          status: 400,
          json: async () => ({ error: 'Not a SMACH diagram' }),
        });

        await expect(
          client.transpileDiagram('/path/to/project', 'session', 'regular-diagram')
        ).rejects.toThrow('Not a SMACH diagram');
      });
    });
  });

  describe('Metadata Operations', () => {
    const projectPath = '/path/to/project';
    const sessionName = 'test-session';

    describe('getMetadata', () => {
      it('should fetch session metadata', async () => {
        const mockMetadata = {
          folders: ['folder1', 'folder2'],
          items: {
            'item1': { folder: 'folder1', locked: false },
            'item2': { folder: null, locked: true },
          },
        };

        fetchMock.mockResolvedValueOnce({
          ok: true,
          json: async () => mockMetadata,
        });

        const result = await client.getMetadata(projectPath, sessionName);

        expect(result).toEqual(mockMetadata);
      });
    });

    describe('updateItemMetadata', () => {
      it('should update item metadata', async () => {
        fetchMock.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ success: true }),
        });

        await client.updateItemMetadata(projectPath, sessionName, 'item-1', {
          folder: 'new-folder',
          locked: true,
        });

        expect(fetchMock).toHaveBeenCalledWith(
          expect.stringContaining('/api/metadata/item/item-1?'),
          expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({ folder: 'new-folder', locked: true }),
          })
        );
      });

      it('should unlock an item', async () => {
        fetchMock.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ success: true }),
        });

        await client.updateItemMetadata(projectPath, sessionName, 'item-1', {
          locked: false,
        });

        expect(fetchMock).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({
            body: JSON.stringify({ locked: false }),
          })
        );
      });
    });

    describe('manageFolders', () => {
      it('should create a folder', async () => {
        fetchMock.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ success: true, folders: ['folder1', 'new-folder'] }),
        });

        const result = await client.manageFolders(projectPath, sessionName, 'create', 'new-folder');

        expect(result.success).toBe(true);
        expect(result.folders).toContain('new-folder');
        expect(fetchMock).toHaveBeenCalledWith(
          expect.stringContaining('/api/metadata/folders?'),
          expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({ action: 'create', name: 'new-folder' }),
          })
        );
      });

      it('should rename a folder', async () => {
        fetchMock.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ success: true, folders: ['renamed-folder'] }),
        });

        const result = await client.manageFolders(
          projectPath,
          sessionName,
          'rename',
          'old-name',
          'new-name'
        );

        expect(result.success).toBe(true);
        expect(fetchMock).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({
            body: JSON.stringify({
              action: 'rename',
              name: 'old-name',
              newName: 'new-name',
            }),
          })
        );
      });

      it('should delete a folder', async () => {
        fetchMock.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ success: true, folders: [] }),
        });

        const result = await client.manageFolders(projectPath, sessionName, 'delete', 'folder-to-delete');

        expect(result.success).toBe(true);
        expect(fetchMock).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({
            body: JSON.stringify({ action: 'delete', name: 'folder-to-delete' }),
          })
        );
      });

      it('should handle folder operation errors', async () => {
        fetchMock.mockResolvedValueOnce({
          ok: false,
          status: 400,
          json: async () => ({ error: 'Folder already exists' }),
        });

        await expect(
          client.manageFolders(projectPath, sessionName, 'create', 'existing-folder')
        ).rejects.toThrow('Folder already exists');
      });
    });
  });

  describe('Error Handling', () => {
    it('should include status code in APIError', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => ({ error: 'Service unavailable' }),
      });

      try {
        await client.getSessions();
        expect.fail('Should have thrown');
      } catch (error) {
        const apiError = error as APIError;
        expect(apiError.status).toBe(503);
        expect(apiError.message).toBe('Service unavailable');
      }
    });

    it('should attach response data to APIError', async () => {
      const errorData = { error: 'Validation failed', details: ['field1 required'] };
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => errorData,
      });

      try {
        await client.getSessions();
        expect.fail('Should have thrown');
      } catch (error) {
        const apiError = error as APIError;
        expect(apiError.data).toEqual(errorData);
      }
    });

    it('should handle fetch network errors gracefully', async () => {
      fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED: Connection refused'));

      try {
        await client.getSessions();
        expect.fail('Should have thrown');
      } catch (error) {
        const apiError = error as APIError;
        expect(apiError.status).toBe(0);
        expect(apiError.message).toContain('Network error');
      }
    });
  });

  describe('Query Parameter Encoding', () => {
    it('should properly encode special characters in project path', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ diagrams: [] }),
      });

      const projectWithSpaces = '/path/with spaces/project';
      await client.listDiagrams(projectWithSpaces, 'session');

      const callUrl = (fetchMock.mock.calls[0][0] as string);
      // URLSearchParams encodes spaces as + instead of %20, both are valid
      const encodedProject = encodeURIComponent(projectWithSpaces).replace(/%20/g, '+');
      expect(callUrl).toContain('project=' + encodedProject);
    });

    it('should properly encode special characters in session name', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ diagrams: [] }),
      });

      const sessionWithSpecialChars = 'session-with-@special#chars';
      await client.listDiagrams('/path/to/project', sessionWithSpecialChars);

      const callUrl = (fetchMock.mock.calls[0][0] as string);
      expect(callUrl).toContain('session=' + encodeURIComponent(sessionWithSpecialChars));
    });
  });

  describe('Content Type Headers', () => {
    it('should set JSON content type for POST requests', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, project: '/path', session: 'test' }),
      });

      await client.createSession('/path', 'test');

      const callOptions = fetchMock.mock.calls[0][1] as RequestInit;
      expect(callOptions.headers).toHaveProperty('Content-Type', 'application/json');
    });

    it('should set JSON content type for GET requests', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ sessions: [] }),
      });

      await client.getSessions();

      const callOptions = fetchMock.mock.calls[0][1] as RequestInit;
      expect(callOptions.headers).toHaveProperty('Content-Type', 'application/json');
    });
  });
});
