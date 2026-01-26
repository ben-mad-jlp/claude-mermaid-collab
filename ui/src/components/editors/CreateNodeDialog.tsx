/**
 * CreateNodeDialog Component
 *
 * A modal dialog for creating new nodes in flowchart diagrams.
 * Features:
 * - Text input for node label
 * - Radio button selection for node type (terminal, state, decision, action)
 * - Live preview of node shape with type-specific colors
 * - Form validation (requires non-empty label)
 * - Escape key to close, form submission to create
 */

import React, { useState, useEffect, useId, useRef, useCallback } from 'react';
import { NodeType, NODE_TYPES } from '@/lib/diagramUtils';

export interface CreateNodeDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (label: string, type: NodeType['name']) => void;
}

/**
 * NodePreview Component
 *
 * Displays a visual preview of the node with type-specific styling.
 */
interface NodePreviewProps {
  type: NodeType['name'];
  label: string;
}

const NodePreview: React.FC<NodePreviewProps> = ({ type, label }) => {
  const nodeType = NODE_TYPES[type];

  // Parse style string to extract fill and stroke colors
  const styleMatch = nodeType.style.match(/fill:(#\w+),stroke:(#\w+)/);
  const fillColor = styleMatch ? styleMatch[1] : '#e0e0e0';
  const strokeColor = styleMatch ? styleMatch[2] : '#666666';

  // Determine shape styling based on type
  const getShapeClasses = (): string => {
    switch (type) {
      case 'terminal':
        // Stadium/pill shape
        return 'rounded-full';
      case 'state':
        // Circle-like (more rounded)
        return 'rounded-3xl';
      case 'decision':
        // Diamond - we'll use a rotated square approach
        return 'rotate-0'; // We'll handle diamond differently
      case 'action':
        // Rectangle
        return 'rounded-md';
      default:
        return 'rounded-md';
    }
  };

  if (type === 'decision') {
    // Diamond shape using CSS transform
    return (
      <div className="flex items-center justify-center p-4">
        <div className="relative w-24 h-24 flex items-center justify-center">
          <div
            className="absolute inset-0 transform rotate-45 border-2"
            style={{
              backgroundColor: fillColor,
              borderColor: strokeColor,
            }}
          />
          <span
            className="relative z-10 text-xs font-medium text-center px-1 truncate max-w-[80px]"
            style={{ color: strokeColor }}
          >
            {label}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center p-4">
      <div
        className={`px-4 py-3 border-2 min-w-[100px] max-w-[200px] text-center ${getShapeClasses()}`}
        style={{
          backgroundColor: fillColor,
          borderColor: strokeColor,
        }}
      >
        <span
          className="text-sm font-medium truncate block"
          style={{ color: strokeColor }}
        >
          {label}
        </span>
      </div>
    </div>
  );
};

export const CreateNodeDialog: React.FC<CreateNodeDialogProps> = ({
  isOpen,
  onClose,
  onCreate,
}) => {
  const [label, setLabel] = useState('');
  const [type, setType] = useState<NodeType['name']>('action');

  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();

  // Reset form when dialog opens
  useEffect(() => {
    if (isOpen) {
      setLabel('');
      setType('action');
      // Focus input after a small delay to ensure dialog is rendered
      setTimeout(() => {
        inputRef.current?.focus();
      }, 10);
    }
  }, [isOpen]);

  // Handle keyboard events (Escape to close)
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (label.trim()) {
        onCreate(label.trim(), type);
        onClose();
      }
    },
    [label, type, onCreate, onClose]
  );

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose]
  );

  if (!isOpen) return null;

  const nodeTypeOptions: { value: NodeType['name']; label: string }[] = [
    { value: 'terminal', label: 'Terminal (start/end)' },
    { value: 'state', label: 'State (process)' },
    { value: 'decision', label: 'Decision (branch)' },
    { value: 'action', label: 'Action (step)' },
  ];

  return (
    <>
      {/* Overlay backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-40 transition-opacity"
        onClick={handleBackdropClick}
        role="presentation"
        aria-hidden="true"
      />

      {/* Dialog */}
      <div
        ref={dialogRef}
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        role="dialog"
        aria-labelledby={`${id}-title`}
        aria-modal="true"
        onClick={handleBackdropClick}
      >
        <div
          className="bg-white dark:bg-gray-900 rounded-lg shadow-2xl w-full max-w-md"
          onClick={(e) => e.stopPropagation()}
        >
          <form onSubmit={handleSubmit}>
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
              <h2
                id={`${id}-title`}
                className="text-lg font-semibold text-gray-900 dark:text-white"
              >
                Create New Node
              </h2>
              <button
                type="button"
                onClick={onClose}
                className="inline-flex items-center justify-center w-8 h-8 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                aria-label="Close dialog"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            {/* Content */}
            <div className="p-6 space-y-6">
              {/* Label input */}
              <div className="space-y-2">
                <label
                  htmlFor={`${id}-label`}
                  className="block text-sm font-medium text-gray-900 dark:text-white"
                >
                  Label
                </label>
                <input
                  ref={inputRef}
                  id={`${id}-label`}
                  type="text"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="Enter node label"
                  autoFocus
                  className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
                />
              </div>

              {/* Type selector (radio buttons) */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-900 dark:text-white">
                  Type
                </label>
                <div
                  role="radiogroup"
                  aria-label="Node type"
                  className="space-y-2"
                >
                  {nodeTypeOptions.map((option) => (
                    <label
                      key={option.value}
                      className="flex items-center gap-3 cursor-pointer"
                    >
                      <input
                        type="radio"
                        name={`${id}-type`}
                        value={option.value}
                        checked={type === option.value}
                        onChange={() => setType(option.value)}
                        className="w-4 h-4 text-blue-600 dark:text-blue-500 border-gray-300 dark:border-gray-600 focus:ring-2 focus:ring-blue-500"
                      />
                      <span className="text-sm text-gray-900 dark:text-white">
                        {option.label}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Preview of node shape */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-900 dark:text-white">
                  Preview
                </label>
                <div className="border border-gray-200 dark:border-gray-700 rounded-md bg-gray-50 dark:bg-gray-800">
                  <NodePreview type={type} label={label || 'Example'} />
                </div>
              </div>
            </div>

            {/* Footer with buttons */}
            <div className="flex gap-2 p-6 pt-0 justify-end">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 dark:focus:ring-offset-gray-900 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!label.trim()}
                className="px-4 py-2 text-sm font-medium border border-transparent rounded-md bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 dark:focus:ring-offset-gray-900 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Create
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
};

CreateNodeDialog.displayName = 'CreateNodeDialog';

export default CreateNodeDialog;
