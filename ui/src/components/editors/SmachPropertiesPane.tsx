/**
 * SmachPropertiesPane Component
 *
 * A properties panel for editing SMACH (State Machine) diagram states.
 * Displays and allows editing of:
 * - State name
 * - State description
 * - State transitions (outcome -> target)
 *
 * Includes utility functions for SMACH content detection and parsing.
 */

import React, { useState } from 'react';
import yaml from 'js-yaml';

/**
 * Represents a state in a SMACH diagram
 */
export interface SmachState {
  name: string;
  description?: string;
  transitions: Array<{ outcome: string; target: string }>;
}

/**
 * Props for the SmachPropertiesPane component
 */
export interface SmachPropertiesPaneProps {
  /** The state to display/edit, or null if no state selected */
  state: SmachState | null;
  /** Callback when description is edited */
  onEditDescription: (description: string) => void;
  /** Callback when a transition is edited */
  onEditTransition: (index: number, outcome: string, target: string) => void;
  /** Callback to add a new transition */
  onAddTransition: () => void;
  /** Callback to remove a transition by index */
  onRemoveTransition: (index: number) => void;
  /** Callback when the pane is closed */
  onClose: () => void;
  /** Optional CSS class name */
  className?: string;
}

/**
 * Check if content is a SMACH diagram
 * @param content - The content to check
 * @returns true if the content appears to be a SMACH diagram
 */
export function isSmachContent(content: string): boolean {
  return /^\s*smach_diagram\s*:/m.test(content);
}

/**
 * Parse a SMACH state from YAML content
 * @param content - The YAML content of the SMACH diagram
 * @param stateName - The name of the state to parse
 * @returns The parsed SmachState or null if not found or invalid
 */
export function parseSmachState(content: string, stateName: string): SmachState | null {
  try {
    const parsed = yaml.load(content) as {
      smach_diagram?: {
        states?: Record<string, {
          description?: string;
          transitions?: Record<string, string>;
        }>;
      };
    };

    const states = parsed?.smach_diagram?.states || {};
    const stateData = states[stateName];

    if (!stateData) {
      return null;
    }

    const transitions: Array<{ outcome: string; target: string }> = [];
    for (const [outcome, target] of Object.entries(stateData.transitions || {})) {
      transitions.push({ outcome, target });
    }

    return {
      name: stateName,
      description: stateData.description || '',
      transitions,
    };
  } catch {
    return null;
  }
}

/**
 * SmachPropertiesPane Component
 *
 * Displays a properties panel for editing a SMACH state's description
 * and transitions.
 *
 * @example
 * ```tsx
 * <SmachPropertiesPane
 *   state={{ name: 'IDLE', description: 'Initial state', transitions: [] }}
 *   onEditDescription={(desc) => console.log('New description:', desc)}
 *   onEditTransition={(i, outcome, target) => console.log('Edit transition', i)}
 *   onAddTransition={() => console.log('Add transition')}
 *   onRemoveTransition={(i) => console.log('Remove transition', i)}
 *   onClose={() => console.log('Close')}
 * />
 * ```
 */
export const SmachPropertiesPane: React.FC<SmachPropertiesPaneProps> = ({
  state,
  onEditDescription,
  onEditTransition,
  onAddTransition,
  onRemoveTransition,
  onClose,
  className,
}) => {
  const [editingDescription, setEditingDescription] = useState(false);
  const [descriptionValue, setDescriptionValue] = useState(state?.description || '');

  // Reset description value when state changes
  React.useEffect(() => {
    setDescriptionValue(state?.description || '');
    setEditingDescription(false);
  }, [state?.name, state?.description]);

  if (!state) {
    return null;
  }

  const handleSaveDescription = () => {
    onEditDescription(descriptionValue);
    setEditingDescription(false);
  };

  return (
    <div className={`${className || ''} bg-white dark:bg-gray-800 border-l p-4 w-80`}>
      {/* Header */}
      <div className="flex justify-between items-center mb-4">
        <h3 className="font-semibold">{state.name}</h3>
        <button onClick={onClose}>✕</button>
      </div>

      {/* Description */}
      <section className="mb-4">
        <label className="text-sm font-medium">Description</label>
        {editingDescription ? (
          <>
            <textarea
              value={descriptionValue}
              onChange={(e) => setDescriptionValue(e.target.value)}
              className="w-full border rounded p-2"
            />
            <div className="flex gap-2 mt-1">
              <button onClick={handleSaveDescription}>Save</button>
              <button onClick={() => setEditingDescription(false)}>Cancel</button>
            </div>
          </>
        ) : (
          <>
            <p className="text-gray-600 dark:text-gray-400">
              {state.description || '(none)'}
            </p>
            <button onClick={() => setEditingDescription(true)}>Edit</button>
          </>
        )}
      </section>

      {/* Transitions */}
      <section>
        <label className="text-sm font-medium">Transitions</label>
        <ul className="space-y-2 mt-2">
          {state.transitions.map((transition, i) => (
            <li
              key={i}
              className="flex items-center gap-2 p-2 bg-gray-50 dark:bg-gray-700 rounded"
            >
              <span className="font-mono text-sm">{transition.outcome}</span>
              <span>→</span>
              <span>{transition.target}</span>
              <button
                onClick={() => onRemoveTransition(i)}
                className="ml-auto text-red-500"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
        <button onClick={onAddTransition} className="mt-2 text-blue-500">
          + Add Transition
        </button>
      </section>
    </div>
  );
};

export default SmachPropertiesPane;
