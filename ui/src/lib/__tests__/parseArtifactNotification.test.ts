/**
 * Artifact Notification Parser Test Suite
 * Comprehensive tests for the parseArtifactNotification function
 */

import { parseArtifactNotification } from '../parseArtifactNotification';

describe('parseArtifactNotification', () => {
  describe('Basic parsing functionality', () => {
    it('should parse a simple diagram creation response', () => {
      const response = {
        success: true,
        id: 'diagram-001',
        message: 'Diagram "Test Diagram" created successfully',
        previewUrl: 'http://localhost:3000/preview?id=diagram-001&type=diagram',
      };

      const result = parseArtifactNotification(response);

      expect(result).not.toBeNull();
      expect(result).toEqual({
        type: 'created',
        artifactType: 'diagram',
        id: 'diagram-001',
        name: 'Test Diagram',
      });
    });

    it('should parse a simple document creation response', () => {
      const response = {
        success: true,
        id: 'doc-001',
        message: 'Document "Design Doc" created successfully',
        previewUrl: 'http://localhost:3000/preview?id=doc-001&type=document',
      };

      const result = parseArtifactNotification(response);

      expect(result).not.toBeNull();
      expect(result).toEqual({
        type: 'created',
        artifactType: 'document',
        id: 'doc-001',
        name: 'Design Doc',
      });
    });
  });

  describe('Real-world MCP response formats', () => {
    it('should handle MCP diagram creation response', () => {
      const mcpResponse = {
        success: true,
        id: 'mermaid-diagram-12345',
        name: 'Architecture Diagram',
        message: 'Diagram "Architecture Diagram" created successfully in session',
        previewUrl:
          'http://localhost:3000/preview?project=/path/to/project&session=design&id=mermaid-diagram-12345&type=diagram&timestamp=1234567890',
      };

      const result = parseArtifactNotification(mcpResponse);

      expect(result).not.toBeNull();
      expect(result?.type).toBe('created');
      expect(result?.artifactType).toBe('diagram');
      expect(result?.id).toBe('mermaid-diagram-12345');
      expect(result?.name).toBe('Architecture Diagram');
    });

    it('should handle MCP document creation response', () => {
      const mcpResponse = {
        success: true,
        id: 'mermaid-document-67890',
        name: 'Implementation Plan',
        message: 'Document "Implementation Plan" created successfully in session',
        previewUrl:
          'http://localhost:3000/preview?project=/path/to/project&session=planning&id=mermaid-document-67890&type=document&timestamp=1234567890',
      };

      const result = parseArtifactNotification(mcpResponse);

      expect(result).not.toBeNull();
      expect(result?.type).toBe('created');
      expect(result?.artifactType).toBe('document');
      expect(result?.id).toBe('mermaid-document-67890');
      expect(result?.name).toBe('Implementation Plan');
    });

    it('should handle MCP update response', () => {
      const mcpResponse = {
        success: true,
        id: 'mermaid-diagram-existing',
        message: 'Diagram "Updated Architecture" updated successfully',
        previewUrl:
          'http://localhost:3000/preview?id=mermaid-diagram-existing&type=diagram',
      };

      const result = parseArtifactNotification(mcpResponse);

      expect(result).not.toBeNull();
      expect(result?.type).toBe('updated');
      expect(result?.artifactType).toBe('diagram');
    });
  });

  describe('Error cases', () => {
    it('should return null for failed response', () => {
      const response = {
        success: false,
        error: 'Something went wrong',
      };

      expect(parseArtifactNotification(response)).toBeNull();
    });

    it('should return null for response without success flag', () => {
      const response = {
        id: 'test',
        message: 'Test',
        previewUrl: 'http://localhost:3000?type=diagram',
      };

      expect(parseArtifactNotification(response)).toBeNull();
    });

    it('should return null for response without id', () => {
      const response = {
        success: true,
        message: 'Diagram "Test" created successfully',
        previewUrl: 'http://localhost:3000?type=diagram',
      };

      expect(parseArtifactNotification(response)).toBeNull();
    });

    it('should return null for response without previewUrl', () => {
      const response = {
        success: true,
        id: 'test-id',
        message: 'Diagram "Test" created successfully',
      };

      expect(parseArtifactNotification(response)).toBeNull();
    });

    it('should return null for response without message', () => {
      const response = {
        success: true,
        id: 'test-id',
        previewUrl: 'http://localhost:3000?type=diagram',
      };

      expect(parseArtifactNotification(response)).toBeNull();
    });

    it('should return null when artifact type cannot be determined', () => {
      const response = {
        success: true,
        id: 'test-id',
        message: 'Something "Test" created successfully',
        previewUrl: 'http://localhost:3000?id=test-id',
      };

      expect(parseArtifactNotification(response)).toBeNull();
    });

    it('should return null when notification type cannot be determined', () => {
      const response = {
        success: true,
        id: 'test-id',
        message: 'Processing diagram "Test"',
        previewUrl: 'http://localhost:3000?type=diagram&id=test-id',
      };

      expect(parseArtifactNotification(response)).toBeNull();
    });

    it('should return null when name cannot be extracted', () => {
      const response = {
        success: true,
        id: 'test-id',
        message: 'Diagram created successfully',
        previewUrl: 'http://localhost:3000?type=diagram&id=test-id',
      };

      expect(parseArtifactNotification(response)).toBeNull();
    });

    it('should return null for non-object input', () => {
      expect(parseArtifactNotification(null)).toBeNull();
      expect(parseArtifactNotification(undefined)).toBeNull();
      expect(parseArtifactNotification('string')).toBeNull();
      expect(parseArtifactNotification(123)).toBeNull();
      expect(parseArtifactNotification(true)).toBeNull();
    });

    it('should return null for empty object', () => {
      expect(parseArtifactNotification({})).toBeNull();
    });
  });

  describe('Special characters and edge cases', () => {
    it('should handle special characters in artifact name', () => {
      const response = {
        success: true,
        id: 'test-id',
        message: 'Diagram "UI Flow - v2.0 (Final!)" created successfully',
        previewUrl: 'http://localhost:3000?type=diagram&id=test-id',
      };

      const result = parseArtifactNotification(response);

      expect(result?.name).toBe('UI Flow - v2.0 (Final!)');
    });

    it('should handle unicode characters in artifact name', () => {
      const response = {
        success: true,
        id: 'test-id',
        message: 'Document "设计文档 📋" created successfully',
        previewUrl: 'http://localhost:3000?type=document&id=test-id',
      };

      const result = parseArtifactNotification(response);

      expect(result?.name).toBe('设计文档 📋');
    });

    it('should handle very long artifact names', () => {
      const longName =
        'This is a very long artifact name that contains a lot of text to test edge case handling in the parser function implementation';
      const response = {
        success: true,
        id: 'test-id',
        message: `Diagram "${longName}" created successfully`,
        previewUrl: 'http://localhost:3000?type=diagram&id=test-id',
      };

      const result = parseArtifactNotification(response);

      expect(result?.name).toBe(longName);
    });

    it('should return null for empty string as artifact name', () => {
      const response = {
        success: true,
        id: 'test-id',
        message: 'Diagram "" created successfully',
        previewUrl: 'http://localhost:3000?type=diagram&id=test-id',
      };

      const result = parseArtifactNotification(response);

      // Empty string name returns null as it's not a valid artifact name
      expect(result).toBeNull();
    });

    it('should use first quoted string when multiple quotes exist', () => {
      const response = {
        success: true,
        id: 'test-id',
        message:
          'Diagram "First Diagram" created from template "Second Template"',
        previewUrl: 'http://localhost:3000?type=diagram&id=test-id',
      };

      const result = parseArtifactNotification(response);

      expect(result?.name).toBe('First Diagram');
    });
  });

  describe('Case-insensitive matching', () => {
    it('should match "DIAGRAM" in uppercase', () => {
      const response = {
        success: true,
        id: 'test-id',
        message: 'Test "Name" created successfully',
        previewUrl: 'http://localhost:3000?DIAGRAM=true&id=test-id',
      };

      const result = parseArtifactNotification(response);

      expect(result?.artifactType).toBe('diagram');
    });

    it('should match "DOCUMENT" in uppercase', () => {
      const response = {
        success: true,
        id: 'test-id',
        message: 'Test "Name" created successfully',
        previewUrl: 'http://localhost:3000?DOCUMENT=true&id=test-id',
      };

      const result = parseArtifactNotification(response);

      expect(result?.artifactType).toBe('document');
    });

    it('should match "CREATED" in uppercase', () => {
      const response = {
        success: true,
        id: 'test-id',
        message: 'CREATED diagram "Name"',
        previewUrl: 'http://localhost:3000?type=diagram&id=test-id',
      };

      const result = parseArtifactNotification(response);

      expect(result?.type).toBe('created');
    });

    it('should match "UPDATED" in uppercase', () => {
      const response = {
        success: true,
        id: 'test-id',
        message: 'UPDATED document "Name"',
        previewUrl: 'http://localhost:3000?type=document&id=test-id',
      };

      const result = parseArtifactNotification(response);

      expect(result?.type).toBe('updated');
    });

    it('should match mixed case', () => {
      const response = {
        success: true,
        id: 'test-id',
        message: 'Diagram "Name" CrEaTed successfully',
        previewUrl: 'http://localhost:3000?Type=DiAgRaM&id=test-id',
      };

      const result = parseArtifactNotification(response);

      expect(result?.type).toBe('created');
      expect(result?.artifactType).toBe('diagram');
    });
  });

  describe('Response with extra fields', () => {
    it('should ignore extra fields in response', () => {
      const response = {
        success: true,
        id: 'test-id',
        message: 'Diagram "Test" created successfully',
        previewUrl: 'http://localhost:3000?type=diagram&id=test-id',
        userId: 'user-123',
        timestamp: 1234567890,
        extra: {
          nested: {
            field: 'value',
          },
        },
      };

      const result = parseArtifactNotification(response);

      expect(result).not.toBeNull();
      expect(result?.id).toBe('test-id');
      // Extra fields should not be included in result
      expect((result as any).userId).toBeUndefined();
      expect((result as any).timestamp).toBeUndefined();
    });
  });
});
