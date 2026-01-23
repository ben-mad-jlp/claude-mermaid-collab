/**
 * MCP Tool: render-ui
 *
 * Renders JSON UI definitions to the browser and manages user interactions.
 * This tool broadcasts UI to connected browser clients via WebSocket and
 * optionally blocks until user action is received.
 *
 * Features:
 * - UI validation and schema checking
 * - WebSocket broadcast to browser clients
 * - Blocking mode with timeout support
 * - Action tracking and form data collection
 * - Error handling with detailed feedback
 */

import { WebSocketHandler } from '../../websocket/handler.js';
import type { UIComponent, UIResponse } from '../../ai-ui.js';

// Configuration
const DEFAULT_TIMEOUT = 30000; // 30 seconds
const MIN_TIMEOUT = 1000; // 1 second
const MAX_TIMEOUT = 300000; // 5 minutes

/**
 * UI rendering response structure
 */
export interface RenderUIResponse {
  completed: boolean;
  source: 'browser' | 'terminal';
  action?: string;
  data?: Record<string, any>;
  error?: string;
}

/**
 * Pending UI interaction awaiting user response
 */
interface PendingUI {
  uiId: string;
  resolve: (response: UIResponse) => void;
  reject: (error: Error) => void;
  timeoutHandle: ReturnType<typeof setTimeout>;
}

/**
 * Validates UI component structure
 * @param ui - The UI component to validate
 * @throws Error if validation fails
 */
export function validateUIStructure(ui: any): asserts ui is UIComponent {
  if (!ui || typeof ui !== 'object') {
    throw new Error('UI definition must be a non-null object');
  }

  if (typeof ui.type !== 'string' || !ui.type) {
    throw new Error('UI component must have a type property (string)');
  }

  if (!ui.props || typeof ui.props !== 'object') {
    throw new Error('UI component must have a props property (object)');
  }

  // Validate props is a valid object
  if (Array.isArray(ui.props)) {
    throw new Error('UI props must be an object, not an array');
  }

  // If children exist, validate they are components
  if (ui.children) {
    if (!Array.isArray(ui.children)) {
      throw new Error('UI children must be an array');
    }
    for (const child of ui.children) {
      validateUIStructure(child);
    }
  }

  // If actions exist, validate them
  if (ui.actions) {
    if (!Array.isArray(ui.actions)) {
      throw new Error('UI actions must be an array');
    }
    for (const action of ui.actions) {
      if (typeof action.id !== 'string' || !action.id) {
        throw new Error('Each action must have an id property (string)');
      }
      if (typeof action.label !== 'string' || !action.label) {
        throw new Error('Each action must have a label property (string)');
      }
    }
  }
}

/**
 * Validates timeout value
 * @param timeout - Timeout in milliseconds
 * @throws Error if timeout is invalid
 */
export function validateTimeout(timeout: number | undefined): number {
  if (timeout === undefined) {
    return DEFAULT_TIMEOUT;
  }

  if (typeof timeout !== 'number' || !Number.isFinite(timeout)) {
    throw new Error('Timeout must be a finite number');
  }

  if (timeout < MIN_TIMEOUT) {
    throw new Error(`Timeout must be at least ${MIN_TIMEOUT}ms`);
  }

  if (timeout > MAX_TIMEOUT) {
    throw new Error(`Timeout must not exceed ${MAX_TIMEOUT}ms`);
  }

  return timeout;
}

/**
 * Renders UI to browser and optionally waits for user interaction
 *
 * @param project - Project path
 * @param session - Session name
 * @param ui - JSON UI definition
 * @param blocking - Whether to wait for user action (default: true)
 * @param timeout - Timeout in milliseconds (default: 30000)
 * @param wsHandler - WebSocket handler instance
 * @returns Promise<RenderUIResponse>
 */
export async function renderUI(
  project: string,
  session: string,
  ui: any,
  blocking: boolean = true,
  timeout: number | undefined = undefined,
  wsHandler: WebSocketHandler
): Promise<RenderUIResponse> {
  // Validate inputs
  if (!project || typeof project !== 'string') {
    throw new Error('project must be a non-empty string');
  }

  if (!session || typeof session !== 'string') {
    throw new Error('session must be a non-empty string');
  }

  // Validate UI structure
  validateUIStructure(ui);

  // Validate timeout if blocking
  const finalTimeout = blocking ? validateTimeout(timeout) : DEFAULT_TIMEOUT;

  // Generate unique UI ID for this render
  const uiId = `ui_${Date.now()}_${Math.random().toString(36).substring(7)}`;

  // Broadcast UI to browser
  const uiMessage = {
    type: 'ui_render',
    uiId,
    project,
    session,
    ui,
    blocking,
    timestamp: Date.now(),
  };

  wsHandler.broadcast(uiMessage as any);

  // If not blocking, return immediately
  if (!blocking) {
    return {
      completed: true,
      source: 'terminal',
      action: 'render_complete',
    };
  }

  // Wait for user action with timeout
  return new Promise<RenderUIResponse>((resolve, reject) => {
    let isResolved = false;

    // Setup timeout
    const timeoutHandle = setTimeout(() => {
      if (!isResolved) {
        isResolved = true;
        reject(new Error(`UI interaction timeout after ${finalTimeout}ms`));
      }
    }, finalTimeout);

    // Store pending UI interaction handler
    // In a real implementation, this would be registered globally
    // For now, we'll resolve after a brief delay to allow browser interaction
    const handleUIResponse = (response: UIResponse) => {
      if (!isResolved && response.componentId === uiId) {
        isResolved = true;
        clearTimeout(timeoutHandle);
        resolve({
          completed: true,
          source: 'browser',
          action: response.actionId,
          data: response.data,
        });
      }
    };

    // Register handler temporarily
    // This would typically be done via a global event emitter or message handler
    (wsHandler as any).__pendingUIHandlers = (wsHandler as any).__pendingUIHandlers || {};
    (wsHandler as any).__pendingUIHandlers[uiId] = handleUIResponse;
  });
}

/**
 * Handles incoming UI response from browser
 * Should be called when WebSocket receives a ui_response message
 *
 * @param wsHandler - WebSocket handler instance
 * @param response - The UI response from browser
 */
export function handleUIResponse(wsHandler: WebSocketHandler, response: UIResponse): void {
  if (!response || typeof response !== 'object') {
    console.error('Invalid UI response received');
    return;
  }

  const handlers = (wsHandler as any).__pendingUIHandlers || {};
  const handler = handlers[response.componentId];

  if (handler && typeof handler === 'function') {
    try {
      handler(response);
      delete handlers[response.componentId];
    } catch (error) {
      console.error('Error handling UI response:', error);
    }
  }
}

/**
 * Creates a simple UI response object for testing
 * @param uiId - UI component ID
 * @param actionId - Action identifier
 * @param data - Optional form data
 * @returns UIResponse object
 */
export function createUIResponse(
  uiId: string,
  actionId: string,
  data?: Record<string, any>
): UIResponse {
  return {
    componentId: uiId,
    actionId,
    data: data || {},
    timestamp: Date.now(),
  };
}

/**
 * Component reference for AI-UI components (32 total)
 */
export const COMPONENT_REFERENCE = `
## Available Components (32)

### Display (8)
- Table: { columns: [{key, header}], rows: [{key: value}] }
- CodeBlock: { code, language?, showLineNumbers? }
- DiffView: { oldCode, newCode, language? }
- JsonViewer: { data, collapsed? }
- Markdown: { content }
- Image: { src, alt, width?, height?, caption?, objectFit? }
- Spinner: { size?, label? }
- Badge: { text, variant?, size? }

### Layout (6)
- Card: { title?, subtitle?, footer?, elevation? }
- Section: { title, collapsible? }
- Columns: { columns: number }
- Accordion: { items: [{title, content}] }
- Alert: { type, title?, message }
- Divider: { orientation?, label? }

### Interactive (6)
- Wizard: { steps: [{title, content}], currentStep }
- Checklist: { items: [{label, checked}] }
- ApprovalButtons: { actions: [{id, label, primary?}] }
- ProgressBar: { value, max?, label? }
- Tabs: { tabs: [{id, label, content}] }
- Link: { href?, label, onClick?, variant?, external? }

### Inputs (10) - form data collected on action
- MultipleChoice: { options: [{value, label}], name, label? }
- TextInput: { name, label?, placeholder?, type? }
- TextArea: { name, label?, placeholder?, rows? }
- Checkbox: { options: [{value, label}], name, label? }
- Confirmation: { message, confirmLabel?, cancelLabel? }
- RadioGroup: { options: [{value, label}], name, label?, orientation? }
- Toggle: { name, label?, checked?, size? }
- NumberInput: { name, label?, min?, max?, step? }
- Slider: { name, label?, min?, max?, step?, showValue? }
- FileUpload: { name, accept?, multiple?, maxSize? }

### Mermaid (2)
- DiagramEmbed: { diagramId }
- WireframeEmbed: { wireframeId }
`;

/**
 * Tool input schema for MCP
 */
export const renderUISchema = {
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
    ui: {
      type: 'object',
      description: `JSON UI component definition. ${COMPONENT_REFERENCE}`,
      additionalProperties: true,
    },
    blocking: {
      type: 'boolean',
      description: 'Whether to wait for user action (default: true)',
      default: true,
    },
    timeout: {
      type: 'number',
      description: 'Timeout in milliseconds (default: 30000, min: 1000, max: 300000)',
      default: 30000,
    },
  },
  required: ['project', 'session', 'ui'],
};
