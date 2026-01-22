/**
 * MCP Tool: dismiss_ui
 *
 * Called when user responds to a question in terminal to clear the browser UI.
 * Dismisses the currently displayed UI in the browser question panel.
 *
 * Parameters:
 * - project: Project path
 * - session: Session name
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
 * Dismiss the currently displayed UI in the browser
 * Clears the question panel when user responds in terminal
 */
export async function dismissUI(project: string, session: string): Promise<string> {
  try {
    // Send dismiss request to the server
    const response = await fetch(buildUrl('/api/dismiss-ui', project, session), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(
        `Failed to dismiss UI: ${error.error || response.statusText}`
      );
    }

    const data = await response.json();
    return JSON.stringify({
      success: true,
      message: data.message || 'UI dismissed successfully',
    }, null, 2);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(errorMessage);
  }
}

/**
 * Tool input schema for MCP
 */
export const dismissUISchema = {
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
  },
  required: ['project', 'session'],
};
