import React, { useCallback, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useSessionStore } from '@/stores/sessionStore';
import { useDataLoader } from '@/hooks/useDataLoader';
import { ItemCard } from '@/components/layout/ItemCard';
import { Item } from '@/types';
import { api } from '@/lib/api';
import { downloadArtifact } from '@/lib/downloadArtifact';
import { emailArtifact } from '@/lib/emailArtifact';
import { importArtifact, detectType } from '@/lib/importArtifact';
import { AddTodoDialog } from '@/components/dialogs';
import { SubscriptionsPanel } from '@/components/layout/SubscriptionsPanel';
import { FileBrowserDialog } from '@/components/dialogs/FileBrowserDialog';
import { useGlobalSearch } from '@/stores/globalSearch';

export interface SidebarProps {
  className?: string;
}

export const Sidebar: React.FC<SidebarProps> = ({
  className = '',
}) => {
  const {
    diagrams,
    documents,
    designs,
    spreadsheets,
    snippets,
    selectedDiagramId,
    selectedDocumentId,
    selectedDesignId,
    selectedSpreadsheetId,
    selectedSnippetId,
    taskGraphSelected,
    currentSession,
    collabState,
    selectTaskGraph,
    removeDiagram,
    removeDocument,
    removeDesign,
    removeSpreadsheet,
    removeSnippet,
    selectSnippet,
    todosSelected,
    todosProject,
    todos,
    selectedTodoId,
    selectTodo,
    removeTodo: storeRemoveTodo,
    setTodos,
    addTodo: storeAddTodo,
    updateDiagram,
    updateDocument,
    updateSpreadsheet,
    updateSnippet,
    updateDesign,
    embeds,
    selectedEmbedId,
    selectEmbed,
    removeEmbed,
  } = useSessionStore(
    useShallow((state) => ({
      diagrams: state.diagrams,
      documents: state.documents,
      designs: state.designs,
      spreadsheets: state.spreadsheets,
      snippets: state.snippets,
      selectedDiagramId: state.selectedDiagramId,
      selectedDocumentId: state.selectedDocumentId,
      selectedDesignId: state.selectedDesignId,
      selectedSpreadsheetId: state.selectedSpreadsheetId,
      selectedSnippetId: state.selectedSnippetId,
      taskGraphSelected: state.taskGraphSelected,
      currentSession: state.currentSession,
      collabState: state.collabState,
      selectTaskGraph: state.selectTaskGraph,
      removeDiagram: state.removeDiagram,
      removeDocument: state.removeDocument,
      removeDesign: state.removeDesign,
      removeSpreadsheet: state.removeSpreadsheet,
      removeSnippet: state.removeSnippet,
      selectSnippet: state.selectSnippet,
      todosSelected: state.todosSelected,
      todosProject: state.todosProject,
      todos: state.todos,
      selectedTodoId: state.selectedTodoId,
      selectTodo: state.selectTodo,
      removeTodo: state.removeTodo,
      setTodos: state.setTodos,
      addTodo: state.addTodo,
      updateDiagram: state.updateDiagram,
      updateDocument: state.updateDocument,
      updateSpreadsheet: state.updateSpreadsheet,
      updateSnippet: state.updateSnippet,
      updateDesign: state.updateDesign,
      embeds: state.embeds,
      selectedEmbedId: state.selectedEmbedId,
      selectEmbed: state.selectEmbed,
      removeEmbed: state.removeEmbed,
    }))
  );

  const { selectDiagramWithContent, selectDocumentWithContent, selectDesignWithContent, selectSpreadsheetWithContent } = useDataLoader();

  const [searchQuery, setSearchQuery] = useState('');
  const [showAddTodoDialog, setShowAddTodoDialog] = useState(false);
  const [isTodoDropdownOpen, setIsTodoDropdownOpen] = useState(false);
  const [showDeprecated, setShowDeprecated] = useState(false);
  const [blueprintCollapsed, setBlueprintCollapsed] = useState(false);
  const [tasksCollapsed, setTasksCollapsed] = useState(false);
  const [embedsCollapsed, setEmbedsCollapsed] = useState(false);
  const [codeFilesCollapsed, setCodeFilesCollapsed] = useState(false);
  const [fileBrowserOpen, setFileBrowserOpen] = useState(false);

  const handleDeleteEmbed = useCallback(
    async (embedId: string, embedName: string) => {
      if (!currentSession) return;
      if (!window.confirm(`Delete embed "${embedName}"?`)) return;
      try {
        const response = await fetch(
          `/api/embed/${encodeURIComponent(embedId)}?project=${encodeURIComponent(currentSession.project)}&session=${encodeURIComponent(currentSession.name)}`,
          { method: 'DELETE' },
        );
        if (!response.ok) throw new Error('Failed to delete embed');
        removeEmbed(embedId);
      } catch (error) {
        console.error('Failed to delete embed:', error);
      }
    },
    [currentSession, removeEmbed],
  );

  const handleDeleteItem = useCallback(
    async (item: Item) => {
      if (!currentSession) return;

      const typeLabel = item.type === 'diagram' ? 'diagram' : item.type === 'design' ? 'design' : item.type === 'spreadsheet' ? 'spreadsheet' : item.type === 'snippet' ? 'snippet' : 'document';
      if (!window.confirm(`Delete ${typeLabel} "${item.name}"?`)) {
        return;
      }

      try {
        if (item.type === 'diagram') {
          await api.deleteDiagram(currentSession.project, currentSession.name, item.id);
          removeDiagram(item.id);
        } else if (item.type === 'document') {
          await api.deleteDocument(currentSession.project, currentSession.name, item.id);
          removeDocument(item.id);
        } else if (item.type === 'design') {
          await api.deleteDesign(currentSession.project, currentSession.name, item.id);
          removeDesign(item.id);
        } else if (item.type === 'spreadsheet') {
          await api.deleteSpreadsheet(currentSession.project, currentSession.name, item.id);
          removeSpreadsheet(item.id);
        } else if (item.type === 'snippet') {
          await api.deleteSnippet(currentSession.project, currentSession.name, item.id);
          removeSnippet(item.id);
        }
      } catch (error) {
        console.error('Failed to delete item:', error);
      }
    },
    [currentSession, removeDiagram, removeDocument, removeDesign, removeSpreadsheet, removeSnippet]
  );

  const handleDeprecateItem = useCallback(
    async (item: Item) => {
      if (!currentSession) return;
      const newDeprecated = !item.deprecated;
      try {
        await api.setDeprecated(currentSession.project, currentSession.name, item.id, newDeprecated);
        if (item.type === 'diagram') {
          updateDiagram(item.id, { deprecated: newDeprecated });
        } else if (item.type === 'document') {
          updateDocument(item.id, { deprecated: newDeprecated });
          // If deprecating a blueprint, also clear the associated task graph
          if (newDeprecated && (item as any).blueprint) {
            try {
              await api.clearTaskGraph(currentSession.project, currentSession.name);
            } catch (err) {
              console.error('Failed to clear task graph:', err);
            }
          }
        } else if (item.type === 'spreadsheet') {
          updateSpreadsheet(item.id, { deprecated: newDeprecated });
        } else if (item.type === 'snippet') {
          updateSnippet(item.id, { deprecated: newDeprecated });
        } else if (item.type === 'design') {
          updateDesign(item.id, { deprecated: newDeprecated });
        }
      } catch (error) {
        console.error('Failed to set deprecated:', error);
      }
    },
    [currentSession, updateDiagram, updateDocument, updateSpreadsheet, updateSnippet, updateDesign]
  );

  const handlePinItem = useCallback(
    async (item: Item) => {
      if (!currentSession) return;
      const newPinned = !item.pinned;
      try {
        await api.setPinned(currentSession.project, currentSession.name, item.id, newPinned);
        if (item.type === 'diagram') {
          updateDiagram(item.id, { pinned: newPinned });
        } else if (item.type === 'document') {
          updateDocument(item.id, { pinned: newPinned });
        } else if (item.type === 'spreadsheet') {
          updateSpreadsheet(item.id, { pinned: newPinned });
        } else if (item.type === 'snippet') {
          updateSnippet(item.id, { pinned: newPinned });
        } else if (item.type === 'design') {
          updateDesign(item.id, { pinned: newPinned });
        }
      } catch (error) {
        console.error('Failed to set pinned:', error);
      }
    },
    [currentSession, updateDiagram, updateDocument, updateSpreadsheet, updateSnippet, updateDesign]
  );

  const handleDownloadItem = useCallback(
    async (item: Item) => {
      if (!currentSession) return;
      await downloadArtifact(currentSession.project, currentSession.name, item);
    },
    [currentSession]
  );

  const handleEmailItem = useCallback(
    async (item: Item) => {
      if (!currentSession) return;
      await emailArtifact(currentSession.project, currentSession.name, item);
    },
    [currentSession]
  );

  const handleImport = useCallback(async () => {
    if (!currentSession) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.mmd,.md,.design.json,.spreadsheet.json,.csv,.ts,.tsx,.js,.jsx,.py,.json,.txt,.sql,.sh,.yaml,.yml,.toml,.xml,.html,.css,.scss';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      // Check if an artifact with this name already exists
      const { type, name } = detectType(file.name);
      const allItems = [...diagrams, ...documents, ...designs, ...spreadsheets, ...snippets];
      const existing = allItems.find((item) => item.name === name || item.id === name.replace(/[^a-zA-Z0-9-_]/g, '-'));
      if (existing && !window.confirm(`An artifact named "${name}" already exists. Overwrite it?`)) {
        return;
      }
      try {
        await importArtifact(currentSession.project, currentSession.name, file);
      } catch (err) {
        console.error('Import failed:', err);
      }
    };
    input.click();
  }, [currentSession, diagrams, documents, designs, spreadsheets, snippets]);

  const handleItemClick = useCallback(
    (item: Item) => {
      if (!currentSession) return;

      if (item.type === 'diagram') {
        selectDiagramWithContent(currentSession.project, currentSession.name, item.id);
      } else if (item.type === 'design') {
        selectDesignWithContent(currentSession.project, currentSession.name, item.id);
      } else if (item.type === 'spreadsheet') {
        selectSpreadsheetWithContent(currentSession.project, currentSession.name, item.id);
      } else if (item.type === 'snippet') {
        selectSnippet(item.id);
      } else {
        selectDocumentWithContent(currentSession.project, currentSession.name, item.id);
      }
    },
    [currentSession, selectDiagramWithContent, selectDocumentWithContent, selectDesignWithContent, selectSpreadsheetWithContent, selectSnippet]
  );

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSearchQuery(e.target.value);
    },
    []
  );

  // Todo-specific handlers
  const handleAddTodoConfirm = useCallback(async (title: string, description: string) => {
    if (!todosProject) return;
    try {
      const todo = await api.addTodo(todosProject, title, description);
      storeAddTodo(todo);
      selectTodo(todo.id);
    } catch (error) {
      console.error('Failed to add todo:', error);
    } finally {
      setShowAddTodoDialog(false);
    }
  }, [todosProject, storeAddTodo, selectTodo]);

  const handleDeleteTodo = useCallback(async (id: number) => {
    if (!todosProject) return;
    try {
      await api.removeTodo(todosProject, id);
      storeRemoveTodo(id);
      if (selectedTodoId === id) {
        selectTodo(null);
      }
    } catch (error) {
      console.error('Failed to remove todo:', error);
    }
  }, [todosProject, storeRemoveTodo, selectedTodoId, selectTodo]);

  const handleSelectTodo = useCallback((id: number) => {
    selectTodo(id);
    setIsTodoDropdownOpen(false);
  }, [selectTodo]);

  const selectedTodo = useMemo(() => {
    if (!selectedTodoId) return null;
    return todos.find(t => t.id === selectedTodoId) || null;
  }, [todos, selectedTodoId]);

  const project = currentSession?.project ?? '';
  const session = currentSession?.name ?? '';

  const handleLinkFile = useCallback(async (filePath: string) => {
    if (!project || !session) return;
    const name = filePath.split('/').pop() || 'code';
    const envelope = {
      code: '',
      language: '',
      filePath,
      originalCode: '',
      diskCode: '',
      linked: true,
      linkCreatedAt: Date.now(),
      lastPushedAt: null,
      lastSyncedAt: Date.now(),
      dirty: false,
    };
    try {
      const result = await api.createSnippet(project, session, name, JSON.stringify(envelope));
      if (result?.id) {
        await api.syncCodeFromDisk(project, session, result.id);
      }
    } catch (error) {
      console.error('Failed to link file:', error);
    }
    setFileBrowserOpen(false);
  }, [project, session]);

  const linkedSnippets = useMemo(() => {
    return snippets
      .filter((snip: any) => {
        // Check metadata-level linked flag (from list endpoint) or content-level
        if (snip.linked === true) return true;
        try {
          const parsed = JSON.parse(snip.content || '');
          return parsed.linked === true;
        } catch { return false; }
      })
      .sort((a, b) => b.lastModified - a.lastModified)
      .map((snip: any) => {
        let displayName = snip.name;
        let filePath = (snip as any).filePath || '';
        let dirty = !!(snip as any).dirty;
        try {
          const parsed = JSON.parse(snip.content || '');
          if (parsed.filePath) {
            displayName = parsed.filePath.split('/').pop() || snip.name;
            filePath = parsed.filePath;
          }
          dirty = !!parsed.dirty;
        } catch {
          // Use metadata-level fields if content isn't available
          if (filePath) displayName = filePath.split('/').pop() || snip.name;
        }
        return {
          ...snip,
          name: displayName,
          type: 'snippet' as const,
          _filePath: filePath,
          _dirty: dirty,
        };
      });
  }, [snippets]);

  const vibeInstructionsDoc = useMemo(() => {
    return documents.find((d) => d.name.endsWith('vibeinstructions')) || null;
  }, [documents]);

  const taskGraphDoc = useMemo(() => {
    return documents.find((d) => d.name === 'task-graph') || null;
  }, [documents]);

  const blueprintItems = useMemo(() => {
    const items = documents
      .filter((d) => d.blueprint && !d.name.endsWith('vibeinstructions'))
      .filter((d) => !d.deprecated)
      .map((d) => ({ ...d, type: 'document' as const }));
    items.sort((a, b) => b.lastModified - a.lastModified);
    return items;
  }, [documents]);

  const filteredItems = useMemo(() => {
    const items: Item[] = [
      ...diagrams.map((d) => ({ ...d, type: 'diagram' as const })),
      ...documents.filter((d) => !d.name.endsWith('vibeinstructions') && !d.blueprint && d.name !== 'task-graph').map((d) => ({ ...d, type: 'document' as const })),
      ...designs.map((d) => ({
        ...d,
        type: 'design' as const,
        content: d.content ?? '',
        lastModified: d.lastModified ?? Date.now(),
      })),
      ...spreadsheets.map((s) => ({
        ...s,
        type: 'spreadsheet' as const,
        content: s.content ?? '',
        lastModified: s.lastModified ?? Date.now(),
      })),
      ...(() => {
        // Deduplicate grouped snippets — show only the most recently modified per groupId
        const seenGroups = new Set<string>();
        return snippets
          .sort((a, b) => b.lastModified - a.lastModified)
          .filter((snip: any) => {
            if (snip.name.endsWith('vibeinstructions')) return false;
            // Filter out linked snippets (they show in Code Files section)
            if (snip.linked === true) return false;
            try {
              const parsed = JSON.parse(snip.content || '');
              if (parsed.linked) return false;
              if (parsed.groupId) {
                if (seenGroups.has(parsed.groupId)) return false;
                seenGroups.add(parsed.groupId);
              }
            } catch { /* not JSON, show it */ }
            return true;
          })
          .map((snip) => {
            // Use groupName as display name for grouped snippets
            let displayName = snip.name;
            try {
              const parsed = JSON.parse(snip.content || '');
              if (parsed.groupName) displayName = parsed.groupName;
            } catch { /* keep original name */ }
            return {
              ...snip,
              name: displayName,
              type: 'snippet' as const,
            };
          });
      })(),
    ];

    // Pinned items first, then by recency
    items.sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return b.lastModified - a.lastModified;
    });

    const visibleItems = showDeprecated ? items : items.filter((item) => !item.deprecated);

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      return visibleItems.filter((item) => item.name.toLowerCase().includes(query));
    }

    return visibleItems;
  }, [diagrams, documents, designs, spreadsheets, snippets, searchQuery, showDeprecated]);

  const isItemSelected = useCallback(
    (item: Item) => {
      if (item.type === 'diagram') return item.id === selectedDiagramId;
      if (item.type === 'design') return item.id === selectedDesignId;
      if (item.type === 'spreadsheet') return item.id === selectedSpreadsheetId;
      if (item.type === 'snippet') return item.id === selectedSnippetId;
      return item.id === selectedDocumentId;
    },
    [selectedDiagramId, selectedDocumentId, selectedDesignId, selectedSpreadsheetId, selectedSnippetId]
  );

  const isDisabled = !currentSession && !todosSelected;

  const hasBatches = collabState?.batches && collabState.batches.length > 0;
  const hasActiveBlueprints = blueprintItems.length > 0;
  const isImplementationPhase = hasBatches && hasActiveBlueprints;

  // Determine if delete buttons should show for items
  const showItemDelete = todosSelected || !!currentSession;

  return (
    <aside
      data-testid="sidebar"
      className={`
        flex flex-col
        w-72
        bg-gray-50 dark:bg-gray-900
        border-r border-gray-200 dark:border-gray-700
        ${className}
      `.trim()}
    >
      {/* Top section: Search bar OR Todo controls */}
      {todosSelected ? (
        <div className="p-2 border-b border-gray-200 dark:border-gray-700 space-y-2">
          {/* Add Todo button */}
          <button
            onClick={() => setShowAddTodoDialog(true)}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
          >
            <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
            </svg>
            Add Todo
          </button>

          {/* Combobox dropdown */}
          <div className="relative">
            <button
              onClick={() => setIsTodoDropdownOpen(prev => !prev)}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-left text-gray-900 dark:text-white hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors"
            >
              <span className="flex-1 truncate">
                {selectedTodo ? selectedTodo.title : 'Select a todo...'}
              </span>
              <svg className={`w-4 h-4 transition-transform ${isTodoDropdownOpen ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>

            {isTodoDropdownOpen && (
              <div className="absolute left-0 right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-50 max-h-60 overflow-y-auto">
                {todos.length === 0 ? (
                  <div className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">No todos yet</div>
                ) : (
                  todos.map((todo) => (
                    <div
                      key={todo.id}
                      className={`flex items-center group hover:bg-gray-100 dark:hover:bg-gray-700 ${selectedTodoId === todo.id ? 'bg-accent-50 dark:bg-accent-900/30' : ''}`}
                    >
                      <button
                        onClick={() => handleSelectTodo(todo.id)}
                        className="flex-1 px-3 py-2 text-left text-sm text-gray-900 dark:text-white truncate"
                      >
                        {todo.title}
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteTodo(todo.id); }}
                        className="p-1.5 mr-1 text-gray-400 hover:text-red-500 dark:text-gray-500 dark:hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Delete todo"
                      >
                        <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                        </svg>
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      ) : null}

      {/* Vibe Instructions — pinned at top of sidebar */}
      {vibeInstructionsDoc && !isDisabled && (
        <div className="px-2 py-1 border-b border-gray-200 dark:border-gray-700">
          <button
            onClick={() => handleItemClick({ ...vibeInstructionsDoc, type: 'document' as const })}
            className={`
              w-full text-left px-3 py-2 rounded-lg
              flex items-center gap-2
              text-sm font-medium
              transition-colors
              ${selectedDocumentId === vibeInstructionsDoc.id
                ? 'bg-accent-100 dark:bg-accent-900 text-accent-700 dark:text-accent-300'
                : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
              }
            `}
          >
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <span>Vibe Instructions</span>
          </button>
        </div>
      )}

      <SubscriptionsPanel currentProject={currentSession?.project} />

      {/* Tasks Section - shown when task graph exists */}
      {isImplementationPhase && !isDisabled && (
        <div className="border-b border-gray-200 dark:border-gray-700">
          <button
            onClick={() => setTasksCollapsed((c) => !c)}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <span>Tasks</span>
            <svg
              className={`w-3 h-3 ml-auto text-gray-400 transition-transform ${tasksCollapsed ? '-rotate-90' : ''}`}
              viewBox="0 0 20 20" fill="currentColor"
            >
              <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
          {!tasksCollapsed && <div className="space-y-1 px-2 pb-2">
            <button
              data-testid="task-graph-entry"
              onClick={selectTaskGraph}
              className={`
                w-full text-left px-3 py-2 rounded-lg
                flex items-center gap-2
                text-sm font-medium
                transition-colors
                ${taskGraphSelected
                  ? 'bg-accent-100 dark:bg-accent-900 text-accent-700 dark:text-accent-300'
                  : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                }
              `}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              <span>Task Graph</span>
            </button>
            {taskGraphDoc && (
              <button
                onClick={() => handleItemClick({ ...taskGraphDoc, type: 'document' as const })}
                className={`
                  w-full text-left px-3 py-2 rounded-lg
                  flex items-center gap-2
                  text-sm font-medium
                  transition-colors
                  ${selectedDocumentId === taskGraphDoc.id
                    ? 'bg-accent-100 dark:bg-accent-900 text-accent-700 dark:text-accent-300'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                  }
                `}
              >
                <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <span>Task Details</span>
              </button>
            )}
          </div>}
        </div>
      )}

      {/* Blueprint Section */}
      {blueprintItems.length > 0 && !isDisabled && !todosSelected && (
        <div className="border-b border-gray-200 dark:border-gray-700">
          <button
            onClick={() => setBlueprintCollapsed((c) => !c)}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <span>Blueprints</span>
            <span className="ml-1 text-gray-400 dark:text-gray-500 font-normal">{blueprintItems.length}</span>
            <svg
              className={`w-3 h-3 ml-auto text-gray-400 transition-transform ${blueprintCollapsed ? '-rotate-90' : ''}`}
              viewBox="0 0 20 20" fill="currentColor"
            >
              <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
          {!blueprintCollapsed && (
            <div className="space-y-1 px-2 pb-2">
              {blueprintItems.map((item) => (
                <div
                  key={`document-${item.id}`}
                  className={`
                    group relative w-full rounded-lg
                    flex items-center gap-2
                    text-sm font-medium
                    transition-colors
                    ${isItemSelected(item)
                      ? 'bg-accent-100 dark:bg-accent-900 text-accent-700 dark:text-accent-300'
                      : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                    }
                  `}
                >
                  <button
                    onClick={() => handleItemClick(item)}
                    className="flex-1 text-left px-3 py-2 flex items-center gap-2 min-w-0"
                  >
                    <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
                      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
                    </svg>
                    <span className="truncate">{item.name}</span>
                  </button>
                  {showItemDelete && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (window.confirm(`Deprecate blueprint "${item.name}" and clear its task graph?`)) {
                          handleDeprecateItem(item);
                        }
                      }}
                      title="Deprecate blueprint and clear task graph"
                      className="opacity-0 group-hover:opacity-100 px-2 py-2 text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-opacity"
                    >
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>
                      </svg>
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Embeds Section */}
      {embeds.length > 0 && !isDisabled && !todosSelected && (
        <div className="border-b border-gray-200 dark:border-gray-700">
          <button
            onClick={() => setEmbedsCollapsed((c) => !c)}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <span>Embeds</span>
            <span className="ml-1 text-gray-400 dark:text-gray-500 font-normal">{embeds.length}</span>
            <svg
              className={`w-3 h-3 ml-auto text-gray-400 transition-transform ${embedsCollapsed ? '-rotate-90' : ''}`}
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
          {!embedsCollapsed && (
            <div className="space-y-1 px-2 pb-2">
              {embeds.map((embed) => (
                <div
                  key={embed.id}
                  className={`group w-full text-left px-2 py-1.5 rounded text-sm flex items-center gap-2 cursor-pointer ${
                    embed.id === selectedEmbedId
                      ? 'bg-accent-100 dark:bg-accent-900 text-accent-700 dark:text-accent-300'
                      : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                  }`}
                  onClick={() => selectEmbed(embed.id)}
                >
                  <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="truncate">{embed.name}</span>
                    <span className="text-xs text-gray-400 dark:text-gray-500 truncate">
                      {embed.storybook?.storyId || (embed.url.length > 30 ? embed.url.slice(0, 30) + '...' : embed.url)}
                    </span>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeleteEmbed(embed.id, embed.name); }}
                    className="opacity-0 group-hover:opacity-100 w-6 h-6 shrink-0 rounded flex items-center justify-center hover:bg-red-100 dark:hover:bg-red-900/30 text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition-all"
                    title={`Delete ${embed.name}`}
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Code Files Section — always shown when a session is active */}
      {!isDisabled && !todosSelected && (
        <div className="border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center">
            <button
              onClick={() => setCodeFilesCollapsed((c) => !c)}
              className="flex-1 flex items-center gap-2 px-3 py-2 text-xs font-semibold text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              <span>Code Files</span>
              <span className="ml-1 text-gray-400 dark:text-gray-500 font-normal">{linkedSnippets.length}</span>
              <svg
                className={`w-3 h-3 ml-auto text-gray-400 transition-transform ${codeFilesCollapsed ? '-rotate-90' : ''}`}
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
            <button
              onClick={() => useGlobalSearch.getState().open()}
              className="p-1.5 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
              title="Search code (Cmd+K)"
              data-testid="sidebar-global-search-button"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2}>
                <circle cx="9" cy="9" r="6" />
                <line x1="14" y1="14" x2="18" y2="18" strokeLinecap="round" />
              </svg>
            </button>
            <button
              onClick={() => setFileBrowserOpen(true)}
              className="p-1.5 mr-2 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
              title="Link a code file"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
          {!codeFilesCollapsed && linkedSnippets.length === 0 && (
            <div className="px-3 pb-2 text-xs text-gray-400 dark:text-gray-500 italic">
              No linked code files. Click + to link one.
            </div>
          )}
          {!codeFilesCollapsed && linkedSnippets.length > 0 && (
            <div className="space-y-1 px-2 pb-2">
              {linkedSnippets.map((snip) => (
                <div
                  key={snip.id}
                  className={`group w-full text-left px-2 py-1.5 rounded text-sm flex items-center gap-2 cursor-pointer ${
                    snip.id === selectedSnippetId
                      ? 'bg-accent-100 dark:bg-accent-900 text-accent-700 dark:text-accent-300'
                      : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                  }`}
                  onClick={() => selectSnippet(snip.id)}
                >
                  <span className="w-4 h-4 shrink-0 flex items-center justify-center text-xs font-mono text-gray-500 dark:text-gray-400">&lt;/&gt;</span>
                  <div className="flex flex-col min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate">{snip.name}</span>
                      {snip._dirty && (
                        <span className="w-2 h-2 rounded-full bg-orange-400 shrink-0" title="Modified" />
                      )}
                    </div>
                    {snip._filePath && (
                      <span className="text-xs text-gray-400 dark:text-gray-500 truncate">{snip._filePath}</span>
                    )}
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeleteItem({ ...snip, type: 'snippet' }); }}
                    className="opacity-0 group-hover:opacity-100 w-6 h-6 shrink-0 rounded flex items-center justify-center hover:bg-red-100 dark:hover:bg-red-900/30 text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition-all"
                    title={`Unlink ${snip.name}`}
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Items List */}
      <div className={`flex-1 overflow-y-auto ${isDisabled ? 'opacity-50 pointer-events-none' : ''}`} role="navigation" aria-label="Sidebar items">
        {/* Items section header with search */}
        {!isDisabled && !todosSelected && (
          <div className="px-2 pt-2 pb-1">
            <div className="flex items-center justify-between px-1 pb-1">
              <span className="text-xs font-semibold text-gray-900 dark:text-gray-100">Items</span>
              <button
                onClick={handleImport}
                className="p-1 text-gray-400 hover:text-blue-500 dark:text-gray-500 dark:hover:text-blue-400 rounded hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                title="Import file"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 6.707a1 1 0 010-1.414l3-3a1 1 0 011.414 0l3 3a1 1 0 01-1.414 1.414L11 5.414V13a1 1 0 11-2 0V5.414L7.707 6.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
                </svg>
              </button>
            </div>
            <input
              data-testid="sidebar-search"
              type="text"
              placeholder="Search items..."
              value={searchQuery}
              onChange={handleSearchChange}
              className="
                  w-full
                  px-3 py-1.5
                  text-sm
                  bg-white dark:bg-gray-800
                  border border-gray-300 dark:border-gray-600
                  rounded-lg
                  placeholder-gray-400 dark:placeholder-gray-500
                  text-gray-900 dark:text-white
                  focus:outline-none
                  focus:ring-2 focus:ring-accent-500 dark:focus:ring-accent-400
                  focus:border-transparent
                  transition-colors
              "
            />
            <div className="flex items-center gap-2 px-1 mt-1">
              <input
                type="checkbox"
                id="show-deprecated"
                checked={showDeprecated}
                onChange={(e) => setShowDeprecated(e.target.checked)}
                className="w-3.5 h-3.5 rounded border-gray-300 dark:border-gray-600 text-accent-600"
              />
              <label htmlFor="show-deprecated" className="text-xs text-gray-500 dark:text-gray-400 cursor-pointer select-none">
                Show deprecated
              </label>
            </div>
          </div>
        )}
        {isDisabled ? (
          <div data-testid="sidebar-empty" className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400 text-center">
            Select a session to view items
          </div>
        ) : todosSelected && !selectedTodoId ? (
          <div data-testid="sidebar-empty" className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400 text-center">
            Select a todo to view items
          </div>
        ) : todosSelected && selectedTodoId && filteredItems.length === 0 ? (
          <div data-testid="sidebar-empty" className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400 text-center">
            No items yet
          </div>
        ) : filteredItems.length === 0 ? (
          <div data-testid="sidebar-empty" className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
            {searchQuery ? 'No matching items' : 'No items'}
          </div>
        ) : (
          <div className="space-y-2 px-2">
            {filteredItems.map((item) => (
              <ItemCard
                key={`${item.type}-${item.id}`}
                item={item}
                isSelected={isItemSelected(item)}
                onClick={() => handleItemClick(item)}
                showDelete={showItemDelete}
                onDelete={() => handleDeleteItem(item)}
                onDeprecate={showItemDelete ? () => handleDeprecateItem(item) : undefined}
                onPin={showItemDelete ? () => handlePinItem(item) : undefined}
                onDownload={showItemDelete ? () => handleDownloadItem(item) : undefined}
                onEmail={showItemDelete ? () => handleEmailItem(item) : undefined}
              />
            ))}
          </div>
        )}
      </div>


      {/* Add Todo Dialog */}
      {showAddTodoDialog && (
        <AddTodoDialog
          onConfirm={handleAddTodoConfirm}
          onClose={() => setShowAddTodoDialog(false)}
        />
      )}
      <FileBrowserDialog
        open={fileBrowserOpen}
        onClose={() => setFileBrowserOpen(false)}
        onSelect={handleLinkFile}
        project={project}
      />
    </aside>
  );
};

export default Sidebar;
