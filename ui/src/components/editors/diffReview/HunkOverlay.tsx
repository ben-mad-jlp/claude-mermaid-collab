import React, { useCallback, useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import type * as Monaco from 'monaco-editor';
import { HunkActionRow } from './HunkActionRow';
import { getHunkPixelTop } from './hunkUtils';

export interface HunkOverlayProps {
  diffEditorRef: React.RefObject<Monaco.editor.IStandaloneDiffEditor | null>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  lineChanges: Monaco.editor.ILineChange[];
  observeMode: boolean;
  onAcceptHunk: (index: number, comment?: string) => void;
  onRejectHunk: (index: number, comment?: string) => void;
}

export const HunkOverlay: React.FC<HunkOverlayProps> = ({
  diffEditorRef,
  containerRef,
  lineChanges,
  observeMode,
  onAcceptHunk,
  onRejectHunk,
}) => {
  const [positions, setPositions] = useState<Map<number, number>>(new Map());
  const disposablesRef = useRef<Monaco.IDisposable[]>([]);

  const recompute = useCallback(() => {
    const diffEditor = diffEditorRef.current;
    if (!diffEditor) return;
    const modifiedEditor = diffEditor.getModifiedEditor();
    const next = new Map<number, number>();
    lineChanges.forEach((change, index) => {
      const top = getHunkPixelTop(change, modifiedEditor);
      if (top !== null) next.set(index, top);
    });
    setPositions(next);
  }, [diffEditorRef, lineChanges]);

  // Subscribe to Monaco scroll/layout events
  useEffect(() => {
    const diffEditor = diffEditorRef.current;
    if (!diffEditor) return;
    const modifiedEditor = diffEditor.getModifiedEditor();

    // Clean up previous disposables
    disposablesRef.current.forEach((d) => d.dispose());
    disposablesRef.current = [
      modifiedEditor.onDidScrollChange(recompute),
      modifiedEditor.onDidLayoutChange(recompute),
    ];

    recompute();

    return () => {
      disposablesRef.current.forEach((d) => d.dispose());
      disposablesRef.current = [];
    };
  }, [diffEditorRef, recompute]);

  // Window resize
  useEffect(() => {
    window.addEventListener('resize', recompute);
    return () => window.removeEventListener('resize', recompute);
  }, [recompute]);

  if (!containerRef.current || lineChanges.length === 0) return null;

  return ReactDOM.createPortal(
    <>
      {Array.from(positions.entries()).map(([index, top]) => (
        <HunkActionRow
          key={index}
          hunk={lineChanges[index]}
          index={index}
          total={lineChanges.length}
          top={top}
          readOnly={observeMode}
          onAccept={(comment) => onAcceptHunk(index, comment)}
          onReject={(comment) => onRejectHunk(index, comment)}
        />
      ))}
    </>,
    containerRef.current,
  );
};

export default HunkOverlay;
