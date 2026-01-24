/**
 * Artifact Types and Parser Test Suite
 * Verifies artifact notification types and parsing logic
 */

import { ArtifactNotification } from '../artifacts';
import { ArtifactNotification as ExportedArtifactNotification } from '../index';
import { parseArtifactNotification } from '../../lib/parseArtifactNotification';

describe('ArtifactNotification Type', () => {
  describe('Type definition', () => {
    it('should create a document creation notification', () => {
      const notification: ArtifactNotification = {
        type: 'created',
        artifactType: 'document',
        id: 'doc-123',
        name: 'My Document',
      };

      expect(notification.type).toBe('created');
      expect(notification.artifactType).toBe('document');
      expect(notification.id).toBe('doc-123');
      expect(notification.name).toBe('My Document');
    });

    it('should create a diagram creation notification', () => {
      const notification: ArtifactNotification = {
        type: 'created',
        artifactType: 'diagram',
        id: 'diag-456',
        name: 'System Architecture',
      };

      expect(notification.type).toBe('created');
      expect(notification.artifactType).toBe('diagram');
      expect(notification.id).toBe('diag-456');
      expect(notification.name).toBe('System Architecture');
    });

    it('should create a document update notification', () => {
      const notification: ArtifactNotification = {
        type: 'updated',
        artifactType: 'document',
        id: 'doc-789',
        name: 'Updated Doc',
      };

      expect(notification.type).toBe('updated');
      expect(notification.artifactType).toBe('document');
    });

    it('should create a diagram update notification', () => {
      const notification: ArtifactNotification = {
        type: 'updated',
        artifactType: 'diagram',
        id: 'diag-999',
        name: 'Updated Diagram',
      };

      expect(notification.type).toBe('updated');
      expect(notification.artifactType).toBe('diagram');
    });

    it('should have all required properties', () => {
      const notification: ArtifactNotification = {
        type: 'created',
        artifactType: 'document',
        id: 'test-id',
        name: 'test-name',
      };

      expect(notification.type).toBeDefined();
      expect(notification.artifactType).toBeDefined();
      expect(notification.id).toBeDefined();
      expect(notification.name).toBeDefined();
    });
  });

  describe('Type Exports', () => {
    it('should export ArtifactNotification interface', () => {
      const notification: ArtifactNotification = {
        type: 'created',
        artifactType: 'diagram',
        id: 'id',
        name: 'name',
      };

      expect(notification).toBeDefined();
    });

    it('should export ArtifactNotification from index', () => {
      const notification: ExportedArtifactNotification = {
        type: 'created',
        artifactType: 'document',
        id: 'id',
        name: 'name',
      };

      expect(notification).toBeDefined();
    });
  });
});

describe('parseArtifactNotification', () => {
  describe('Successful parsing', () => {
    it('should parse diagram creation response with previewUrl', () => {
      const mcpResponse = {
        success: true,
        id: 'diagram-123',
        message: 'Diagram "My Diagram" created successfully',
        previewUrl: 'https://example.com/preview?id=diagram-123&type=diagram',
      };

      const result = parseArtifactNotification(mcpResponse);

      expect(result).not.toBeNull();
      expect(result?.type).toBe('created');
      expect(result?.artifactType).toBe('diagram');
      expect(result?.id).toBe('diagram-123');
      expect(result?.name).toBe('My Diagram');
    });

    it('should parse document creation response with previewUrl', () => {
      const mcpResponse = {
        success: true,
        id: 'doc-456',
        message: 'Document "Design Notes" created successfully',
        previewUrl: 'https://example.com/preview?id=doc-456&type=document',
      };

      const result = parseArtifactNotification(mcpResponse);

      expect(result).not.toBeNull();
      expect(result?.type).toBe('created');
      expect(result?.artifactType).toBe('document');
      expect(result?.id).toBe('doc-456');
      expect(result?.name).toBe('Design Notes');
    });

    it('should parse diagram update response', () => {
      const mcpResponse = {
        success: true,
        id: 'diagram-789',
        message: 'Diagram "Architecture" updated successfully',
        previewUrl: 'https://example.com/preview?id=diagram-789&type=diagram',
      };

      const result = parseArtifactNotification(mcpResponse);

      expect(result).not.toBeNull();
      expect(result?.type).toBe('updated');
      expect(result?.artifactType).toBe('diagram');
    });

    it('should parse document update response', () => {
      const mcpResponse = {
        success: true,
        id: 'doc-999',
        message: 'Document "Specifications" updated successfully',
        previewUrl: 'https://example.com/preview?id=doc-999&type=document',
      };

      const result = parseArtifactNotification(mcpResponse);

      expect(result).not.toBeNull();
      expect(result?.type).toBe('updated');
      expect(result?.artifactType).toBe('document');
    });
  });

  describe('Type determination from previewUrl', () => {
    it('should identify diagram type from previewUrl containing "diagram"', () => {
      const mcpResponse = {
        success: true,
        id: 'id1',
        message: 'Item "Test" created successfully',
        previewUrl: 'http://localhost:3000?id=id1&diagram=true',
      };

      const result = parseArtifactNotification(mcpResponse);

      expect(result?.artifactType).toBe('diagram');
    });

    it('should identify document type from previewUrl containing "document"', () => {
      const mcpResponse = {
        success: true,
        id: 'id2',
        message: 'Item "Test" created successfully',
        previewUrl: 'http://localhost:3000?id=id2&document=true',
      };

      const result = parseArtifactNotification(mcpResponse);

      expect(result?.artifactType).toBe('document');
    });

    it('should handle query string with type parameter', () => {
      const mcpResponse = {
        success: true,
        id: 'id3',
        message: 'Item "Name" created successfully',
        previewUrl: 'http://localhost:3000?type=diagram&id=id3',
      };

      const result = parseArtifactNotification(mcpResponse);

      expect(result?.artifactType).toBe('diagram');
    });
  });

  describe('Notification type determination from message', () => {
    it('should identify "created" notification from message', () => {
      const mcpResponse = {
        success: true,
        id: 'id1',
        message: 'Successfully created diagram "New Diagram"',
        previewUrl: 'http://localhost:3000?type=diagram&id=id1',
      };

      const result = parseArtifactNotification(mcpResponse);

      expect(result?.type).toBe('created');
    });

    it('should identify "updated" notification from message', () => {
      const mcpResponse = {
        success: true,
        id: 'id2',
        message: 'Successfully updated document "Existing Doc"',
        previewUrl: 'http://localhost:3000?type=document&id=id2',
      };

      const result = parseArtifactNotification(mcpResponse);

      expect(result?.type).toBe('updated');
    });

    it('should handle case-insensitive "created" matching', () => {
      const mcpResponse = {
        success: true,
        id: 'id3',
        message: 'CREATED diagram "Test"',
        previewUrl: 'http://localhost:3000?type=diagram&id=id3',
      };

      const result = parseArtifactNotification(mcpResponse);

      expect(result?.type).toBe('created');
    });

    it('should handle case-insensitive "updated" matching', () => {
      const mcpResponse = {
        success: true,
        id: 'id4',
        message: 'UPDATED document "Test"',
        previewUrl: 'http://localhost:3000?type=document&id=id4',
      };

      const result = parseArtifactNotification(mcpResponse);

      expect(result?.type).toBe('updated');
    });
  });

  describe('Name extraction from message', () => {
    it('should extract name from quoted string in message', () => {
      const mcpResponse = {
        success: true,
        id: 'id1',
        message: 'Diagram "My Diagram Name" created successfully',
        previewUrl: 'http://localhost:3000?type=diagram&id=id1',
      };

      const result = parseArtifactNotification(mcpResponse);

      expect(result?.name).toBe('My Diagram Name');
    });

    it('should extract name with spaces and special characters', () => {
      const mcpResponse = {
        success: true,
        id: 'id2',
        message: 'Document "System Design v2.0 - Updated!" created successfully',
        previewUrl: 'http://localhost:3000?type=document&id=id2',
      };

      const result = parseArtifactNotification(mcpResponse);

      expect(result?.name).toBe('System Design v2.0 - Updated!');
    });

    it('should handle multiple quoted strings by using first match', () => {
      const mcpResponse = {
        success: true,
        id: 'id3',
        message: 'Diagram "First Name" created from template "Template Name"',
        previewUrl: 'http://localhost:3000?type=diagram&id=id3',
      };

      const result = parseArtifactNotification(mcpResponse);

      expect(result?.name).toBe('First Name');
    });
  });

  describe('Edge cases and error handling', () => {
    it('should return null if success is false', () => {
      const mcpResponse = {
        success: false,
        error: 'Failed to create diagram',
      };

      const result = parseArtifactNotification(mcpResponse);

      expect(result).toBeNull();
    });

    it('should return null if id is missing', () => {
      const mcpResponse = {
        success: true,
        message: 'Diagram "Test" created successfully',
        previewUrl: 'http://localhost:3000?type=diagram',
      };

      const result = parseArtifactNotification(mcpResponse);

      expect(result).toBeNull();
    });

    it('should return null if previewUrl is missing', () => {
      const mcpResponse = {
        success: true,
        id: 'id1',
        message: 'Diagram "Test" created successfully',
      };

      const result = parseArtifactNotification(mcpResponse);

      expect(result).toBeNull();
    });

    it('should return null if previewUrl does not contain artifact type', () => {
      const mcpResponse = {
        success: true,
        id: 'id1',
        message: 'Something "Test" created successfully',
        previewUrl: 'http://localhost:3000?id=id1',
      };

      const result = parseArtifactNotification(mcpResponse);

      expect(result).toBeNull();
    });

    it('should return null if message does not contain created or updated', () => {
      const mcpResponse = {
        success: true,
        id: 'id1',
        message: 'Processing diagram "Test"',
        previewUrl: 'http://localhost:3000?type=diagram&id=id1',
      };

      const result = parseArtifactNotification(mcpResponse);

      expect(result).toBeNull();
    });

    it('should return null if name cannot be extracted from message', () => {
      const mcpResponse = {
        success: true,
        id: 'id1',
        message: 'Diagram created successfully',
        previewUrl: 'http://localhost:3000?type=diagram&id=id1',
      };

      const result = parseArtifactNotification(mcpResponse);

      expect(result).toBeNull();
    });

    it('should handle null response gracefully', () => {
      const result = parseArtifactNotification(null);

      expect(result).toBeNull();
    });

    it('should handle undefined response gracefully', () => {
      const result = parseArtifactNotification(undefined);

      expect(result).toBeNull();
    });

    it('should handle empty object', () => {
      const result = parseArtifactNotification({});

      expect(result).toBeNull();
    });

    it('should handle response with missing optional fields', () => {
      const mcpResponse = {
        success: true,
        id: 'id1',
      };

      const result = parseArtifactNotification(mcpResponse);

      expect(result).toBeNull();
    });
  });

  describe('Complex scenarios', () => {
    it('should handle previewUrl with multiple query parameters', () => {
      const mcpResponse = {
        success: true,
        id: 'diagram-001',
        message: 'Diagram "Complex Name" created successfully',
        previewUrl:
          'http://localhost:3000/preview?project=/path/to/project&session=test&type=diagram&id=diagram-001&timestamp=1234567890',
      };

      const result = parseArtifactNotification(mcpResponse);

      expect(result).not.toBeNull();
      expect(result?.artifactType).toBe('diagram');
      expect(result?.id).toBe('diagram-001');
    });

    it('should handle message with "created" and "updated" keywords - uses first match', () => {
      const mcpResponse = {
        success: true,
        id: 'id1',
        message: 'Successfully created new diagram by updating template "Test"',
        previewUrl: 'http://localhost:3000?type=diagram&id=id1',
      };

      const result = parseArtifactNotification(mcpResponse);

      expect(result?.type).toBe('created');
    });

    it('should parse response with extra fields', () => {
      const mcpResponse = {
        success: true,
        id: 'doc-final',
        name: 'Final Document',
        message: 'Document "Final Document" created successfully',
        previewUrl: 'http://localhost:3000?type=document&id=doc-final',
        timestamp: 1234567890,
        userId: 'user-123',
        extra: 'field',
      };

      const result = parseArtifactNotification(mcpResponse);

      expect(result).not.toBeNull();
      expect(result?.name).toBe('Final Document');
    });
  });
});
