/**
 * Question Panel Components
 *
 * Exports for the question panel module:
 * - QuestionPanel: Main overlay panel for displaying Claude questions
 * - QuestionRenderer: Renders question UI using ai-ui-registry
 * - QuestionHistory: Displays history of previous questions and responses
 */

export { QuestionPanel, default as QuestionPanelComponent } from './QuestionPanel';
export { QuestionRenderer, default as QuestionRendererComponent } from './QuestionRenderer';
export { QuestionHistory, default as QuestionHistoryComponent } from './QuestionHistory';

export type { QuestionRendererProps } from './QuestionRenderer';
export type { QuestionHistoryProps } from './QuestionHistory';
