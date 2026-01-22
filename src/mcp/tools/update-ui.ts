/**
 * MCP Tool: update_ui
 *
 * Updates the currently displayed UI without full re-render by applying a patch.
 * Takes a partial UI component and applies it to the current UI state in the browser.
 *
 * Parameters:
 * - project: Project path
 * - session: Session name
 * - patch: Partial<AnyComponent> - partial update to current UI
 *
 * Returns:
 * - success: boolean
 * - message?: string
 */

const API_PORT = parseInt(process.env.PORT || '3737', 10);
const API_HOST = process.env.HOST || 'localhost';
const API_BASE_URL = `http://${API_HOST}:${API_PORT}`;

/**
 * Build URL with project and session query params
 */
function buildUrl(path: string, project: string, session: string): string {
  const url = new URL(path, API_BASE_URL);
  url.searchParams.set('project', project);
  url.searchParams.set('session', session);
  return url.toString();
}

/**
 * Update the currently displayed UI with a partial patch
 * Applies patch to current UI and broadcasts update to browser via WebSocket
 */
export async function updateUI(
  project: string,
  session: string,
  patch: Record<string, any>
): Promise<string> {
  try {
    // Validate patch is an object (but not an array or null)
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      throw new Error('patch must be a valid object');
    }

    // Send update request to the server
    const response = await fetch(buildUrl('/api/update-ui', project, session), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ patch }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(
        `Failed to update UI: ${error.error || response.statusText}`
      );
    }

    const data = await response.json();
    return JSON.stringify({
      success: true,
      message: data.message || 'UI updated successfully',
    }, null, 2);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(errorMessage);
  }
}

/**
 * Tool input schema for MCP
 */
export const updateUISchema = {
  type: 'object',
  properties: {
    project: {
      type: 'string',
      description: 'Absolute path to the project root directory',
    },
    session: {
      type: 'string',
      description: 'Session name (e.g., "bright-calm-river")',
    },
    patch: {
      type: 'object',
      description: 'Partial UI component patch to apply to current UI',
      additionalProperties: true,
    },
  },
  required: ['project', 'session', 'patch'],
};
