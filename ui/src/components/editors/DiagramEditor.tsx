/**
 * DiagramEditor Component
 *
 * A full-featured diagram editor with:
 * - Split pane layout (code editor on left, live preview on right)
 * - CodeMirror for syntax editing
 * - MermaidPreview for live diagram rendering
 * - Diagram validation and error handling
 * - Save/cancel functionality with keyboard shortcuts
 * - Auto-save debouncing
 * - Loading and error states
 * - Responsive design
 *
 * The component integrates with the session store to manage diagram state
 * and provides keyboard shortcuts (Ctrl+S / Cmd+S to save).
 */

import React, { useState, useCallback, useEffect } from 'react';
import CodeMirrorWrapper from './CodeMirrorWrapper';
import MermaidPreview from './MermaidPreview';
import { SplitPane } from '../layout/SplitPane';
import { useDiagram } from '@/hooks/useDiagram';
import { useSession } from '@/hooks/useSession';
import { DiagramValidation } from '@/types';
import mermaid from 'mermaid';
import { NodeContextMenu } from './NodeContextMenu';
import { EdgeContextMenu } from './EdgeContextMenu';
import { CreateNodeDialog } from './CreateNodeDialog';
import { SmachPropertiesPane, isSmachContent, parseSmachState, SmachState } from './SmachPropertiesPane';
import * as diagramUtils from '@/lib/diagramUtils';

export interface DiagramEditorProps {
  /** ID of the diagram to edit */
  diagramId: string;
  /** Callback when editor exits (optional) */
  onExit?: () => void;
}

interface EditorState {
  isLoading: boolean;
  error: string | null;
  isValidating: boolean;
  validation: DiagramValidation | null;
  isSaving: boolean;
  hasChanges: boolean;
  lastSavedAt: number | null;
}

/**
 * DiagramEditor Component
 *
 * Full-featured diagram editor with split pane layout,
 * live preview, validation, and keyboard shortcuts.
 *
 * @example
 * ```tsx
 * function MyApp() {
 *   return (
 *     <DiagramEditor
 *       diagramId="diagram-123"
 *       onExit={() => navigate('/')}
 *     />
 *   );
 * }
 * ```
 */
export const DiagramEditor: React.FC<DiagramEditorProps> = ({
  diagramId,
  onExit,
}) => {
  // Get diagram from store
  const { getDiagramById, updateDiagram } = useDiagram();
  useSession(); // Used for session context

  // Local state
  const diagram = getDiagramById(diagramId);
  const [editorContent, setEditorContent] = useState<string>(diagram?.content ?? '');
  const [editorState, setEditorState] = useState<EditorState>({
    isLoading: !diagram,
    error: null,
    isValidating: false,
    validation: null,
    isSaving: false,
    hasChanges: false,
    lastSavedAt: null,
  });

  // New state for context menus, create dialog, and SMACH mode
  const [nodeMenu, setNodeMenu] = useState<{
    nodeId: string;
    label: string;
    type?: diagramUtils.NodeType['name'];
    position: { x: number; y: number };
  } | null>(null);
  const [edgeMenu, setEdgeMenu] = useState<{
    source: string;
    target: string;
    label?: string;
    position: { x: number; y: number };
  } | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [selectionMode, setSelectionMode] = useState<'add-transition' | 'change-origin' | 'change-destination' | null>(null);
  const [pendingTransitionSource, setPendingTransitionSource] = useState<string | null>(null);
  const [pendingEdgeInfo, setPendingEdgeInfo] = useState<{ source: string; target: string } | null>(null);
  const [selectedSmachState, setSelectedSmachState] = useState<SmachState | null>(null);
  const [isSmach, setIsSmach] = useState(false);

  // Auto-load diagram if not already loaded
  useEffect(() => {
    if (diagram) {
      setEditorContent(diagram.content);
      setEditorState((prev) => ({ ...prev, isLoading: false }));
    }
  }, [diagram]);

  // Validate diagram using Mermaid
  const validateContent = useCallback(
    async (content: string) => {
      setEditorState((prev) => ({ ...prev, isValidating: true }));
      try {
        // Trim content
        const trimmedContent = content.trim();

        // Empty content is valid (user just hasn't written anything yet)
        if (!trimmedContent) {
          setEditorState((prev) => ({
            ...prev,
            isValidating: false,
            validation: { valid: true },
          }));
          return;
        }

        // Try to parse the diagram with mermaid
        await mermaid.parse(trimmedContent);

        setEditorState((prev) => ({
          ...prev,
          isValidating: false,
          validation: { valid: true },
        }));
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Invalid diagram syntax';
        setEditorState((prev) => ({
          ...prev,
          isValidating: false,
          validation: {
            valid: false,
            error: errorMessage,
          },
        }));
      }
    },
    []
  );

  // Debounce validation with useEffect
  useEffect(() => {
    const timer = setTimeout(() => {
      if (editorContent !== diagram?.content) {
        validateContent(editorContent);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [editorContent, diagram?.content, validateContent]);

  // Handle editor changes
  const handleEditorChange = useCallback((newContent: string) => {
    setEditorContent(newContent);
    setEditorState((prev) => ({
      ...prev,
      hasChanges: newContent !== diagram?.content,
    }));
  }, [diagram?.content]);

  // Save diagram
  const handleSave = useCallback(async () => {
    if (!diagram || !editorState.validation?.valid) {
      setEditorState((prev) => ({
        ...prev,
        error: 'Cannot save invalid diagram',
      }));
      return;
    }

    setEditorState((prev) => ({ ...prev, isSaving: true, error: null }));
    try {
      // Update in store
      updateDiagram(diagram.id, {
        content: editorContent,
        lastModified: Date.now(),
      });

      setEditorState((prev) => ({
        ...prev,
        isSaving: false,
        hasChanges: false,
        lastSavedAt: Date.now(),
      }));

      // Show success message
      setTimeout(() => {
        setEditorState((prev) => ({ ...prev, lastSavedAt: null }));
      }, 2000);
    } catch (error) {
      setEditorState((prev) => ({
        ...prev,
        isSaving: false,
        error: error instanceof Error ? error.message : 'Failed to save diagram',
      }));
    }
  }, [diagram, editorContent, editorState.validation?.valid, updateDiagram]);

  // Handle discard changes
  const handleDiscard = useCallback(() => {
    if (diagram) {
      setEditorContent(diagram.content);
      setEditorState((prev) => ({
        ...prev,
        hasChanges: false,
        error: null,
      }));
    }
  }, [diagram]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Cmd+S or Ctrl+S to save
      if ((event.ctrlKey || event.metaKey) && event.key === 's') {
        event.preventDefault();
        if (editorState.hasChanges && editorState.validation?.valid) {
          handleSave();
        }
      }
      // Escape to exit selection mode or close menus, then exit editor
      if (event.key === 'Escape') {
        if (selectionMode) {
          setSelectionMode(null);
          setPendingTransitionSource(null);
          setPendingEdgeInfo(null);
        } else if (nodeMenu) {
          setNodeMenu(null);
        } else if (edgeMenu) {
          setEdgeMenu(null);
        } else if (selectedSmachState) {
          setSelectedSmachState(null);
        } else if (!editorState.hasChanges) {
          onExit?.();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [editorState.hasChanges, editorState.validation?.valid, handleSave, onExit, selectionMode, nodeMenu, edgeMenu, selectedSmachState]);

  // Detect SMACH content on editor content change
  useEffect(() => {
    setIsSmach(isSmachContent(editorContent));
  }, [editorContent]);

  // Helper function to extract label from node line
  const extractLabelFromContent = useCallback((content: string, nodeId: string): string => {
    const lines = content.split('\n');
    const pattern = new RegExp(`^\\s*${nodeId}\\s*[\\[\\(\\{]+"?([^"\\]\\)\\}]+)"?[\\]\\)\\}]`);
    for (const line of lines) {
      const match = line.match(pattern);
      if (match) {
        return match[1];
      }
    }
    return nodeId;
  }, []);

  // Helper function to find node insertion point
  const findNodeInsertionPoint = useCallback((content: string): number => {
    const lines = content.split('\n');
    let lastNodeLine = 0;
    const nodePattern = /^\s*\w+\s*[[({}]/;
    const edgePattern = /^\s*\w+\s*[-=]+[>|]/;

    for (let i = 0; i < lines.length; i++) {
      if (nodePattern.test(lines[i]) && !edgePattern.test(lines[i])) {
        lastNodeLine = i;
      }
    }
    return lastNodeLine;
  }, []);

  // Helper function to find all edges connected to a node
  const findAllEdgesForNode = useCallback((nodeId: string, content: string): number[] => {
    const lines = content.split('\n');
    const edgeLines: number[] = [];
    const pattern = new RegExp(`(^|\\s)${nodeId}(\\s*[-=]+|[-=]+[>|].*${nodeId})`);

    for (let i = 0; i < lines.length; i++) {
      if (pattern.test(lines[i])) {
        edgeLines.push(i + 1); // 1-indexed
      }
    }
    return edgeLines;
  }, []);

  // Helper function to find style line for a node
  const findStyleLine = useCallback((nodeId: string, content: string): number | null => {
    const lines = content.split('\n');
    const pattern = new RegExp(`^\\s*style\\s+${nodeId}\\s`);

    for (let i = 0; i < lines.length; i++) {
      if (pattern.test(lines[i])) {
        return i + 1; // 1-indexed
      }
    }
    return null;
  }, []);

  // Helper function to remove multiple lines from content
  const removeLines = useCallback((content: string, lineNumbers: number[]): string => {
    const lines = content.split('\n');
    const linesToRemove = new Set(lineNumbers.map(n => n - 1)); // Convert to 0-indexed
    return lines.filter((_, index) => !linesToRemove.has(index)).join('\n');
  }, []);

  // Helper function to insert lines after a specific line
  const insertLines = useCallback((content: string, afterLine: number, newLines: string[]): string => {
    const lines = content.split('\n');
    lines.splice(afterLine + 1, 0, ...newLines);
    return lines.join('\n');
  }, []);

  // Handle adding a transition between nodes (defined before handleNodeClick since it's used there)
  const handleAddTransition = useCallback((fromNode: string, toNode: string) => {
    const lines = editorContent.split('\n');
    const edgeLine = `${fromNode} --> ${toNode}`;

    // Find a good place to insert (after last edge or after nodes)
    let insertIndex = lines.length - 1;
    const edgePattern = /^\s*\w+\s*[-=]+[>|]/;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (edgePattern.test(lines[i])) {
        insertIndex = i + 1;
        break;
      }
    }

    lines.splice(insertIndex, 0, edgeLine);
    const newContent = lines.join('\n');
    setEditorContent(newContent);
    setEditorState((prev) => ({
      ...prev,
      hasChanges: newContent !== diagram?.content,
    }));
  }, [editorContent, diagram?.content]);

  // Handle changing edge endpoint (origin or destination) - defined before handleNodeClick
  const handleChangeEdgeEndpoint = useCallback((oldSource: string, oldTarget: string, newSource: string, newTarget: string) => {
    const lines = editorContent.split('\n');
    const edgePattern = new RegExp(`(^\\s*)${oldSource}(\\s*[-=]+(?:\\|[^|]*\\|)?[>|].*)${oldTarget}(\\s*$)`);

    const newLines = lines.map(line => {
      return line.replace(edgePattern, `$1${newSource}$2${newTarget}$3`);
    });

    const newContent = newLines.join('\n');
    setEditorContent(newContent);
    setEditorState((prev) => ({
      ...prev,
      hasChanges: newContent !== diagram?.content,
    }));
  }, [editorContent, diagram?.content]);

  // Handle node click - show context menu or handle selection mode
  const handleNodeClick = useCallback((nodeId: string, event: MouseEvent) => {
    if (selectionMode === 'add-transition' && pendingTransitionSource) {
      // Complete the transition
      handleAddTransition(pendingTransitionSource, nodeId);
      setSelectionMode(null);
      setPendingTransitionSource(null);
    } else if (selectionMode === 'change-origin' && pendingEdgeInfo) {
      // Update edge origin
      const { source: oldSource, target } = pendingEdgeInfo;
      handleChangeEdgeEndpoint(oldSource, target, nodeId, target);
      setSelectionMode(null);
      setPendingEdgeInfo(null);
    } else if (selectionMode === 'change-destination' && pendingEdgeInfo) {
      // Update edge destination
      const { source, target: oldTarget } = pendingEdgeInfo;
      handleChangeEdgeEndpoint(source, oldTarget, source, nodeId);
      setSelectionMode(null);
      setPendingEdgeInfo(null);
    } else {
      // Show context menu
      if (isSmach) {
        const state = parseSmachState(editorContent, nodeId);
        setSelectedSmachState(state);
      } else {
        const label = extractLabelFromContent(editorContent, nodeId);
        setNodeMenu({
          nodeId,
          label,
          position: { x: event.clientX, y: event.clientY },
        });
      }
    }
  }, [selectionMode, pendingTransitionSource, pendingEdgeInfo, isSmach, editorContent, extractLabelFromContent, handleAddTransition, handleChangeEdgeEndpoint]);

  // Handle edge click - show context menu
  const handleEdgeClick = useCallback((source: string, target: string, event: MouseEvent) => {
    // Extract edge label if present
    const lines = editorContent.split('\n');
    let label: string | undefined;
    const pattern = new RegExp(`${source}\\s*[-=]+\\|([^|]+)\\|`);
    for (const line of lines) {
      const match = line.match(pattern);
      if (match) {
        label = match[1];
        break;
      }
    }

    setEdgeMenu({
      source,
      target,
      label,
      position: { x: event.clientX, y: event.clientY },
    });
  }, [editorContent]);

  // Handle creating a new node
  const handleCreateNode = useCallback((label: string, type: diagramUtils.NodeType['name']) => {
    const id = diagramUtils.generateNodeId(editorContent);
    const definition = diagramUtils.buildNodeDefinition(id, label, type);
    const styleLine = diagramUtils.buildNodeStyle(id, type);

    const insertionPoint = findNodeInsertionPoint(editorContent);
    const newContent = insertLines(editorContent, insertionPoint, [definition, styleLine]);

    setEditorContent(newContent);
    setEditorState((prev) => ({
      ...prev,
      hasChanges: newContent !== diagram?.content,
    }));
  }, [editorContent, diagram?.content, findNodeInsertionPoint, insertLines]);

  // Handle editing node label
  const handleEditNodeLabel = useCallback((nodeId: string, newLabel: string) => {
    const lines = editorContent.split('\n');
    const pattern = new RegExp(`(^\\s*${nodeId}\\s*[\\[\\(\\{]+"?)([^"\\]\\)\\}]+)("?[\\]\\)\\}])`);

    const newLines = lines.map(line => {
      return line.replace(pattern, `$1${newLabel}$3`);
    });

    const newContent = newLines.join('\n');
    setEditorContent(newContent);
    setEditorState((prev) => ({
      ...prev,
      hasChanges: newContent !== diagram?.content,
    }));
  }, [editorContent, diagram?.content]);

  // Handle changing node type
  const handleChangeNodeType = useCallback((nodeId: string, newType: diagramUtils.NodeType['name']) => {
    const nodeType = diagramUtils.NODE_TYPES[newType];
    const lines = editorContent.split('\n');

    // Update node definition shape
    const nodePattern = new RegExp(`(^\\s*${nodeId}\\s*)[\\[\\(\\{]+("?[^"\\]\\)\\}]+"?)[\\]\\)\\}]+`);

    let newLines = lines.map(line => {
      const match = line.match(nodePattern);
      if (match) {
        return match[1] + nodeType.shape.open + match[2] + nodeType.shape.close;
      }
      return line;
    });

    // Update or add style line
    const stylePattern = new RegExp(`^\\s*style\\s+${nodeId}\\s+.+$`);
    let foundStyle = false;
    newLines = newLines.map(line => {
      if (stylePattern.test(line)) {
        foundStyle = true;
        return `style ${nodeId} ${nodeType.style}`;
      }
      return line;
    });

    if (!foundStyle) {
      // Add style line after node definition
      const nodeLine = diagramUtils.findNodeLine(nodeId, editorContent);
      if (nodeLine) {
        newLines.splice(nodeLine, 0, `style ${nodeId} ${nodeType.style}`);
      }
    }

    const newContent = newLines.join('\n');
    setEditorContent(newContent);
    setEditorState((prev) => ({
      ...prev,
      hasChanges: newContent !== diagram?.content,
    }));
  }, [editorContent, diagram?.content]);

  // Handle deleting a node
  const handleDeleteNode = useCallback((nodeId: string) => {
    const nodeLine = diagramUtils.findNodeLine(nodeId, editorContent);
    const edgeLines = findAllEdgesForNode(nodeId, editorContent);
    const styleLine = findStyleLine(nodeId, editorContent);

    const linesToRemove = [nodeLine, ...edgeLines, styleLine].filter((line): line is number => line !== null);
    const newContent = removeLines(editorContent, linesToRemove);

    setEditorContent(newContent);
    setEditorState((prev) => ({
      ...prev,
      hasChanges: newContent !== diagram?.content,
    }));
    setNodeMenu(null);
  }, [editorContent, diagram?.content, findAllEdgesForNode, findStyleLine, removeLines]);

  // Handle editing edge label
  const handleEditEdgeLabel = useCallback((source: string, target: string, newLabel: string) => {
    const lines = editorContent.split('\n');
    const edgePattern = new RegExp(`(${source}\\s*[-=]+)(\\|[^|]*\\|)?([>|].*)${target}`);

    const newLines = lines.map(line => {
      if (edgePattern.test(line)) {
        if (newLabel) {
          return line.replace(edgePattern, `$1|${newLabel}|$3${target}`);
        } else {
          // Remove label
          return line.replace(edgePattern, `$1$3${target}`);
        }
      }
      return line;
    });

    const newContent = newLines.join('\n');
    setEditorContent(newContent);
    setEditorState((prev) => ({
      ...prev,
      hasChanges: newContent !== diagram?.content,
    }));
    setEdgeMenu(null);
  }, [editorContent, diagram?.content]);

  // Handle deleting an edge
  const handleDeleteEdge = useCallback((source: string, target: string) => {
    const edgeLine = diagramUtils.findEdgeLine(source, target, editorContent);
    if (edgeLine) {
      const newContent = removeLines(editorContent, [edgeLine]);
      setEditorContent(newContent);
      setEditorState((prev) => ({
        ...prev,
        hasChanges: newContent !== diagram?.content,
      }));
    }
    setEdgeMenu(null);
  }, [editorContent, diagram?.content, removeLines]);

  // Handle starting add transition mode
  const handleStartAddTransition = useCallback((fromNode: string) => {
    setPendingTransitionSource(fromNode);
    setSelectionMode('add-transition');
  }, []);

  // Handle starting change origin mode
  const handleStartChangeOrigin = useCallback((source: string, target: string) => {
    setPendingEdgeInfo({ source, target });
    setSelectionMode('change-origin');
  }, []);

  // Handle starting change destination mode
  const handleStartChangeDestination = useCallback((source: string, target: string) => {
    setPendingEdgeInfo({ source, target });
    setSelectionMode('change-destination');
  }, []);

  // SMACH handlers
  const handleSmachEditDescription = useCallback((description: string) => {
    if (!selectedSmachState) return;

    // Update YAML content - this is a simplified approach
    // In production, you'd want to properly parse and update the YAML
    const lines = editorContent.split('\n');
    const statePattern = new RegExp(`^(\\s*)${selectedSmachState.name}:`);
    let inState = false;
    let stateIndent = 0;

    const newLines = lines.map((line) => {
      if (statePattern.test(line)) {
        inState = true;
        const match = line.match(statePattern);
        stateIndent = match ? match[1].length : 0;
        return line;
      }

      if (inState) {
        const lineIndent = line.match(/^(\s*)/)?.[1].length || 0;
        if (lineIndent <= stateIndent && line.trim()) {
          inState = false;
          return line;
        }

        if (line.match(/^\s*description:/)) {
          return `${' '.repeat(stateIndent + 2)}description: "${description}"`;
        }
      }

      return line;
    });

    const newContent = newLines.join('\n');
    setEditorContent(newContent);
    setEditorState((prev) => ({
      ...prev,
      hasChanges: newContent !== diagram?.content,
    }));
  }, [editorContent, diagram?.content, selectedSmachState]);

  const handleSmachEditTransition = useCallback((index: number, outcome: string, target: string) => {
    // Simplified SMACH transition editing
    console.log('Edit transition', index, outcome, target);
  }, []);

  const handleSmachAddTransition = useCallback(() => {
    // Simplified SMACH transition adding
    console.log('Add transition');
  }, []);

  const handleSmachRemoveTransition = useCallback((index: number) => {
    // Simplified SMACH transition removal
    console.log('Remove transition', index);
  }, []);

  // Loading state
  if (editorState.isLoading || !diagram) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-accent-500" />
          <p className="mt-4 text-gray-600 dark:text-gray-400">Loading diagram...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col bg-white dark:bg-gray-900">
      {/* Header with title and controls */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold text-gray-900 dark:text-white">
            {diagram.name}
          </h1>
          {editorState.hasChanges && (
            <span className="inline-block w-2 h-2 rounded-full bg-orange-400" title="Unsaved changes" />
          )}
          {editorState.lastSavedAt && (
            <span className="text-xs text-green-600 dark:text-green-400">Saved</span>
          )}
        </div>

        <div className="flex items-center gap-3">
          {selectionMode && (
            <div className="text-xs text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900 px-2 py-1 rounded">
              {selectionMode === 'add-transition' && 'Click a node to add transition'}
              {selectionMode === 'change-origin' && 'Click a node to set as new origin'}
              {selectionMode === 'change-destination' && 'Click a node to set as new destination'}
            </div>
          )}
          {editorState.error && (
            <div className="text-xs text-red-600 dark:text-red-400">
              {editorState.error}
            </div>
          )}
          {!isSmach && (
            <button
              onClick={() => setShowCreateDialog(true)}
              className="px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors"
              title="Add new node"
            >
              + Add Node
            </button>
          )}
          <button
            onClick={handleDiscard}
            disabled={!editorState.hasChanges || editorState.isSaving}
            className="px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
            title="Discard changes (Esc)"
          >
            Discard
          </button>
          <button
            onClick={handleSave}
            disabled={!editorState.hasChanges || !editorState.validation?.valid || editorState.isSaving}
            className="px-3 py-2 text-sm font-medium text-white bg-accent-500 hover:bg-accent-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
            title="Save diagram (Cmd+S / Ctrl+S)"
          >
            {editorState.isSaving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      {/* Split pane with editor and preview */}
      <div className="flex-1 overflow-hidden">
        <SplitPane
          direction="horizontal"
          defaultPrimarySize={50}
          minPrimarySize={20}
          minSecondarySize={20}
          storageId="diagram-editor-split"
          primaryContent={
            <div className="flex flex-col h-full">
              <div className="flex-1 overflow-hidden">
                <CodeMirrorWrapper
                  value={editorContent}
                  onChange={handleEditorChange}
                  language="yaml"
                  height="100%"
                  placeholder="Enter Mermaid diagram syntax..."
                  showLineNumbers={true}
                  wordWrap={true}
                />
              </div>

              {/* Validation status bar */}
              {editorState.isValidating && (
                <div className="px-4 py-2 bg-blue-50 dark:bg-blue-900 border-t border-blue-200 dark:border-blue-700 text-xs text-blue-700 dark:text-blue-200">
                  Validating...
                </div>
              )}

              {editorState.validation && !editorState.validation.valid && (
                <div className="px-4 py-3 bg-red-50 dark:bg-red-900 border-t border-red-200 dark:border-red-700">
                  <p className="text-xs font-medium text-red-700 dark:text-red-200">
                    Validation Error
                    {editorState.validation.line && ` (Line ${editorState.validation.line})`}
                  </p>
                  <p className="text-xs text-red-600 dark:text-red-300 mt-1 font-mono">
                    {editorState.validation.error}
                  </p>
                </div>
              )}

              {editorState.validation?.valid && editorContent?.trim() && (
                <div className="px-4 py-2 bg-green-50 dark:bg-green-900 border-t border-green-200 dark:border-green-700 text-xs text-green-700 dark:text-green-200">
                  Valid diagram syntax
                </div>
              )}
            </div>
          }
          secondaryContent={
            <div className="flex h-full">
              <div className="flex flex-col flex-1 p-4 bg-gray-50 dark:bg-gray-800 overflow-auto">
                <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">
                  Preview
                </h2>
                <div className="flex-1">
                  <MermaidPreview
                    content={editorContent}
                    onError={(error) => {
                      setEditorState((prev) => ({
                        ...prev,
                        error: `Preview error: ${error.message}`,
                      }));
                    }}
                    onNodeClickWithPosition={handleNodeClick}
                    onEdgeClickWithPosition={handleEdgeClick}
                  />
                </div>
              </div>
              {isSmach && selectedSmachState && (
                <SmachPropertiesPane
                  state={selectedSmachState}
                  onEditDescription={handleSmachEditDescription}
                  onEditTransition={handleSmachEditTransition}
                  onAddTransition={handleSmachAddTransition}
                  onRemoveTransition={handleSmachRemoveTransition}
                  onClose={() => setSelectedSmachState(null)}
                  className="border-l border-gray-200 dark:border-gray-700"
                />
              )}
            </div>
          }
        />
      </div>

      {/* Keyboard hints footer */}
      <div className="px-6 py-2 bg-gray-100 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400">
        <span className="font-mono">Cmd+S</span>
        {' '}or{' '}
        <span className="font-mono">Ctrl+S</span>
        {' '}to save •{' '}
        <span className="font-mono">Esc</span>
        {' '}to exit
      </div>

      {/* Node Context Menu */}
      {nodeMenu && (
        <NodeContextMenu
          nodeId={nodeMenu.nodeId}
          nodeLabel={nodeMenu.label}
          nodeType={nodeMenu.type}
          position={nodeMenu.position}
          onClose={() => setNodeMenu(null)}
          onEditLabel={(newLabel) => {
            handleEditNodeLabel(nodeMenu.nodeId, newLabel);
            setNodeMenu(null);
          }}
          onChangeType={(newType) => {
            handleChangeNodeType(nodeMenu.nodeId, newType);
            setNodeMenu(null);
          }}
          onAddTransition={() => {
            handleStartAddTransition(nodeMenu.nodeId);
            setNodeMenu(null);
          }}
          onDelete={() => {
            handleDeleteNode(nodeMenu.nodeId);
          }}
        />
      )}

      {/* Edge Context Menu */}
      {edgeMenu && (
        <EdgeContextMenu
          sourceId={edgeMenu.source}
          targetId={edgeMenu.target}
          edgeLabel={edgeMenu.label}
          position={edgeMenu.position}
          onClose={() => setEdgeMenu(null)}
          onEditLabel={(newLabel) => {
            handleEditEdgeLabel(edgeMenu.source, edgeMenu.target, newLabel);
          }}
          onChangeOrigin={() => {
            handleStartChangeOrigin(edgeMenu.source, edgeMenu.target);
            setEdgeMenu(null);
          }}
          onChangeDestination={() => {
            handleStartChangeDestination(edgeMenu.source, edgeMenu.target);
            setEdgeMenu(null);
          }}
          onDelete={() => {
            handleDeleteEdge(edgeMenu.source, edgeMenu.target);
          }}
        />
      )}

      {/* Create Node Dialog */}
      <CreateNodeDialog
        isOpen={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
        onCreate={handleCreateNode}
      />
    </div>
  );
};

export default DiagramEditor;
