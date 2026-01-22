import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { expect, describe, it, vi } from 'vitest';
import { Table } from '../Table';

describe('Table Component', () => {
  const mockColumns = [
    { key: 'id', label: 'ID', sortable: true },
    { key: 'name', label: 'Name', sortable: true },
    { key: 'email', label: 'Email', sortable: false },
    { key: 'status', label: 'Status' },
  ];

  const mockRows = [
    { id: 1, name: 'Alice', email: 'alice@example.com', status: 'Active' },
    { id: 2, name: 'Bob', email: 'bob@example.com', status: 'Inactive' },
    { id: 3, name: 'Charlie', email: 'charlie@example.com', status: 'Active' },
    { id: 4, name: 'Diana', email: 'diana@example.com', status: 'Pending' },
    { id: 5, name: 'Eve', email: 'eve@example.com', status: 'Active' },
  ];

  it('renders table with columns and rows', () => {
    render(<Table columns={mockColumns} rows={mockRows} />);

    // Check headers
    expect(screen.getByText('ID')).toBeInTheDocument();
    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByText('Email')).toBeInTheDocument();
    expect(screen.getByText('Status')).toBeInTheDocument();

    // Check data
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('bob@example.com')).toBeInTheDocument();
  });

  it('displays empty state when no data', () => {
    render(<Table columns={mockColumns} rows={[]} />);
    expect(screen.getByText('No data available')).toBeInTheDocument();
  });

  it('supports sorting on sortable columns', () => {
    const onSort = vi.fn();
    render(
      <Table
        columns={mockColumns}
        rows={mockRows}
        sortable={true}
        onSort={onSort}
      />
    );

    const nameHeader = screen.getByText('Name').closest('th');
    fireEvent.click(nameHeader!);

    expect(onSort).toHaveBeenCalledWith('name', 'asc');
  });

  it('does not allow sorting on non-sortable columns', () => {
    render(
      <Table
        columns={mockColumns}
        rows={mockRows}
        sortable={true}
      />
    );

    const emailHeader = screen.getByText('Email').closest('th');
    // Non-sortable columns don't have cursor-pointer class
    expect(emailHeader).not.toHaveClass('cursor-pointer');
  });

  it('supports row selection', () => {
    const onRowSelect = vi.fn();
    render(
      <Table
        columns={mockColumns}
        rows={mockRows}
        selectable={true}
        onRowSelect={onRowSelect}
      />
    );

    const firstRowCheckbox = screen.getAllByRole('checkbox')[1]; // Skip header checkbox
    fireEvent.click(firstRowCheckbox);

    expect(onRowSelect).toHaveBeenCalled();
  });

  it('supports select all functionality', () => {
    render(
      <Table
        columns={mockColumns}
        rows={mockRows.slice(0, 2)}
        selectable={true}
        paginated={false}
      />
    );

    const selectAllCheckbox = screen.getByLabelText('Select all rows');
    fireEvent.click(selectAllCheckbox);

    expect(selectAllCheckbox).toBeChecked();
  });

  it('supports pagination', () => {
    render(
      <Table
        columns={mockColumns}
        rows={mockRows}
        paginated={true}
        pageSize={2}
      />
    );

    // Should only show 2 rows per page
    const rows = screen.getAllByRole('row');
    expect(rows.length).toBeLessThanOrEqual(3); // 1 header + 2 data rows

    // Check pagination controls
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument();
  });

  it('handles page size change', () => {
    render(
      <Table
        columns={mockColumns}
        rows={mockRows}
        paginated={true}
        pageSize={2}
        rowsPerPageOptions={[2, 5, 10]}
      />
    );

    const pageSizeSelect = screen.getByDisplayValue('2');
    fireEvent.change(pageSizeSelect, { target: { value: '5' } });

    // When pageSize is 5 and there are 5 rows, all data shows on one page
    // Pagination controls hide when there's only 1 page
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Eve')).toBeInTheDocument();
  });

  it('navigates between pages', () => {
    render(
      <Table
        columns={mockColumns}
        rows={mockRows}
        paginated={true}
        pageSize={2}
      />
    );

    const nextButton = screen.getByLabelText('Next page');
    fireEvent.click(nextButton);

    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument();
  });

  it('disables navigation at boundaries', () => {
    render(
      <Table
        columns={mockColumns}
        rows={mockRows}
        paginated={true}
        pageSize={2}
      />
    );

    const prevButton = screen.getByLabelText('Previous page');
    expect(prevButton).toBeDisabled();

    const nextButton = screen.getByLabelText('Next page');
    fireEvent.click(nextButton);
    fireEvent.click(nextButton);

    expect(nextButton).toBeDisabled();
  });

  it('applies striped styling when enabled', () => {
    const { container } = render(
      <Table
        columns={mockColumns}
        rows={mockRows.slice(0, 2)}
        striped={true}
        paginated={false}
      />
    );

    const rows = container.querySelectorAll('tbody tr');
    expect(rows[1]).toHaveClass('bg-gray-50', 'dark:bg-gray-700/50');
  });

  it('handles null and undefined values gracefully', () => {
    const rowsWithNulls = [
      { id: 1, name: 'Alice', email: null, status: undefined },
    ];

    render(
      <Table
        columns={mockColumns}
        rows={rowsWithNulls}
        paginated={false}
      />
    );

    const cells = screen.getAllByText('-');
    expect(cells.length).toBe(2); // For null and undefined values
  });

  it('provides accessibility attributes', () => {
    render(
      <Table
        columns={mockColumns}
        rows={mockRows.slice(0, 1)}
        paginated={false}
        ariaLabel="User data table"
      />
    );

    const table = screen.getByRole('table', { name: 'User data table' });
    expect(table).toBeInTheDocument();

    const headers = screen.getAllByRole('columnheader');
    expect(headers.length).toBe(4);
  });
});
