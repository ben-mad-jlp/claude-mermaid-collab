/**
 * AI-UI Component Types for json-render Integration
 *
 * This file defines all 22 components used in the AI-powered UI system.
 * Components are grouped into 5 categories:
 * - Input Components (5): MultipleChoice, TextInput, TextArea, Checkbox, Confirmation
 * - Data Display (5): Table, CodeBlock, DiffView, JsonViewer, Markdown
 * - Interactive (5): Wizard, Checklist, ApprovalButtons, ProgressBar, Tabs
 * - Layout (5): Card, Section, Columns, Accordion, Alert
 * - Mermaid Integration (2): DiagramEmbed, WireframeEmbed
 */

// ============================================================================
// BASE TYPES
// ============================================================================

/**
 * Base interface for all UI components
 * Compatible with json-render schema
 */
export interface UIComponent {
  type: string;
  props: Record<string, any>;
  children?: UIComponent[];
  actions?: UIAction[];
}

/**
 * Action that a component can trigger
 * Used for interactive elements and form submissions
 */
export interface UIAction {
  id: string;
  label: string;
  primary?: boolean;
  destructive?: boolean;
  alignment?: 'left' | 'center' | 'right';
}

/**
 * Common props shared by many components
 */
export interface CommonProps {
  className?: string;
  style?: Record<string, any>;
  hidden?: boolean;
}

/**
 * Response data returned when a user interacts with a component
 */
export interface UIResponse {
  componentId: string;
  actionId: string;
  data?: Record<string, any>;
  timestamp: number;
}

// ============================================================================
// INPUT COMPONENTS
// ============================================================================

/**
 * MultipleChoice Component
 * Select one option from a list of options
 */
export interface MultipleChoiceProps extends CommonProps {
  options: Array<{
    value: string;
    label: string;
    description?: string;
  }>;
  defaultValue?: string;
  allowCustom?: boolean;
  columns?: number;
  required?: boolean;
  disabled?: boolean;
}

export interface MultipleChoice extends UIComponent {
  type: 'MultipleChoice';
  props: MultipleChoiceProps;
}

/**
 * TextInput Component
 * Single-line text entry field
 */
export interface TextInputProps extends CommonProps {
  placeholder?: string;
  defaultValue?: string;
  validation?: {
    pattern?: string;
    minLength?: number;
    maxLength?: number;
    required?: boolean;
    customValidator?: string;
  };
  disabled?: boolean;
  readOnly?: boolean;
  type?: 'text' | 'email' | 'password' | 'number' | 'url';
}

export interface TextInput extends UIComponent {
  type: 'TextInput';
  props: TextInputProps;
}

/**
 * TextArea Component
 * Multi-line text entry field
 */
export interface TextAreaProps extends CommonProps {
  placeholder?: string;
  defaultValue?: string;
  rows?: number;
  maxLength?: number;
  disabled?: boolean;
  readOnly?: boolean;
  monospace?: boolean;
}

export interface TextArea extends UIComponent {
  type: 'TextArea';
  props: TextAreaProps;
}

/**
 * Checkbox Component
 * Toggle or multi-select items
 */
export interface CheckboxProps extends CommonProps {
  options: Array<{
    value: string;
    label: string;
  }>;
  checked?: string[];
  required?: boolean;
  disabled?: boolean;
  allowSelectAll?: boolean;
}

export interface Checkbox extends UIComponent {
  type: 'Checkbox';
  props: CheckboxProps;
}

/**
 * Confirmation Component
 * Yes/No or Accept/Reject style confirmation
 */
export interface ConfirmationProps extends CommonProps {
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  message?: string;
  details?: string;
}

export interface Confirmation extends UIComponent {
  type: 'Confirmation';
  props: ConfirmationProps;
}

// ============================================================================
// DATA DISPLAY COMPONENTS
// ============================================================================

/**
 * Table Component
 * Structured data display with optional sorting and selection
 */
export interface TableProps extends CommonProps {
  columns: Array<{
    key: string;
    label: string;
    width?: string;
    sortable?: boolean;
    renderer?: string;
  }>;
  rows: Array<Record<string, any>>;
  sortable?: boolean;
  selectable?: boolean;
  paginated?: boolean;
  pageSize?: number;
  rowsPerPageOptions?: number[];
  striped?: boolean;
  bordered?: boolean;
}

export interface Table extends UIComponent {
  type: 'Table';
  props: TableProps;
}

/**
 * CodeBlock Component
 * Syntax-highlighted code display
 */
export interface CodeBlockProps extends CommonProps {
  code: string;
  language?: string;
  lineNumbers?: boolean;
  highlightLines?: number[];
  diff?: boolean;
  copyButton?: boolean;
  maxHeight?: string;
}

export interface CodeBlock extends UIComponent {
  type: 'CodeBlock';
  props: CodeBlockProps;
}

/**
 * DiffView Component
 * Side-by-side or unified diff display
 */
export interface DiffViewProps extends CommonProps {
  before: string;
  after: string;
  fileName?: string;
  mode?: 'unified' | 'split';
  contextLines?: number;
  language?: string;
  collapseLargeLines?: boolean;
}

export interface DiffView extends UIComponent {
  type: 'DiffView';
  props: DiffViewProps;
}

/**
 * JsonViewer Component
 * Collapsible JSON tree explorer
 */
export interface JsonViewerProps extends CommonProps {
  data: Record<string, any>;
  collapsed?: boolean;
  expandDepth?: number;
  theme?: 'light' | 'dark';
  copyable?: boolean;
  maxDepth?: number;
}

export interface JsonViewer extends UIComponent {
  type: 'JsonViewer';
  props: JsonViewerProps;
}

/**
 * Markdown Component
 * Rendered markdown content
 */
export interface MarkdownProps extends CommonProps {
  content: string;
  allowHtml?: boolean;
  strikethrough?: boolean;
  tables?: boolean;
  codeHighlight?: boolean;
}

export interface Markdown extends UIComponent {
  type: 'Markdown';
  props: MarkdownProps;
}

// ============================================================================
// INTERACTIVE COMPONENTS
// ============================================================================

/**
 * Wizard Component
 * Multi-step form or process flow
 */
export interface WizardProps extends CommonProps {
  steps: Array<{
    id: string;
    title: string;
    description?: string;
    content: UIComponent;
    optional?: boolean;
  }>;
  currentStep: number;
  allowBack?: boolean;
  allowSkip?: boolean;
  showProgress?: boolean;
}

export interface Wizard extends UIComponent {
  type: 'Wizard';
  props: WizardProps;
}

/**
 * Checklist Component
 * Trackable task list with completion status
 */
export interface ChecklistProps extends CommonProps {
  items: Array<{
    id: string;
    label: string;
    completed?: boolean;
    required?: boolean;
    subItems?: Array<{
      id: string;
      label: string;
      completed?: boolean;
    }>;
  }>;
  allowCheck?: boolean;
  showProgress?: boolean;
  allRequired?: boolean;
}

export interface Checklist extends UIComponent {
  type: 'Checklist';
  props: ChecklistProps;
}

/**
 * ApprovalButtons Component
 * Action buttons for approval, rejection, or custom actions
 */
export interface ApprovalButtonsProps extends CommonProps {
  actions: Array<{
    id: string;
    label: string;
    primary?: boolean;
    destructive?: boolean;
  }>;
  alignment?: 'left' | 'center' | 'right';
  spacing?: 'compact' | 'normal' | 'spacious';
  fullWidth?: boolean;
}

export interface ApprovalButtons extends UIComponent {
  type: 'ApprovalButtons';
  props: ApprovalButtonsProps;
}

/**
 * ProgressBar Component
 * Visual representation of progress
 */
export interface ProgressBarProps extends CommonProps {
  value?: number;
  max?: number;
  label?: string;
  showPercentage?: boolean;
  indeterminate?: boolean;
  color?: 'success' | 'warning' | 'error' | 'info';
  striped?: boolean;
  animated?: boolean;
}

export interface ProgressBar extends UIComponent {
  type: 'ProgressBar';
  props: ProgressBarProps;
}

/**
 * Tabs Component
 * Tabbed content sections with switching capability
 */
export interface TabsProps extends CommonProps {
  tabs: Array<{
    id: string;
    label: string;
    icon?: string;
    disabled?: boolean;
    content: UIComponent;
  }>;
  activeTab: string;
  variant?: 'default' | 'pills' | 'underline';
  fullWidth?: boolean;
}

export interface Tabs extends UIComponent {
  type: 'Tabs';
  props: TabsProps;
}

// ============================================================================
// LAYOUT COMPONENTS
// ============================================================================

/**
 * Card Component
 * Container with optional title, subtitle, and footer
 */
export interface CardProps extends CommonProps {
  title?: string;
  subtitle?: string;
  footer?: string;
  collapsible?: boolean;
  collapsed?: boolean;
  borderColor?: string;
  backgroundColor?: string;
  elevation?: number;
}

export interface Card extends UIComponent {
  type: 'Card';
  props: CardProps;
  children?: UIComponent[];
}

/**
 * Section Component
 * Logical grouping with heading and optional description
 */
export interface SectionProps extends CommonProps {
  heading?: string;
  description?: string;
  level?: 1 | 2 | 3 | 4 | 5 | 6;
  divider?: boolean;
  collapsible?: boolean;
  collapsed?: boolean;
}

export interface Section extends UIComponent {
  type: 'Section';
  props: SectionProps;
  children?: UIComponent[];
}

/**
 * Columns Component
 * Multi-column layout with responsive support
 */
export interface ColumnsProps extends CommonProps {
  columns: number;
  gap?: number;
  responsive?: boolean;
  breakpoints?: {
    mobile?: number;
    tablet?: number;
    desktop?: number;
  };
  alignItems?: 'start' | 'center' | 'end' | 'stretch';
}

export interface Columns extends UIComponent {
  type: 'Columns';
  props: ColumnsProps;
  children?: UIComponent[];
}

/**
 * Accordion Component
 * Collapsible sections with expand/collapse capability
 */
export interface AccordionProps extends CommonProps {
  sections: Array<{
    id: string;
    title: string;
    content: UIComponent;
    expanded?: boolean;
  }>;
  allowMultiple?: boolean;
  variant?: 'default' | 'flush' | 'outlined';
}

export interface Accordion extends UIComponent {
  type: 'Accordion';
  props: AccordionProps;
}

/**
 * Alert Component
 * Status messages, warnings, errors, or informational content
 */
export interface AlertProps extends CommonProps {
  type: 'success' | 'warning' | 'error' | 'info';
  title?: string;
  message?: string;
  dismissible?: boolean;
  icon?: string;
  actions?: Array<{
    id: string;
    label: string;
  }>;
  persistent?: boolean;
}

export interface Alert extends UIComponent {
  type: 'Alert';
  props: AlertProps;
}

// ============================================================================
// MERMAID INTEGRATION COMPONENTS
// ============================================================================

/**
 * DiagramEmbed Component
 * Inline mermaid diagram display
 */
export interface DiagramEmbedProps extends CommonProps {
  diagramId: string;
  session: string;
  interactive?: boolean;
  maxHeight?: string;
  title?: string;
  description?: string;
}

export interface DiagramEmbed extends UIComponent {
  type: 'DiagramEmbed';
  props: DiagramEmbedProps;
}

/**
 * WireframeEmbed Component
 * Inline wireframe preview display
 */
export interface WireframeEmbedProps extends CommonProps {
  diagramId: string;
  session: string;
  scale?: number;
  title?: string;
  description?: string;
}

export interface WireframeEmbed extends UIComponent {
  type: 'WireframeEmbed';
  props: WireframeEmbedProps;
}

// ============================================================================
// UNION TYPES
// ============================================================================

/**
 * All input component types
 */
export type InputComponent =
  | MultipleChoice
  | TextInput
  | TextArea
  | Checkbox
  | Confirmation;

/**
 * All data display component types
 */
export type DataDisplayComponent =
  | Table
  | CodeBlock
  | DiffView
  | JsonViewer
  | Markdown;

/**
 * All interactive component types
 */
export type InteractiveComponent =
  | Wizard
  | Checklist
  | ApprovalButtons
  | ProgressBar
  | Tabs;

/**
 * All layout component types
 */
export type LayoutComponent =
  | Card
  | Section
  | Columns
  | Accordion
  | Alert;

/**
 * All mermaid integration component types
 */
export type MermaidComponent =
  | DiagramEmbed
  | WireframeEmbed;

/**
 * All possible component types
 */
export type AnyComponent =
  | InputComponent
  | DataDisplayComponent
  | InteractiveComponent
  | LayoutComponent
  | MermaidComponent;

// ============================================================================
// MCP TOOL PARAMETERS & RESULTS
// ============================================================================

/**
 * Parameters for the mermaid__render_ui MCP tool
 */
export interface RenderUIParams {
  project: string;
  session: string;
  ui: AnyComponent;
  blocking?: boolean;
  timeout?: number;
}

/**
 * Result from the mermaid__render_ui MCP tool
 */
export interface RenderUIResult {
  completed: boolean;
  source: 'browser' | 'terminal';
  action?: string;
  data?: Record<string, any>;
}

/**
 * Parameters for the mermaid__update_ui MCP tool
 */
export interface UpdateUIParams {
  project: string;
  session: string;
  patch: Partial<AnyComponent>;
}

/**
 * Parameters for the mermaid__dismiss_ui MCP tool
 */
export interface DismissUIParams {
  project: string;
  session: string;
}

// ============================================================================
// CATALOG METADATA
// ============================================================================

/**
 * Component catalog metadata
 * Lists all 22 components with their categories
 */
export const COMPONENT_CATALOG = {
  input: [
    'MultipleChoice',
    'TextInput',
    'TextArea',
    'Checkbox',
    'Confirmation',
  ],
  dataDisplay: [
    'Table',
    'CodeBlock',
    'DiffView',
    'JsonViewer',
    'Markdown',
  ],
  interactive: [
    'Wizard',
    'Checklist',
    'ApprovalButtons',
    'ProgressBar',
    'Tabs',
  ],
  layout: [
    'Card',
    'Section',
    'Columns',
    'Accordion',
    'Alert',
  ],
  mermaid: [
    'DiagramEmbed',
    'WireframeEmbed',
  ],
} as const;

/**
 * All component names in the catalog
 */
export const ALL_COMPONENTS = [
  ...COMPONENT_CATALOG.input,
  ...COMPONENT_CATALOG.dataDisplay,
  ...COMPONENT_CATALOG.interactive,
  ...COMPONENT_CATALOG.layout,
  ...COMPONENT_CATALOG.mermaid,
] as const;

/**
 * Validation helper: Check if a component type is valid
 */
export function isValidComponentType(type: string): type is AnyComponent['type'] {
  return ALL_COMPONENTS.includes(type as any);
}
