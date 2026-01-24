/**
 * Artifact Notification Parser
 *
 * Parses MCP responses to extract artifact creation/update notifications.
 */

import { ArtifactNotification } from '../types/artifacts';

/**
 * Parses an MCP response and extracts artifact notification information.
 *
 * @param mcpResponse - The response object from an MCP call
 * @returns ArtifactNotification if parsing succeeds, null otherwise
 */
export function parseArtifactNotification(
  mcpResponse: any
): ArtifactNotification | null {
  // Validate basic response structure
  if (!mcpResponse || typeof mcpResponse !== 'object') {
    return null;
  }

  if (mcpResponse.success !== true) {
    return null;
  }

  if (!mcpResponse.id || typeof mcpResponse.id !== 'string') {
    return null;
  }

  if (!mcpResponse.previewUrl || typeof mcpResponse.previewUrl !== 'string') {
    return null;
  }

  if (!mcpResponse.message || typeof mcpResponse.message !== 'string') {
    return null;
  }

  // Determine artifact type from previewUrl
  const artifactType = extractArtifactType(mcpResponse.previewUrl);
  if (!artifactType) {
    return null;
  }

  // Determine notification type from message
  const notificationType = extractNotificationType(mcpResponse.message);
  if (!notificationType) {
    return null;
  }

  // Extract artifact name from message
  const name = extractArtifactName(mcpResponse.message);
  if (!name || name.trim().length === 0) {
    return null;
  }

  return {
    type: notificationType,
    artifactType,
    id: mcpResponse.id,
    name,
  };
}

/**
 * Extracts the artifact type (document or diagram) from a previewUrl.
 *
 * Looks for "diagram" or "document" in the URL string.
 *
 * @param previewUrl - The preview URL from MCP response
 * @returns 'diagram' | 'document' | null
 */
function extractArtifactType(previewUrl: string): 'diagram' | 'document' | null {
  const lowerUrl = previewUrl.toLowerCase();

  if (lowerUrl.includes('diagram')) {
    return 'diagram';
  }

  if (lowerUrl.includes('document')) {
    return 'document';
  }

  return null;
}

/**
 * Extracts the notification type (created or updated) from a message.
 *
 * Looks for "created" or "updated" keywords in the message.
 *
 * @param message - The message from MCP response
 * @returns 'created' | 'updated' | null
 */
function extractNotificationType(
  message: string
): 'created' | 'updated' | null {
  const lowerMessage = message.toLowerCase();

  // Check for "created" first (in case both appear, use the first match)
  if (lowerMessage.includes('created')) {
    return 'created';
  }

  if (lowerMessage.includes('updated')) {
    return 'updated';
  }

  return null;
}

/**
 * Extracts the artifact name from a message.
 *
 * Looks for the first quoted string in the message.
 * Format: ...text "artifact name" text...
 *
 * @param message - The message from MCP response
 * @returns The artifact name or null
 */
function extractArtifactName(message: string): string | null {
  // Match the first quoted string
  const match = message.match(/"([^"]+)"/);

  if (match && match[1]) {
    return match[1];
  }

  return null;
}
