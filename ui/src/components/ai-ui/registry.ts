/**
 * AI-UI Component Registry
 *
 * Central registry for all AI-UI components, providing:
 * - Dynamic component lookup by name
 * - Component metadata and validation
 * - Type-safe component access
 * - Component availability checking
 *
 * Manages 32 AI-UI components across 5 categories:
 * - Display: Table, CodeBlock, DiffView, JsonViewer, Markdown, Image, Spinner, Badge
 * - Layout: Card, Section, Columns, Accordion, Alert, Divider
 * - Interactive: Wizard, Checklist, ApprovalButtons, ProgressBar, Tabs, Link
 * - Inputs: MultipleChoice, TextInput, TextArea, Checkbox, Confirmation, RadioGroup, Toggle, NumberInput, Slider, FileUpload
 * - Mermaid: DiagramEmbed, WireframeEmbed
 */

import type React from 'react';

// Import all display components
import { Table } from './display/Table';
import { CodeBlock } from './display/CodeBlock';
import { DiffView } from './display/DiffView';
import { JsonViewer } from './display/JsonViewer';
import { Markdown } from './display/Markdown';
import { Image } from './display/Image';
import { Spinner } from './display/Spinner';
import { Badge } from './display/Badge';

// Import all layout components
import { Card } from './layout/Card';
import { Section } from './layout/Section';
import { Columns } from './layout/Columns';
import { Accordion } from './layout/Accordion';
import { Alert } from './layout/Alert';
import { Divider } from './layout/Divider';

// Import all interactive components
import { Wizard } from './interactive/Wizard';
import { Checklist } from './interactive/Checklist';
import { ApprovalButtons } from './interactive/ApprovalButtons';
import { ProgressBar } from './interactive/ProgressBar';
import { Tabs } from './interactive/Tabs';
import { Link } from './interactive/Link';

// Import all input components
import { MultipleChoice } from './inputs/MultipleChoice';
import { TextInput } from './inputs/TextInput';
import { TextArea } from './inputs/TextArea';
import { Checkbox } from './inputs/Checkbox';
import { Confirmation } from './inputs/Confirmation';
import { RadioGroup } from './inputs/RadioGroup';
import { Toggle } from './inputs/Toggle';
import { NumberInput } from './inputs/NumberInput';
import { Slider } from './inputs/Slider';
import { FileUpload } from './inputs/FileUpload';

// Import all mermaid components
import { DiagramEmbed } from './mermaid/DiagramEmbed';
import { WireframeEmbed } from './mermaid/WireframeEmbed';

/**
 * Component metadata for registry
 */
export interface ComponentMetadata {
  name: string;
  category: 'display' | 'layout' | 'interactive' | 'inputs' | 'mermaid';
  description: string;
  component: React.ComponentType<any>;
}

/**
 * Registry of all AI-UI components with metadata
 */
const componentRegistry: Map<string, ComponentMetadata> = new Map([
  // Display components (8)
  [
    'Table',
    {
      name: 'Table',
      category: 'display',
      description: 'Tabular data display component',
      component: Table,
    },
  ],
  [
    'CodeBlock',
    {
      name: 'CodeBlock',
      category: 'display',
      description: 'Code syntax highlighting component',
      component: CodeBlock,
    },
  ],
  [
    'DiffView',
    {
      name: 'DiffView',
      category: 'display',
      description: 'Diff/comparison viewer component',
      component: DiffView,
    },
  ],
  [
    'JsonViewer',
    {
      name: 'JsonViewer',
      category: 'display',
      description: 'JSON data viewer component',
      component: JsonViewer,
    },
  ],
  [
    'Markdown',
    {
      name: 'Markdown',
      category: 'display',
      description: 'Markdown renderer component',
      component: Markdown,
    },
  ],
  [
    'Image',
    {
      name: 'Image',
      category: 'display',
      description: 'Image display with caption',
      component: Image,
    },
  ],
  [
    'Spinner',
    {
      name: 'Spinner',
      category: 'display',
      description: 'Loading spinner indicator',
      component: Spinner,
    },
  ],
  [
    'Badge',
    {
      name: 'Badge',
      category: 'display',
      description: 'Status badge/tag component',
      component: Badge,
    },
  ],

  // Layout components (6)
  [
    'Card',
    {
      name: 'Card',
      category: 'layout',
      description: 'Container with title, subtitle, and footer',
      component: Card,
    },
  ],
  [
    'Section',
    {
      name: 'Section',
      category: 'layout',
      description: 'Section with heading and content',
      component: Section,
    },
  ],
  [
    'Columns',
    {
      name: 'Columns',
      category: 'layout',
      description: 'Multi-column layout container',
      component: Columns,
    },
  ],
  [
    'Accordion',
    {
      name: 'Accordion',
      category: 'layout',
      description: 'Collapsible accordion sections',
      component: Accordion,
    },
  ],
  [
    'Alert',
    {
      name: 'Alert',
      category: 'layout',
      description: 'Alert/notification component',
      component: Alert,
    },
  ],
  [
    'Divider',
    {
      name: 'Divider',
      category: 'layout',
      description: 'Visual separator with optional label',
      component: Divider,
    },
  ],

  // Interactive components (6)
  [
    'Wizard',
    {
      name: 'Wizard',
      category: 'interactive',
      description: 'Multi-step wizard component',
      component: Wizard,
    },
  ],
  [
    'Checklist',
    {
      name: 'Checklist',
      category: 'interactive',
      description: 'Checklist with nested items',
      component: Checklist,
    },
  ],
  [
    'ApprovalButtons',
    {
      name: 'ApprovalButtons',
      category: 'interactive',
      description: 'Approval/action buttons component',
      component: ApprovalButtons,
    },
  ],
  [
    'ProgressBar',
    {
      name: 'ProgressBar',
      category: 'interactive',
      description: 'Progress indicator component',
      component: ProgressBar,
    },
  ],
  [
    'Tabs',
    {
      name: 'Tabs',
      category: 'interactive',
      description: 'Tabbed content component',
      component: Tabs,
    },
  ],
  [
    'Link',
    {
      name: 'Link',
      category: 'interactive',
      description: 'Clickable link/button component',
      component: Link,
    },
  ],

  // Input components (10)
  [
    'MultipleChoice',
    {
      name: 'MultipleChoice',
      category: 'inputs',
      description: 'Multiple choice selection component',
      component: MultipleChoice,
    },
  ],
  [
    'TextInput',
    {
      name: 'TextInput',
      category: 'inputs',
      description: 'Text input field component',
      component: TextInput,
    },
  ],
  [
    'TextArea',
    {
      name: 'TextArea',
      category: 'inputs',
      description: 'Text area input component',
      component: TextArea,
    },
  ],
  [
    'Checkbox',
    {
      name: 'Checkbox',
      category: 'inputs',
      description: 'Checkbox selection component',
      component: Checkbox,
    },
  ],
  [
    'Confirmation',
    {
      name: 'Confirmation',
      category: 'inputs',
      description: 'Confirmation dialog component',
      component: Confirmation,
    },
  ],
  [
    'RadioGroup',
    {
      name: 'RadioGroup',
      category: 'inputs',
      description: 'Radio button group for single selection',
      component: RadioGroup,
    },
  ],
  [
    'Toggle',
    {
      name: 'Toggle',
      category: 'inputs',
      description: 'Toggle switch for boolean values',
      component: Toggle,
    },
  ],
  [
    'NumberInput',
    {
      name: 'NumberInput',
      category: 'inputs',
      description: 'Number input with increment/decrement',
      component: NumberInput,
    },
  ],
  [
    'Slider',
    {
      name: 'Slider',
      category: 'inputs',
      description: 'Range slider for numeric values',
      component: Slider,
    },
  ],
  [
    'FileUpload',
    {
      name: 'FileUpload',
      category: 'inputs',
      description: 'File upload with drag and drop',
      component: FileUpload,
    },
  ],

  // Mermaid components (2)
  [
    'DiagramEmbed',
    {
      name: 'DiagramEmbed',
      category: 'mermaid',
      description: 'Inline Mermaid diagram embedding',
      component: DiagramEmbed,
    },
  ],
  [
    'WireframeEmbed',
    {
      name: 'WireframeEmbed',
      category: 'mermaid',
      description: 'Inline wireframe preview embedding',
      component: WireframeEmbed,
    },
  ],
]);

/**
 * Get a component by name
 * @param name - Component name
 * @returns Component or undefined if not found
 */
export function getComponent(
  name: string
): React.ComponentType<any> | undefined {
  const metadata = componentRegistry.get(name);
  return metadata?.component;
}

/**
 * Get component metadata by name
 * @param name - Component name
 * @returns Component metadata or undefined if not found
 */
export function getComponentMetadata(name: string): ComponentMetadata | undefined {
  return componentRegistry.get(name);
}

/**
 * Check if a component is registered
 * @param name - Component name
 * @returns True if component is registered, false otherwise
 */
export function hasComponent(name: string): boolean {
  return componentRegistry.has(name);
}

/**
 * Get all registered component names
 * @returns Array of component names
 */
export function getAllComponentNames(): string[] {
  return Array.from(componentRegistry.keys());
}

/**
 * Get all registered components
 * @returns Array of component metadata
 */
export function getAllComponents(): ComponentMetadata[] {
  return Array.from(componentRegistry.values());
}

/**
 * Get components by category
 * @param category - Component category
 * @returns Array of component metadata for the category
 */
export function getComponentsByCategory(
  category: 'display' | 'layout' | 'interactive' | 'inputs' | 'mermaid'
): ComponentMetadata[] {
  return Array.from(componentRegistry.values()).filter(
    (meta) => meta.category === category
  );
}

/**
 * Validate that a component name is registered
 * @param name - Component name to validate
 * @throws Error if component is not found
 * @returns Component metadata if valid
 */
export function validateComponent(name: string): ComponentMetadata {
  const metadata = componentRegistry.get(name);
  if (!metadata) {
    throw new Error(
      `Component "${name}" is not registered. ` +
        `Available components: ${Array.from(componentRegistry.keys()).join(', ')}`
    );
  }
  return metadata;
}

/**
 * Get count of registered components
 * @returns Total number of registered components
 */
export function getComponentCount(): number {
  return componentRegistry.size;
}

/**
 * Get category statistics
 * @returns Object with count per category
 */
export function getCategoryStats(): Record<string, number> {
  const stats: Record<string, number> = {
    display: 0,
    layout: 0,
    interactive: 0,
    inputs: 0,
    mermaid: 0,
  };

  for (const metadata of componentRegistry.values()) {
    stats[metadata.category]++;
  }

  return stats;
}

/**
 * Export default registry object for convenience
 */
export const aiUIRegistry = {
  getComponent,
  getComponentMetadata,
  hasComponent,
  getAllComponentNames,
  getAllComponents,
  getComponentsByCategory,
  validateComponent,
  getComponentCount,
  getCategoryStats,
};

export default aiUIRegistry;
