import { UINode } from './ai-ui';

/**
 * Question object representing a question from Claude
 * Stores the UI definition, context, and response state
 */
export interface Question {
  /** Unique identifier for the question */
  id: string;

  /** JSON UI definition that browser renders via json-render */
  ui: UINode;

  /** Optional context about what Claude is asking (e.g., skill name) */
  context?: string;

  /** Unix timestamp when question was created */
  timestamp: number;

  /** Whether the question has been answered */
  answered: boolean;

  /** Response data if question has been answered */
  response?: QuestionResponse;
}

/**
 * Response from user to a question
 * Captures which action was taken and any associated data
 */
export interface QuestionResponse {
  /** Action identifier from the UI component */
  action?: string;

  /** Form data or selection results */
  data?: Record<string, unknown>;

  /** Where the response came from (browser UI or terminal) */
  source: 'browser' | 'terminal';

  /** Unix timestamp when response was submitted */
  timestamp: number;
}

/**
 * Parameters for the MCP mermaid__render_ui tool
 * Sends a JSON UI definition to the browser for rendering
 */
export interface RenderUIParams {
  /** Project path for context */
  project: string;

  /** Session name for context */
  session: string;

  /** JSON UI definition (follows json-render schema) */
  ui: UINode;

  /** Whether to block until user action received (default: true) */
  blocking?: boolean;

  /** Timeout in milliseconds (default: no timeout) */
  timeout?: number;
}

/**
 * Result from mermaid__render_ui tool
 * Returns the action taken by the user or timeout status
 */
export interface RenderUIResult {
  /** True if action was received before timeout */
  completed: boolean;

  /** Where the response came from */
  source: 'browser' | 'terminal';

  /** Action identifier that was triggered */
  action?: string;

  /** Form data or structured response data */
  data?: Record<string, unknown>;
}

/**
 * Parameters for the MCP mermaid__dismiss_ui tool
 * Dismisses the current UI display in the browser
 */
export interface DismissUIParams {
  /** Project path for context */
  project: string;

  /** Session name for context */
  session: string;
}

/**
 * Parameters for the MCP mermaid__update_ui tool
 * Updates the currently displayed UI without full re-render
 */
export interface UpdateUIParams {
  /** Project path for context */
  project: string;

  /** Session name for context */
  session: string;

  /** Partial UI definition to apply as patch */
  patch: Partial<UINode>;
}

/**
 * Question state for store tracking
 * Used internally by the question store
 */
export interface QuestionState {
  /** Currently pending question from Claude (null if none) */
  pendingQuestion: Question | null;

  /** History of all questions in this session */
  questionHistory: Question[];
}

/**
 * Question store actions
 * Methods for managing question state
 */
export interface QuestionStoreActions {
  /**
   * Receive a new question from Claude
   * Automatically opens the question panel
   */
  receiveQuestion: (
    id: string,
    ui: UINode,
    context?: string
  ) => void;

  /**
   * Submit a response to the current question
   * Sends response back to Claude via MCP
   */
  answerQuestion: (response: QuestionResponse) => void;

  /**
   * Dismiss the current question without answering
   * Used when user answers in terminal instead
   */
  dismissQuestion: () => void;

  /**
   * Clear question history
   */
  clearHistory: () => void;
}
