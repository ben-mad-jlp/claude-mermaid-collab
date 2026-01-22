/**
 * useDiagram Hook
 *
 * Provides React integration for diagram operations with:
 * - Access to diagrams in current session
 * - Diagram selection management
 * - Diagram CRUD operations
 * - Selected diagram convenience getter
 */

import { useCallback } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Diagram } from '../types';
import { useSessionStore } from '../stores/sessionStore';

export interface UseDiagramReturn {
  // Diagram state
  diagrams: Diagram[];
  selectedDiagramId: string | null;
  selectedDiagram: Diagram | undefined;

  // Diagram operations
  addDiagram: (diagram: Diagram) => void;
  updateDiagram: (id: string, updates: Partial<Diagram>) => void;
  removeDiagram: (id: string) => void;
  selectDiagram: (id: string | null) => void;

  // Bulk operations
  setDiagrams: (diagrams: Diagram[]) => void;

  // Utility
  getDiagramById: (id: string) => Diagram | undefined;
  hasDiagram: (id: string) => boolean;
}

/**
 * Hook for accessing and managing diagrams in the current session
 *
 * Provides convenient access to diagram state and operations from the session store
 *
 * @returns Diagram state and operation methods
 *
 * @example
 * ```tsx
 * function DiagramList() {
 *   const { diagrams, selectedDiagram, selectDiagram, removeDiagram } = useDiagram();
 *
 *   return (
 *     <div>
 *       {diagrams.map((d) => (
 *         <div
 *           key={d.id}
 *           onClick={() => selectDiagram(d.id)}
 *           style={{
 *             fontWeight: selectedDiagram?.id === d.id ? 'bold' : 'normal',
 *           }}
 *         >
 *           <span>{d.name}</span>
 *           <button onClick={(e) => {
 *             e.stopPropagation();
 *             removeDiagram(d.id);
 *           }}>
 *             Delete
 *           </button>
 *         </div>
 *       ))}
 *     </div>
 *   );
 * }
 * ```
 */
export function useDiagram(): UseDiagramReturn {
  // Get diagram state using shallow comparison
  const {
    diagrams,
    selectedDiagramId,
    getSelectedDiagram,
    setDiagrams,
    addDiagram,
    updateDiagram,
    removeDiagram,
    selectDiagram,
  } = useSessionStore(
    useShallow((state) => ({
      diagrams: state.diagrams,
      selectedDiagramId: state.selectedDiagramId,
      getSelectedDiagram: state.getSelectedDiagram,
      setDiagrams: state.setDiagrams,
      addDiagram: state.addDiagram,
      updateDiagram: state.updateDiagram,
      removeDiagram: state.removeDiagram,
      selectDiagram: state.selectDiagram,
    }))
  );

  // Get selected diagram
  const selectedDiagram = getSelectedDiagram();

  // Get diagram by ID
  const getDiagramById = useCallback(
    (id: string): Diagram | undefined => {
      return diagrams.find((d) => d.id === id);
    },
    [diagrams]
  );

  // Check if diagram exists
  const hasDiagram = useCallback(
    (id: string): boolean => {
      return diagrams.some((d) => d.id === id);
    },
    [diagrams]
  );

  return {
    diagrams,
    selectedDiagramId,
    selectedDiagram,
    addDiagram: useCallback(
      (diagram: Diagram) => {
        addDiagram(diagram);
      },
      [addDiagram]
    ),
    updateDiagram: useCallback(
      (id: string, updates: Partial<Diagram>) => {
        updateDiagram(id, updates);
      },
      [updateDiagram]
    ),
    removeDiagram: useCallback(
      (id: string) => {
        removeDiagram(id);
      },
      [removeDiagram]
    ),
    selectDiagram: useCallback(
      (id: string | null) => {
        selectDiagram(id);
      },
      [selectDiagram]
    ),
    setDiagrams: useCallback(
      (diagrams: Diagram[]) => {
        setDiagrams(diagrams);
      },
      [setDiagrams]
    ),
    getDiagramById,
    hasDiagram,
  };
}
