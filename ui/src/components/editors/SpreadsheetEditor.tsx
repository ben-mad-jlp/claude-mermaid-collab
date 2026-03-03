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
  const inputRef = useRef<HTMLInputElement>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    if (editingCell && inputRef.current) {
      inputRef.current.focus();
    }
  }, [editingCell]);

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

  const handleSort = useCallback((colId: string) => {
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
        // Toggle boolean directly
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
    <div className="flex flex-col h-full bg-white dark:bg-gray-900 overflow-auto">
      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10">
            <tr className="bg-gray-100 dark:bg-gray-800">
              {data.columns.map((col) => (
                <th
                  key={col.id}
                  onClick={() => handleSort(col.id)}
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
            {sortedRows.map((row) => (
              <tr
                key={row.id}
                className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
              >
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
            ))}
          </tbody>
          {hasAggregates && (
            <tfoot>
              <tr className="bg-gray-50 dark:bg-gray-800 font-medium">
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

      {/* Footer with Add Row button */}
      <div className="flex-shrink-0 px-3 py-2 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
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
        <span className="ml-3 text-xs text-gray-400 dark:text-gray-500">
          {data.rows.length} row{data.rows.length !== 1 ? 's' : ''} &bull; {data.columns.length} column{data.columns.length !== 1 ? 's' : ''}
        </span>
      </div>
    </div>
  );
};

export default SpreadsheetEditor;
