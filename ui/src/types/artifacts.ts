/**
 * Artifact Notification Types
 *
 * Defines types for document and diagram creation/update notifications
 * from MCP responses.
 */

export interface ArtifactNotification {
  type: 'created' | 'updated';
  artifactType: 'document' | 'diagram';
  id: string;
  name: string;
}
