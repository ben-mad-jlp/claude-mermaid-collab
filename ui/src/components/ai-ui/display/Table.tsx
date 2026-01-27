import React, { useMemo, useState } from 'react';

export interface TableColumn {
  key: string;
  label: string;
  width?: string;
  sortable?: boolean;
}

export interface TableProps {
  columns: TableColumn[];
  rows: Array<Record<string, any>>;
  sortable?: boolean;
  selectable?: boolean;
  paginated?: boolean;
  pageSize?: number;
  rowsPerPageOptions?: number[];
  striped?: boolean;
  bordered?: boolean;
  onRowSelect?: (rowIndex: number, selected: boolean) => void;
  onSort?: (columnKey: string, direction: 'asc' | 'desc') => void;
  ariaLabel?: string;
}

export type SortDirection = 'asc' | 'desc' | null;

export const Table: React.FC<TableProps> = ({
  columns,
  rows,
  sortable = true,
  selectable = false,
  paginated = true,
  pageSize = 10,
  rowsPerPageOptions = [5, 10, 25, 50],
  striped = true,
  bordered = true,
  onRowSelect,
  onSort,
  ariaLabel,
}) => {
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [currentPageSize, setCurrentPageSize] = useState(pageSize);

  // Sort data
  const sortedRows = useMemo(() => {
    if (!rows || !Array.isArray(rows)) return [];
    if (!sortColumn || !sortDirection) return rows;

    const sorted = [...rows].sort((a, b) => {
      const aValue = a[sortColumn];
      const bValue = b[sortColumn];

      if (aValue == null && bValue == null) return 0;
      if (aValue == null) return 1;
      if (bValue == null) return -1;

      if (typeof aValue === 'string' && typeof bValue === 'string') {
        return sortDirection === 'asc'
          ? aValue.localeCompare(bValue)
          : bValue.localeCompare(aValue);
      }

      if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    return sorted;
  }, [rows, sortColumn, sortDirection]);

  // Paginate data
  const paginatedRows = useMemo(() => {
    if (!paginated) return sortedRows;
    const start = (currentPage - 1) * currentPageSize;
    const end = start + currentPageSize;
    return sortedRows.slice(start, end);
  }, [sortedRows, paginated, currentPage, currentPageSize]);

  const totalPages = paginated ? Math.ceil(sortedRows.length / currentPageSize) : 1;

  const handleSort = (columnKey: string) => {
    if (!sortable) return;

    let newDirection: SortDirection = 'asc';
    if (sortColumn === columnKey && sortDirection === 'asc') {
      newDirection = 'desc';
    } else if (sortColumn === columnKey && sortDirection === 'desc') {
      newDirection = null;
    }

    setSortColumn(newDirection ? columnKey : null);
    setSortDirection(newDirection);
    onSort?.(columnKey, newDirection as 'asc' | 'desc');
  };

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newSelected = new Set<number>();
    if (e.target.checked) {
      paginatedRows.forEach((_, index) => {
        const actualIndex = (currentPage - 1) * currentPageSize + index;
        newSelected.add(actualIndex);
      });
    }
    setSelectedRows(newSelected);
  };

  const handleSelectRow = (rowIndex: number) => {
    const newSelected = new Set(selectedRows);
    if (newSelected.has(rowIndex)) {
      newSelected.delete(rowIndex);
    } else {
      newSelected.add(rowIndex);
    }
    setSelectedRows(newSelected);
    onRowSelect?.(rowIndex, newSelected.has(rowIndex));
  };

  const isAllSelected =
    paginatedRows.length > 0 &&
    paginatedRows.every((_, index) => {
      const actualIndex = (currentPage - 1) * currentPageSize + index;
      return selectedRows.has(actualIndex);
    });

  const getSortIcon = (columnKey: string) => {
    if (sortColumn !== columnKey) {
      return (
        <svg className="w-4 h-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v14M5 12l7-7 7 7" />
        </svg>
      );
    }
    if (sortDirection === 'asc') {
      return (
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <path d="M3.707 9.293a1 1 0 00-1.414 1.414l5 5a1 1 0 001.414 0l5-5a1 1 0 00-1.414-1.414L9 12.586V3a1 1 0 00-2 0v9.586L3.707 9.293z" />
        </svg>
      );
    }
    return (
      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
        <path d="M16.293 10.707a1 1 0 00-1.414-1.414L11 14.586V3a1 1 0 00-2 0v11.586l-3.879-3.879a1 1 0 00-1.414 1.414l5 5a1 1 0 001.414 0l5-5z" />
      </svg>
    );
  };

  return (
    <div className="w-full">
      <div className="overflow-x-auto rounded-lg border border-gray-300 dark:border-gray-600">
        <table
          role="table"
          aria-label={ariaLabel}
          className={`w-full text-sm ${
            bordered ? 'border-collapse' : ''
          } bg-white dark:bg-gray-800`}
        >
          <thead className="bg-gray-100 dark:bg-gray-700 border-b border-gray-300 dark:border-gray-600">
            <tr>
              {selectable && (
                <th className="px-4 py-2 w-12 text-left">
                  <input
                    type="checkbox"
                    checked={isAllSelected}
                    onChange={handleSelectAll}
                    aria-label="Select all rows"
                    className="rounded border-gray-300 dark:border-gray-600 dark:bg-gray-700"
                  />
                </th>
              )}
              {(columns || []).map((column) => (
                <th
                  key={column.key}
                  style={{ width: column.width }}
                  className={`px-4 py-3 text-left font-semibold text-gray-900 dark:text-white ${
                    sortable && column.sortable !== false ? 'cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-600' : ''
                  }`}
                  onClick={() => handleSort(column.key)}
                  role="columnheader"
                  aria-sort={
                    sortColumn === column.key
                      ? sortDirection === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : 'none'
                  }
                >
                  <div className="flex items-center gap-2">
                    <span>{column.label}</span>
                    {sortable && column.sortable !== false && getSortIcon(column.key)}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paginatedRows.map((row, index) => {
              const actualIndex = (currentPage - 1) * currentPageSize + index;
              const isSelected = selectedRows.has(actualIndex);
              return (
                <tr
                  key={actualIndex}
                  role="row"
                  className={`
                    border-b border-gray-300 dark:border-gray-600
                    transition-colors duration-200
                    ${striped && index % 2 === 1 ? 'bg-gray-50 dark:bg-gray-700/50' : ''}
                    ${isSelected ? 'bg-blue-50 dark:bg-blue-900/20' : 'hover:bg-gray-100 dark:hover:bg-gray-700/50'}
                  `}
                >
                  {selectable && (
                    <td className="px-4 py-3 text-center">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => handleSelectRow(actualIndex)}
                        aria-label={`Select row ${actualIndex + 1}`}
                        className="rounded border-gray-300 dark:border-gray-600 dark:bg-gray-700"
                      />
                    </td>
                  )}
                  {(columns || []).map((column) => (
                    <td
                      key={`${actualIndex}-${column.key}`}
                      className="px-4 py-3 text-gray-900 dark:text-gray-100"
                    >
                      {row[column.key] !== undefined && row[column.key] !== null
                        ? String(row[column.key])
                        : '-'}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {paginatedRows.length === 0 && (
        <div className="text-center py-8 text-gray-500 dark:text-gray-400">
          No data available
        </div>
      )}

      {paginated && totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 px-4 py-2">
          <div className="flex items-center gap-2">
            <label
              htmlFor="page-size"
              className="text-sm text-gray-700 dark:text-gray-300"
            >
              Rows per page:
            </label>
            <select
              id="page-size"
              value={currentPageSize}
              onChange={(e) => {
                setCurrentPageSize(Number(e.target.value));
                setCurrentPage(1);
              }}
              className="px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
            >
              {rowsPerPageOptions.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </div>

          <div className="text-sm text-gray-700 dark:text-gray-300">
            Page {currentPage} of {totalPages}
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
              disabled={currentPage === 1}
              className="px-3 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100 dark:hover:bg-gray-700"
              aria-label="Previous page"
            >
              Previous
            </button>
            <button
              onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
              disabled={currentPage === totalPages}
              className="px-3 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100 dark:hover:bg-gray-700"
              aria-label="Next page"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

Table.displayName = 'Table';
