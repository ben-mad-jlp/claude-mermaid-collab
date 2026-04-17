import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useSessionStore } from '@/stores/sessionStore';
import { api } from '@/lib/api';

interface SpreadsheetColumn {
  id: string;
  name: string;
  type: 'text' | 'number' | 'boolean' | 'date';
  width?: number;
}

interface SpreadsheetRow {
  id: string;
  cells: Record<string, string | number | boolean | null>;
}

interface SpreadsheetData {
  columns: SpreadsheetColumn[];
  rows: SpreadsheetRow[];
  aggregates?: Record<string, 'SUM' | 'AVG' | 'COUNT' | 'MIN' | 'MAX'>;
}

interface SpreadsheetEditorProps {
  spreadsheetId: string;
}

type SortDirection = 'asc' | 'desc' | null;

interface ContextMenuState {
  x: number;
  y: number;
  type: 'row' | 'column';
  targetId: string;
}

export const SpreadsheetEditor: React.FC<SpreadsheetEditorProps> = ({ spreadsheetId }) => {
  const spreadsheet = useSessionStore((state) =>
    state.spreadsheets.find((s) => s.id === spreadsheetId)
  );
  const updateSpreadsheet = useSessionStore((state) => state.updateSpreadsheet);
  const currentSession = useSessionStore((state) => state.currentSession);

  const [editingCell, setEditingCell] = useState<{ rowId: string; colId: string } | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>(null);
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [addingColumn, setAddingColumn] = useState(false);
  const [newColumnName, setNewColumnName] = useState('');
  const [newColumnType, setNewColumnType] = useState<SpreadsheetColumn['type']>('text');
  const inputRef = useRef<HTMLInputElement>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastSelectedRowRef = useRef<string | null>(null);
  const newColInputRef = useRef<HTMLInputElement>(null);

  const data: SpreadsheetData | null = useMemo(() => {
    if (!spreadsheet?.content) return null;
    try {
      return JSON.parse(spreadsheet.content) as SpreadsheetData;
    } catch {
      return null;
    }
  }, [spreadsheet?.content]);

  const saveData = useCallback(
    (newData: SpreadsheetData) => {
      const content = JSON.stringify(newData, null, 2);
      updateSpreadsheet(spreadsheetId, { content });

      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
      saveTimerRef.current = setTimeout(() => {
        if (currentSession) {
          api.updateSpreadsheet(
            currentSession.project,
            currentSession.name,
            spreadsheetId,
            content
          ).catch(console.error);
        }
      }, 500);
    },
    [spreadsheetId, currentSession, updateSpreadsheet]
  );

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (spreadsheet && !spreadsheet.content && currentSession) {
      api
        .getSpreadsheet(currentSession.project, currentSession.name, spreadsheet.id)
        .then((full) => {
          if (full?.content) updateSpreadsheet(spreadsheet.id, { content: full.content });
        })
        .catch(() => {});
    }
  }, [spreadsheet?.id, spreadsheet?.content, currentSession, updateSpreadsheet]);

  useEffect(() => {
    if (editingCell && inputRef.current) {
      inputRef.current.focus();
    }
  }, [editingCell]);

  useEffect(() => {
    if (addingColumn && newColInputRef.current) {
      newColInputRef.current.focus();
    }
  }, [addingColumn]);

  // Dismiss context menu on click outside or Escape
  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = () => setContextMenu(null);
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu(null);
    };
    document.addEventListener('click', handleClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('click', handleClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [contextMenu]);

  // Clipboard copy/paste
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleCopy = (e: ClipboardEvent) => {
      if (selectedRows.size === 0 || !data) return;
      // Don't intercept if user is editing a cell (let browser handle it)
      if (editingCell) return;

      e.preventDefault();
      const headers = data.columns.map((c) => c.name).join('\t');
      const rowLines = data.rows
        .filter((r) => selectedRows.has(r.id))
        .map((r) =>
          data.columns
            .map((col) => {
              const v = r.cells[col.id];
              return v != null ? String(v) : '';
            })
            .join('\t')
        );
      const tsv = [headers, ...rowLines].join('\n');
      e.clipboardData?.setData('text/plain', tsv);
    };

    const handlePaste = (e: ClipboardEvent) => {
      if (!data) return;
      if (editingCell) return;

      e.preventDefault();
      const text = e.clipboardData?.getData('text/plain');
      if (!text) return;

      const lines = text.split('\n').filter((l) => l.length > 0);
      if (lines.length === 0) return;

      // Try to detect if first line is a header row
      const firstLineCells = lines[0].split('\t');
      const headerMatchCount = firstLineCells.filter((cell) =>
        data.columns.some((col) => col.name.toLowerCase() === cell.trim().toLowerCase())
      ).length;
      const hasHeaderRow = headerMatchCount >= Math.ceil(data.columns.length / 2);

      let colMapping: (string | null)[];
      let dataLines: string[];

      if (hasHeaderRow) {
        // Map columns by header name
        colMapping = firstLineCells.map((header) => {
          const match = data.columns.find(
            (col) => col.name.toLowerCase() === header.trim().toLowerCase()
          );
          return match?.id ?? null;
        });
        dataLines = lines.slice(1);
      } else {
        // Map columns by position
        colMapping = firstLineCells.map((_, i) =>
          i < data.columns.length ? data.columns[i].id : null
        );
        dataLines = lines;
      }

      const newRows: SpreadsheetRow[] = dataLines.map((line) => {
        const values = line.split('\t');
        const cells: Record<string, string | number | boolean | null> = {};
        values.forEach((val, i) => {
          const colId = colMapping[i];
          if (!colId) return;
          const col = data.columns.find((c) => c.id === colId);
          if (!col) return;
          const trimmed = val.trim();
          if (trimmed === '') return;
          if (col.type === 'number') {
            const num = Number(trimmed);
            if (!isNaN(num)) cells[colId] = num;
          } else if (col.type === 'boolean') {
            cells[colId] = trimmed.toLowerCase() === 'true';
          } else {
            cells[colId] = trimmed;
          }
        });
        return {
          id: `row_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          cells,
        };
      });

      if (newRows.length > 0) {
        saveData({ ...data, rows: [...data.rows, ...newRows] });
      }
    };

    container.addEventListener('copy', handleCopy);
    container.addEventListener('paste', handlePaste);
    return () => {
      container.removeEventListener('copy', handleCopy);
      container.removeEventListener('paste', handlePaste);
    };
  }, [data, selectedRows, editingCell, saveData]);

  const sortedRows = useMemo(() => {
    if (!data) return [];
    if (!sortColumn || !sortDirection) return data.rows;

    const col = data.columns.find((c) => c.id === sortColumn);
    if (!col) return data.rows;

    return [...data.rows].sort((a, b) => {
      const aVal = a.cells[sortColumn];
      const bVal = b.cells[sortColumn];

      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return sortDirection === 'asc' ? -1 : 1;
      if (bVal == null) return sortDirection === 'asc' ? 1 : -1;

      if (col.type === 'number') {
        return sortDirection === 'asc'
          ? Number(aVal) - Number(bVal)
          : Number(bVal) - Number(aVal);
      }

      const aStr = String(aVal);
      const bStr = String(bVal);
      return sortDirection === 'asc'
        ? aStr.localeCompare(bStr)
        : bStr.localeCompare(aStr);
    });
  }, [data, sortColumn, sortDirection]);

  const handleSort = useCallback((colId: string, direction?: 'asc' | 'desc') => {
    if (direction) {
      setSortColumn(colId);
      setSortDirection(direction);
      return;
    }
    setSortColumn((prev) => {
      if (prev !== colId) {
        setSortDirection('asc');
        return colId;
      }
      setSortDirection((dir) => {
        if (dir === 'asc') return 'desc';
        if (dir === 'desc') {
          setSortColumn(null);
          return null;
        }
        return 'asc';
      });
      return colId;
    });
  }, []);

  const handleCellClick = useCallback(
    (rowId: string, colId: string, col: SpreadsheetColumn) => {
      if (col.type === 'boolean') {
        if (!data) return;
        const newData = {
          ...data,
          rows: data.rows.map((r) =>
            r.id === rowId
              ? { ...r, cells: { ...r.cells, [colId]: !r.cells[colId] } }
              : r
          ),
        };
        saveData(newData);
        return;
      }
      const row = data?.rows.find((r) => r.id === rowId);
      const value = row?.cells[colId];
      setEditingCell({ rowId, colId });
      setEditValue(value != null ? String(value) : '');
    },
    [data, saveData]
  );

  const handleCellSave = useCallback(() => {
    if (!editingCell || !data) return;

    const col = data.columns.find((c) => c.id === editingCell.colId);
    if (!col) return;

    let parsedValue: string | number | boolean | null = editValue;
    if (col.type === 'number') {
      parsedValue = editValue === '' ? null : Number(editValue);
    } else if (col.type === 'boolean') {
      parsedValue = editValue.toLowerCase() === 'true';
    }

    const newData = {
      ...data,
      rows: data.rows.map((r) =>
        r.id === editingCell.rowId
          ? { ...r, cells: { ...r.cells, [editingCell.colId]: parsedValue } }
          : r
      ),
    };

    saveData(newData);
    setEditingCell(null);
  }, [editingCell, editValue, data, saveData]);

  const handleAddRow = useCallback(() => {
    if (!data) return;
    const newRow: SpreadsheetRow = {
      id: `row_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      cells: {},
    };
    const newData = { ...data, rows: [...data.rows, newRow] };
    saveData(newData);
  }, [data, saveData]);

  // Row operations
  const handleDeleteRow = useCallback((rowId: string) => {
    if (!data) return;
    saveData({ ...data, rows: data.rows.filter((r) => r.id !== rowId) });
    setSelectedRows((prev) => {
      const next = new Set(prev);
      next.delete(rowId);
      return next;
    });
    setContextMenu(null);
  }, [data, saveData]);

  const handleDuplicateRow = useCallback((rowId: string) => {
    if (!data) return;
    const idx = data.rows.findIndex((r) => r.id === rowId);
    if (idx === -1) return;
    const original = data.rows[idx];
    const clone: SpreadsheetRow = {
      id: `row_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      cells: { ...original.cells },
    };
    const newRows = [...data.rows];
    newRows.splice(idx + 1, 0, clone);
    saveData({ ...data, rows: newRows });
    setContextMenu(null);
  }, [data, saveData]);

  const handleInsertRowAbove = useCallback((rowId: string) => {
    if (!data) return;
    const idx = data.rows.findIndex((r) => r.id === rowId);
    if (idx === -1) return;
    const newRow: SpreadsheetRow = {
      id: `row_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      cells: {},
    };
    const newRows = [...data.rows];
    newRows.splice(idx, 0, newRow);
    saveData({ ...data, rows: newRows });
    setContextMenu(null);
  }, [data, saveData]);

  // Column operations
  const handleDeleteColumn = useCallback((colId: string) => {
    if (!data) return;
    const newColumns = data.columns.filter((c) => c.id !== colId);
    const newRows = data.rows.map((r) => {
      const { [colId]: _, ...restCells } = r.cells;
      return { ...r, cells: restCells };
    });
    const newAggregates = data.aggregates ? { ...data.aggregates } : undefined;
    if (newAggregates) {
      delete newAggregates[colId];
    }
    saveData({ columns: newColumns, rows: newRows, aggregates: newAggregates });
    if (sortColumn === colId) {
      setSortColumn(null);
      setSortDirection(null);
    }
    setContextMenu(null);
  }, [data, saveData, sortColumn]);

  const handleDuplicateColumn = useCallback((colId: string) => {
    if (!data) return;
    const original = data.columns.find((c) => c.id === colId);
    if (!original) return;
    const newId = `col_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const newCol: SpreadsheetColumn = {
      ...original,
      id: newId,
      name: `${original.name} (copy)`,
    };
    const newColumns = [...data.columns, newCol];
    const newRows = data.rows.map((r) => ({
      ...r,
      cells: { ...r.cells, [newId]: r.cells[colId] ?? null },
    }));
    saveData({ ...data, columns: newColumns, rows: newRows });
    setContextMenu(null);
  }, [data, saveData]);

  const handleAddColumn = useCallback(() => {
    if (!data || !newColumnName.trim()) return;
    const slug = newColumnName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    const newId = `col_${slug || Date.now()}`;
    // Ensure unique ID
    const existingIds = new Set(data.columns.map((c) => c.id));
    let finalId = newId;
    let counter = 2;
    while (existingIds.has(finalId)) {
      finalId = `${newId}_${counter++}`;
    }
    const newCol: SpreadsheetColumn = {
      id: finalId,
      name: newColumnName.trim(),
      type: newColumnType,
    };
    saveData({ ...data, columns: [...data.columns, newCol] });
    setNewColumnName('');
    setNewColumnType('text');
    setAddingColumn(false);
  }, [data, saveData, newColumnName, newColumnType]);

  // Row selection
  const handleRowSelect = useCallback((rowId: string, shiftKey: boolean) => {
    if (!data) return;
    setSelectedRows((prev) => {
      const next = new Set(prev);
      if (shiftKey && lastSelectedRowRef.current) {
        // Range select
        const rowIds = data.rows.map((r) => r.id);
        const startIdx = rowIds.indexOf(lastSelectedRowRef.current);
        const endIdx = rowIds.indexOf(rowId);
        if (startIdx !== -1 && endIdx !== -1) {
          const [lo, hi] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
          for (let i = lo; i <= hi; i++) {
            next.add(rowIds[i]);
          }
        }
      } else {
        if (next.has(rowId)) {
          next.delete(rowId);
        } else {
          next.add(rowId);
        }
      }
      lastSelectedRowRef.current = rowId;
      return next;
    });
  }, [data]);

  const handleContextMenu = useCallback((e: React.MouseEvent, type: 'row' | 'column', targetId: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, type, targetId });
  }, []);

  const handleTableBodyClick = useCallback((e: React.MouseEvent) => {
    // Deselect rows when clicking table body (not row numbers)
    const target = e.target as HTMLElement;
    if (!target.closest('[data-row-number]')) {
      setSelectedRows(new Set());
    }
  }, []);

  const computeAggregate = useCallback(
    (colId: string, fn: string): string => {
      if (!data) return '';
      const values = data.rows
        .map((r) => r.cells[colId])
        .filter((v) => v != null && v !== '')
        .map(Number)
        .filter((v) => !isNaN(v));

      if (values.length === 0) return '';

      switch (fn) {
        case 'SUM':
          return values.reduce((a, b) => a + b, 0).toLocaleString();
        case 'AVG':
          return (values.reduce((a, b) => a + b, 0) / values.length).toFixed(2);
        case 'COUNT':
          return String(values.length);
        case 'MIN':
          return String(Math.min(...values));
        case 'MAX':
          return String(Math.max(...values));
        default:
          return '';
      }
    },
    [data]
  );

  if (!data) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-50 dark:bg-gray-900">
        <p className="text-gray-500 dark:text-gray-400">No spreadsheet data</p>
      </div>
    );
  }

  const hasAggregates = data.aggregates && Object.keys(data.aggregates).length > 0;

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      className="flex flex-col h-full bg-white dark:bg-gray-900 overflow-auto outline-none"
      onClick={handleTableBodyClick}
    >
      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10">
            <tr className="bg-gray-100 dark:bg-gray-800">
              {/* Row number column header */}
              <th className="w-10 min-w-[40px] px-1 py-2 text-center font-medium text-gray-400 dark:text-gray-500 border border-gray-200 dark:border-gray-700 select-none">
                #
              </th>
              {data.columns.map((col) => (
                <th
                  key={col.id}
                  onClick={() => handleSort(col.id)}
                  onContextMenu={(e) => handleContextMenu(e, 'column', col.id)}
                  style={col.width ? { width: col.width } : undefined}
                  className="px-3 py-2 text-left font-medium text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700 cursor-pointer select-none hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                >
                  <div className="flex items-center gap-1">
                    <span>{col.name}</span>
                    <span className="text-xs text-gray-400">
                      {sortColumn === col.id
                        ? sortDirection === 'asc'
                          ? ' \u2191'
                          : ' \u2193'
                        : ''}
                    </span>
                  </div>
                  <div className="text-[10px] font-normal text-gray-400 dark:text-gray-500">
                    {col.type}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row, rowIndex) => {
              const isSelected = selectedRows.has(row.id);
              return (
                <tr
                  key={row.id}
                  className={`transition-colors ${
                    isSelected
                      ? 'bg-blue-50 dark:bg-blue-900/30'
                      : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'
                  }`}
                >
                  {/* Row number cell */}
                  <td
                    data-row-number
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRowSelect(row.id, e.shiftKey);
                    }}
                    onContextMenu={(e) => handleContextMenu(e, 'row', row.id)}
                    className={`w-10 min-w-[40px] px-1 py-1.5 text-center text-xs border border-gray-200 dark:border-gray-700 cursor-pointer select-none ${
                      isSelected
                        ? 'bg-blue-100 dark:bg-blue-800/50 text-blue-700 dark:text-blue-300 font-medium'
                        : 'text-gray-400 dark:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700'
                    }`}
                  >
                    {rowIndex + 1}
                  </td>
                  {data.columns.map((col) => {
                    const isEditing =
                      editingCell?.rowId === row.id && editingCell?.colId === col.id;
                    const value = row.cells[col.id];

                    return (
                      <td
                        key={col.id}
                        onClick={() => handleCellClick(row.id, col.id, col)}
                        className={`px-3 py-1.5 border border-gray-200 dark:border-gray-700 cursor-pointer ${
                          col.type === 'number'
                            ? 'text-right font-mono'
                            : ''
                        } ${
                          isEditing
                            ? 'p-0'
                            : 'text-gray-900 dark:text-gray-100'
                        }`}
                      >
                        {isEditing ? (
                          <input
                            ref={inputRef}
                            type={col.type === 'number' ? 'number' : col.type === 'date' ? 'date' : 'text'}
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={handleCellSave}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleCellSave();
                              if (e.key === 'Escape') setEditingCell(null);
                            }}
                            className="w-full h-full px-3 py-1.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 outline-none ring-2 ring-accent-500 dark:ring-accent-400"
                          />
                        ) : col.type === 'boolean' ? (
                          <input
                            type="checkbox"
                            checked={!!value}
                            readOnly
                            className="pointer-events-none"
                          />
                        ) : value != null ? (
                          col.type === 'number' ? (
                            <span>{Number(value).toLocaleString()}</span>
                          ) : (
                            <span>{String(value)}</span>
                          )
                        ) : (
                          <span className="text-gray-300 dark:text-gray-600">&mdash;</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
          {hasAggregates && (
            <tfoot>
              <tr className="bg-gray-50 dark:bg-gray-800 font-medium">
                {/* Empty cell for row number column */}
                <td className="border border-gray-200 dark:border-gray-700" />
                {data.columns.map((col) => {
                  const fn = data.aggregates?.[col.id];
                  return (
                    <td
                      key={col.id}
                      className={`px-3 py-2 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 ${
                        col.type === 'number' ? 'text-right font-mono' : ''
                      }`}
                    >
                      {fn ? (
                        <span>
                          <span className="text-xs text-gray-400 mr-1">{fn}:</span>
                          {computeAggregate(col.id, fn)}
                        </span>
                      ) : null}
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Footer with Add Row / Add Column */}
      <div className="flex-shrink-0 px-3 py-2 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={handleAddRow}
            className="flex items-center gap-1 px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors"
          >
            <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z"
                clipRule="evenodd"
              />
            </svg>
            Add Row
          </button>
          {addingColumn ? (
            <div className="flex items-center gap-1">
              <input
                ref={newColInputRef}
                type="text"
                value={newColumnName}
                onChange={(e) => setNewColumnName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddColumn();
                  if (e.key === 'Escape') {
                    setAddingColumn(false);
                    setNewColumnName('');
                    setNewColumnType('text');
                  }
                }}
                placeholder="Column name"
                className="px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 outline-none focus:ring-1 focus:ring-accent-500 w-32"
              />
              <select
                value={newColumnType}
                onChange={(e) => setNewColumnType(e.target.value as SpreadsheetColumn['type'])}
                className="px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 outline-none focus:ring-1 focus:ring-accent-500"
              >
                <option value="text">text</option>
                <option value="number">number</option>
                <option value="boolean">boolean</option>
                <option value="date">date</option>
              </select>
              <button
                onClick={handleAddColumn}
                disabled={!newColumnName.trim()}
                className="p-1 text-green-600 dark:text-green-400 hover:text-green-800 dark:hover:text-green-300 disabled:opacity-30 disabled:cursor-not-allowed"
                title="Confirm"
              >
                <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              </button>
              <button
                onClick={() => {
                  setAddingColumn(false);
                  setNewColumnName('');
                  setNewColumnType('text');
                }}
                className="p-1 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                title="Cancel"
              >
                <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            </div>
          ) : (
            <button
              onClick={() => setAddingColumn(true)}
              className="flex items-center gap-1 px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors"
            >
              <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                <path
                  fillRule="evenodd"
                  d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z"
                  clipRule="evenodd"
                />
              </svg>
              Add Column
            </button>
          )}
          <span className="ml-auto text-xs text-gray-400 dark:text-gray-500">
            {data.rows.length} row{data.rows.length !== 1 ? 's' : ''} &bull; {data.columns.length} column{data.columns.length !== 1 ? 's' : ''}
            {selectedRows.size > 0 && (
              <> &bull; {selectedRows.size} selected</>
            )}
          </span>
        </div>
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="fixed z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1 min-w-[160px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {contextMenu.type === 'row' && (
            <>
              <button
                onClick={() => handleInsertRowAbove(contextMenu.targetId)}
                className="w-full px-3 py-1.5 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                Insert Row Above
              </button>
              <button
                onClick={() => handleDuplicateRow(contextMenu.targetId)}
                className="w-full px-3 py-1.5 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                Duplicate Row
              </button>
              <button
                onClick={() => handleDeleteRow(contextMenu.targetId)}
                className="w-full px-3 py-1.5 text-left text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
              >
                Delete Row
              </button>
            </>
          )}
          {contextMenu.type === 'column' && (
            <>
              <button
                onClick={() => { handleSort(contextMenu.targetId, 'asc'); setContextMenu(null); }}
                className="w-full px-3 py-1.5 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                Sort Ascending
              </button>
              <button
                onClick={() => { handleSort(contextMenu.targetId, 'desc'); setContextMenu(null); }}
                className="w-full px-3 py-1.5 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                Sort Descending
              </button>
              <div className="my-1 border-t border-gray-200 dark:border-gray-700" />
              <button
                onClick={() => handleDuplicateColumn(contextMenu.targetId)}
                className="w-full px-3 py-1.5 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                Duplicate Column
              </button>
              <button
                onClick={() => handleDeleteColumn(contextMenu.targetId)}
                className="w-full px-3 py-1.5 text-left text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
              >
                Delete Column
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default SpreadsheetEditor;
