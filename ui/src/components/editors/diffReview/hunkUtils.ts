import type * as Monaco from 'monaco-editor';

export const ROW_HEIGHT = 28;

export function getHunkPixelTop(
  lineChange: Monaco.editor.ILineChange,
  modifiedEditor: Monaco.editor.ICodeEditor,
): number | null {
  const lineNumber =
    lineChange.modifiedStartLineNumber > 0
      ? lineChange.modifiedStartLineNumber
      : lineChange.modifiedEndLineNumber;

  if (lineNumber === 0) return null;

  const pos = modifiedEditor.getScrolledVisiblePosition({ lineNumber, column: 1 });
  if (pos === null) return null;

  return Math.max(0, pos.top - ROW_HEIGHT);
}

export function acceptHunk(
  diffEditor: Monaco.editor.IStandaloneDiffEditor,
  lineChange: Monaco.editor.ILineChange,
): void {
  const originalModel = diffEditor.getOriginalEditor().getModel();
  const modifiedModel = diffEditor.getModifiedEditor().getModel();
  if (!originalModel || !modifiedModel) return;

  const modifiedLines: string[] = [];
  if (lineChange.modifiedStartLineNumber > 0 && lineChange.modifiedEndLineNumber > 0) {
    for (let i = lineChange.modifiedStartLineNumber; i <= lineChange.modifiedEndLineNumber; i++) {
      modifiedLines.push(modifiedModel.getLineContent(i));
    }
  }

  if (lineChange.originalStartLineNumber === 0) {
    // Pure addition: insert AFTER originalEndLineNumber anchor
    const anchor = lineChange.originalEndLineNumber;
    if (anchor === 0) {
      // File is empty — insert at beginning
      originalModel.applyEdits([{
        range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 },
        text: modifiedLines.join('\n') + '\n',
        forceMoveMarkers: true,
      }]);
    } else {
      const insertLine = anchor + 1;
      originalModel.applyEdits([{
        range: { startLineNumber: insertLine, startColumn: 1, endLineNumber: insertLine, endColumn: 1 },
        text: modifiedLines.join('\n') + '\n',
        forceMoveMarkers: true,
      }]);
    }
    return;
  }

  const startLine = lineChange.originalStartLineNumber;
  const endLine = lineChange.originalEndLineNumber;

  if (modifiedLines.length === 0) {
    // Pure deletion: remove lines including trailing newline
    let deleteRange: Monaco.IRange;
    if (startLine === 1 && endLine === originalModel.getLineCount()) {
      // Whole-file deletion
      deleteRange = { startLineNumber: 1, startColumn: 1, endLineNumber: endLine, endColumn: originalModel.getLineMaxColumn(endLine) };
    } else if (endLine < originalModel.getLineCount()) {
      deleteRange = { startLineNumber: startLine, startColumn: 1, endLineNumber: endLine + 1, endColumn: 1 };
    } else {
      // endLine is the last line; delete via preceding newline (startLine - 1 guaranteed >= 1 here)
      deleteRange = { startLineNumber: startLine - 1, startColumn: originalModel.getLineMaxColumn(startLine - 1), endLineNumber: endLine, endColumn: originalModel.getLineMaxColumn(endLine) };
    }
    originalModel.applyEdits([{ range: deleteRange, text: '', forceMoveMarkers: true }]);
    return;
  }

  originalModel.applyEdits([{
    range: { startLineNumber: startLine, startColumn: 1, endLineNumber: endLine, endColumn: originalModel.getLineMaxColumn(endLine) },
    text: modifiedLines.join('\n'),
    forceMoveMarkers: true,
  }]);
}

export function rejectHunk(
  diffEditor: Monaco.editor.IStandaloneDiffEditor,
  lineChange: Monaco.editor.ILineChange,
): void {
  const originalModel = diffEditor.getOriginalEditor().getModel();
  const modifiedModel = diffEditor.getModifiedEditor().getModel();
  if (!originalModel || !modifiedModel) return;

  const originalLines: string[] = [];
  if (lineChange.originalStartLineNumber > 0 && lineChange.originalEndLineNumber > 0) {
    for (let i = lineChange.originalStartLineNumber; i <= lineChange.originalEndLineNumber; i++) {
      originalLines.push(originalModel.getLineContent(i));
    }
  }

  if (lineChange.modifiedStartLineNumber === 0) {
    // Pure deletion in modified (addition in original): insert AFTER modifiedEndLineNumber anchor
    const anchor = lineChange.modifiedEndLineNumber;
    if (anchor === 0) {
      // File is empty — insert at beginning
      modifiedModel.applyEdits([{
        range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 },
        text: originalLines.join('\n') + '\n',
        forceMoveMarkers: true,
      }]);
    } else {
      const insertLine = anchor + 1;
      modifiedModel.applyEdits([{
        range: { startLineNumber: insertLine, startColumn: 1, endLineNumber: insertLine, endColumn: 1 },
        text: originalLines.join('\n') + '\n',
        forceMoveMarkers: true,
      }]);
    }
    return;
  }

  const startLine = lineChange.modifiedStartLineNumber;
  const endLine = lineChange.modifiedEndLineNumber;

  if (originalLines.length === 0) {
    // Pure addition in modified: delete the modified lines
    let deleteRange: Monaco.IRange;
    if (startLine === 1 && endLine === modifiedModel.getLineCount()) {
      // Whole-file deletion
      deleteRange = { startLineNumber: 1, startColumn: 1, endLineNumber: endLine, endColumn: modifiedModel.getLineMaxColumn(endLine) };
    } else if (endLine < modifiedModel.getLineCount()) {
      deleteRange = { startLineNumber: startLine, startColumn: 1, endLineNumber: endLine + 1, endColumn: 1 };
    } else {
      // endLine is the last line; delete via preceding newline (startLine - 1 guaranteed >= 1 here)
      deleteRange = { startLineNumber: startLine - 1, startColumn: modifiedModel.getLineMaxColumn(startLine - 1), endLineNumber: endLine, endColumn: modifiedModel.getLineMaxColumn(endLine) };
    }
    modifiedModel.applyEdits([{ range: deleteRange, text: '', forceMoveMarkers: true }]);
    return;
  }

  modifiedModel.applyEdits([{
    range: { startLineNumber: startLine, startColumn: 1, endLineNumber: endLine, endColumn: modifiedModel.getLineMaxColumn(endLine) },
    text: originalLines.join('\n'),
    forceMoveMarkers: true,
  }]);
}
