/**
 * Properties Pane Component for SMACH Diagram Editing
 *
 * Displays a right-side panel for:
 * - Adding new states to the diagram
 * - Adding transitions from the selected state
 * - Editing state properties (name, description, etc.)
 */

import React, { useState, useCallback } from 'react';

export interface PropertiesPaneProps {
  /** Currently selected node ID from diagram clicks (null if no selection) */
  selectedNodeId: string | null;
  /** Callback to add a new state to the diagram */
  onAddState: () => void;
  /** Callback to add a transition from the selected state */
  onAddTransition: (fromId: string) => void;
  /** Callback to update state properties */
  onEditProperties: (nodeId: string, props: Record<string, unknown>) => void;
}

/**
 * Properties Pane Component
 *
 * Right-side panel for SMACH diagram editing. Shows:
 * - "Add State" button (always visible)
 * - "Add Transition" button (when node is selected)
 * - Property editor fields (when node is selected)
 * - "No state selected" message (when no node is selected)
 *
 * @example
 * ```tsx
 * <PropertiesPane
 *   selectedNodeId="state1"
 *   onAddState={() => console.log('add state')}
 *   onAddTransition={(id) => console.log('add transition', id)}
 *   onEditProperties={(id, props) => console.log('edit', id, props)}
 * />
 * ```
 */
export const PropertiesPane: React.FC<PropertiesPaneProps> = ({
  selectedNodeId,
  onAddState,
  onAddTransition,
  onEditProperties,
}) => {
  // Local state for property editing
  const [properties, setProperties] = useState<Record<string, string>>({
    name: '',
    description: '',
  });

  // Update properties when selectedNodeId changes (reset form on node selection change)
  React.useEffect(() => {
    if (selectedNodeId) {
      // In a real implementation, you would load the node's properties here
      // For now, we initialize with empty properties for the selected node
      setProperties({
        name: '',
        description: '',
      });
    }
  }, [selectedNodeId]);

  // Handle property field changes
  const handlePropertyChange = useCallback(
    (key: string, value: string) => {
      const updatedProps = { ...properties, [key]: value };
      setProperties(updatedProps);

      // Call the edit properties callback
      if (selectedNodeId) {
        onEditProperties(selectedNodeId, updatedProps);
      }
    },
    [properties, selectedNodeId, onEditProperties]
  );

  return (
    <div
      className="w-80 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 flex flex-col gap-4 shadow-sm"
      data-testid="properties-pane"
    >
      {/* Header */}
      <div className="border-b border-gray-200 dark:border-gray-700 pb-3">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {selectedNodeId ? 'State Properties' : 'Diagram Properties'}
        </h2>
      </div>

      {/* Add State Button - Always visible */}
      <button
        onClick={onAddState}
        className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-md transition-colors duration-150 active:bg-blue-800"
        data-testid="add-state-button"
      >
        + Add State
      </button>

      {/* Node Information Section */}
      {selectedNodeId ? (
        <>
          {/* Selected Node ID Display */}
          <div className="bg-gray-50 dark:bg-gray-700 rounded-md p-3">
            <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
              Selected State
            </p>
            <p className="text-sm font-mono text-gray-900 dark:text-gray-100">
              {selectedNodeId}
            </p>
          </div>

          {/* Add Transition Button - Only when node selected */}
          <button
            onClick={() => onAddTransition(selectedNodeId)}
            className="w-full px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-medium rounded-md transition-colors duration-150 active:bg-green-800"
            data-testid="add-transition-button"
          >
            → Add Transition
          </button>

          {/* Property Editor Fields */}
          <div className="space-y-3 border-t border-gray-200 dark:border-gray-700 pt-3">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              Properties
            </h3>

            {/* Name Property */}
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                Name
              </label>
              <input
                type="text"
                value={properties.name || ''}
                onChange={(e) => handlePropertyChange('name', e.target.value)}
                placeholder="Enter state name"
                className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Description Property */}
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                Description
              </label>
              <textarea
                value={properties.description || ''}
                onChange={(e) =>
                  handlePropertyChange('description', e.target.value)
                }
                placeholder="Enter state description"
                rows={3}
                className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
            </div>
          </div>
        </>
      ) : (
        /* No Selection State */
        <div className="flex items-center justify-center py-8">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            No state selected
          </p>
        </div>
      )}
    </div>
  );
};

export default PropertiesPane;
