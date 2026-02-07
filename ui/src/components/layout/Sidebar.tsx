import React, { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { useSessionStore } from '@/stores/sessionStore';
import { useDataLoader } from '@/hooks/useDataLoader';
import { ItemCard } from '@/components/layout/ItemCard';
import { Item } from '@/types';
import { api } from '@/lib/api';
import { AddTodoDialog } from '@/components/dialogs';

export interface SidebarProps {
  className?: string;
}

export const Sidebar: React.FC<SidebarProps> = ({
  className = '',
}) => {
  const {
    diagrams,
    documents,
    wireframes,
    selectedDiagramId,
    selectedDocumentId,
    selectedWireframeId,
    taskGraphSelected,
    currentSession,
    collabState,
    selectTaskGraph,
    removeDiagram,
    removeDocument,
    removeWireframe,
    todosSelected,
    todosProject,
    todos,
    selectedTodoId,
    selectTodo,
    removeTodo: storeRemoveTodo,
    setTodos,
    addTodo: storeAddTodo,
  } = useSessionStore(
    useShallow((state) => ({
      diagrams: state.diagrams,
      documents: state.documents,
      wireframes: state.wireframes,
      selectedDiagramId: state.selectedDiagramId,
      selectedDocumentId: state.selectedDocumentId,
      selectedWireframeId: state.selectedWireframeId,
      taskGraphSelected: state.taskGraphSelected,
      currentSession: state.currentSession,
      collabState: state.collabState,
      selectTaskGraph: state.selectTaskGraph,
      removeDiagram: state.removeDiagram,
      removeDocument: state.removeDocument,
      removeWireframe: state.removeWireframe,
      todosSelected: state.todosSelected,
      todosProject: state.todosProject,
      todos: state.todos,
      selectedTodoId: state.selectedTodoId,
      selectTodo: state.selectTodo,
      removeTodo: state.removeTodo,
      setTodos: state.setTodos,
      addTodo: state.addTodo,
    }))
  );

  const { selectDiagramWithContent, selectDocumentWithContent, selectWireframeWithContent } = useDataLoader();

  const [searchQuery, setSearchQuery] = useState('');
  const [showAddTodoDialog, setShowAddTodoDialog] = useState(false);
  const [isTodoDropdownOpen, setIsTodoDropdownOpen] = useState(false);

  const isVibing = collabState?.state === 'vibe-active' || collabState?.phase === 'vibe-active';

  const handleDeleteItem = useCallback(
    async (item: Item) => {
      if (!currentSession) return;

      const typeLabel = item.type === 'diagram' ? 'diagram' : item.type === 'wireframe' ? 'wireframe' : 'document';
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
        } else if (item.type === 'wireframe') {
          await api.deleteWireframe(currentSession.project, currentSession.name, item.id);
          removeWireframe(item.id);
        }
      } catch (error) {
        console.error('Failed to delete item:', error);
      }
    },
    [currentSession, removeDiagram, removeDocument, removeWireframe]
  );

  const handleItemClick = useCallback(
    (item: Item) => {
      if (!currentSession) return;

      if (item.type === 'diagram') {
        selectDiagramWithContent(currentSession.project, currentSession.name, item.id);
      } else if (item.type === 'wireframe') {
        selectWireframeWithContent(currentSession.project, currentSession.name, item.id);
      } else {
        selectDocumentWithContent(currentSession.project, currentSession.name, item.id);
      }
    },
    [currentSession, selectDiagramWithContent, selectDocumentWithContent, selectWireframeWithContent]
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

  const filteredItems = useMemo(() => {
    const items: Item[] = [
      ...diagrams.map((d) => ({ ...d, type: 'diagram' as const })),
      ...documents.map((d) => ({ ...d, type: 'document' as const })),
      ...wireframes.map((w) => ({
        ...w,
        type: 'wireframe' as const,
        content: w.content ?? '',
        lastModified: w.lastModified ?? Date.now(),
      })),
    ];

    items.sort((a, b) => b.lastModified - a.lastModified);

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      return items.filter((item) => item.name.toLowerCase().includes(query));
    }

    return items;
  }, [diagrams, documents, wireframes, searchQuery]);

  const isItemSelected = useCallback(
    (item: Item) => {
      if (item.type === 'diagram') return item.id === selectedDiagramId;
      if (item.type === 'wireframe') return item.id === selectedWireframeId;
      return item.id === selectedDocumentId;
    },
    [selectedDiagramId, selectedDocumentId, selectedWireframeId]
  );

  const isDisabled = !currentSession && !todosSelected;

  const currentState = collabState?.state;
  const currentPhase = collabState?.phase;
  const isImplementationPhase =
    currentPhase === 'implementation' ||
    currentState === 'execute-batch' ||
    currentState === 'ready-to-implement';

  // Determine if delete buttons should show for items
  const showItemDelete = todosSelected || isVibing;

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
      ) : (
        <div className={`p-2 border-b border-gray-200 dark:border-gray-700 ${isDisabled ? 'opacity-50 pointer-events-none' : ''}`}>
          <input
            data-testid="sidebar-search"
            type="text"
            placeholder="Search items..."
            value={searchQuery}
            onChange={handleSearchChange}
            disabled={isDisabled}
            className="
                w-full
                px-3 py-2
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
                disabled:cursor-not-allowed
            "
          />
        </div>
      )}

      {/* Task Graph Entry - shown during implementation phase */}
      {isImplementationPhase && !isDisabled && (
        <div className="px-2 py-1 border-b border-gray-200 dark:border-gray-700">
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
        </div>
      )}

      {/* Items List */}
      <div className={`flex-1 py-2 overflow-y-auto ${isDisabled ? 'opacity-50 pointer-events-none' : ''}`} role="navigation" aria-label="Sidebar items">
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
                key={item.id}
                item={item}
                isSelected={isItemSelected(item)}
                onClick={() => handleItemClick(item)}
                showDelete={showItemDelete}
                onDelete={() => handleDeleteItem(item)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Cross-link to Kodex */}
      <div className="p-2 border-t border-gray-200 dark:border-gray-700">
        <Link
          to="/kodex"
          className="flex items-center gap-3 px-3 py-2 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
          </svg>
          <span className="text-sm">Kodex</span>
        </Link>
      </div>

      {/* Add Todo Dialog */}
      {showAddTodoDialog && (
        <AddTodoDialog
          onConfirm={handleAddTodoConfirm}
          onClose={() => setShowAddTodoDialog(false)}
        />
      )}
    </aside>
  );
};

export default Sidebar;
