import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Checklist, ChecklistItem } from '../Checklist';
import { describe, it, expect, vi } from 'vitest';

describe('Checklist Component', () => {
  const mockItems: ChecklistItem[] = [
    {
      id: 'item-1',
      label: 'First Task',
      completed: false,
      required: true,
    },
    {
      id: 'item-2',
      label: 'Second Task',
      completed: false,
      required: false,
      subItems: [
        {
          id: 'sub-1',
          label: 'Sub Task 1',
          completed: false,
        },
        {
          id: 'sub-2',
          label: 'Sub Task 2',
          completed: false,
        },
      ],
    },
    {
      id: 'item-3',
      label: 'Third Task',
      completed: false,
    },
  ];

  it('should render all items', () => {
    render(<Checklist items={mockItems} />);

    expect(screen.getByText('First Task')).toBeInTheDocument();
    expect(screen.getByText('Second Task')).toBeInTheDocument();
    expect(screen.getByText('Third Task')).toBeInTheDocument();
  });

  it('should display progress indicator when showProgress is true', () => {
    render(<Checklist items={mockItems} showProgress={true} />);

    expect(screen.getByText(/Progress/)).toBeInTheDocument();
    expect(screen.getByText('0/3')).toBeInTheDocument();
  });

  it('should not display progress indicator when showProgress is false', () => {
    render(<Checklist items={mockItems} showProgress={false} />);

    const progressElements = screen.queryAllByText(/Progress/);
    expect(progressElements).toHaveLength(0);
  });

  it('should mark item as completed when checkbox is clicked', async () => {
    const user = userEvent.setup();
    const onItemChange = vi.fn();
    render(<Checklist items={mockItems} allowCheck={true} onItemChange={onItemChange} />);

    const checkboxes = screen.getAllByRole('button', { name: /toggle/i });
    await user.click(checkboxes[0]);

    expect(onItemChange).toHaveBeenCalledWith('item-1', true);
  });

  it('should show Required badge for required items', () => {
    render(<Checklist items={mockItems} />);

    const requiredBadges = screen.getAllByText('Required');
    expect(requiredBadges.length).toBeGreaterThan(0);
  });

  it('should expand and collapse items with sub-items', async () => {
    const user = userEvent.setup();
    render(<Checklist items={mockItems} />);

    // Item with sub-items should be expandable
    const expandButton = screen.getByLabelText(/expand second task/i);
    await user.click(expandButton);

    // Sub-items should be visible
    expect(screen.getByText('Sub Task 1')).toBeInTheDocument();
    expect(screen.getByText('Sub Task 2')).toBeInTheDocument();
  });

  it('should collapse sub-items when expand button is clicked again', async () => {
    const user = userEvent.setup();
    render(<Checklist items={mockItems} />);

    // First expand
    const expandButton = screen.getByLabelText(/expand second task/i);
    await user.click(expandButton);
    expect(screen.getByText('Sub Task 1')).toBeInTheDocument();

    // Then collapse
    await user.click(expandButton);
    const subTasks = screen.queryAllByText('Sub Task');
    expect(subTasks).toHaveLength(0);
  });

  it('should call onSubItemChange when sub-item is toggled', async () => {
    const user = userEvent.setup();
    const onSubItemChange = vi.fn();
    render(
      <Checklist
        items={mockItems}
        allowCheck={true}
        onSubItemChange={onSubItemChange}
      />
    );

    // Expand the item with sub-items
    const expandButton = screen.getByLabelText(/expand second task/i);
    await user.click(expandButton);

    // Click sub-item checkbox
    const subCheckboxes = screen.getAllByRole('button', { name: /toggle sub task/i });
    await user.click(subCheckboxes[0]);

    expect(onSubItemChange).toHaveBeenCalledWith('item-2', 'sub-1', true);
  });

  it('should update progress when items are checked', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <Checklist items={mockItems} showProgress={true} allowCheck={true} />
    );

    expect(screen.getByText('0/3')).toBeInTheDocument();

    const checkboxes = screen.getAllByRole('button', { name: /toggle/i });
    await user.click(checkboxes[0]);

    rerender(
      <Checklist
        items={[{ ...mockItems[0], completed: true }, ...mockItems.slice(1)]}
        showProgress={true}
        allowCheck={true}
      />
    );

    expect(screen.getByText('1/3')).toBeInTheDocument();
  });

  it('should handle allRequired flag', () => {
    const items: ChecklistItem[] = [
      { id: '1', label: 'Task 1', completed: false },
      { id: '2', label: 'Task 2', completed: false },
    ];

    render(<Checklist items={items} allRequired={true} />);

    const requiredBadges = screen.getAllByText('Required');
    expect(requiredBadges).toHaveLength(2);
  });

  it('should not allow checking when allowCheck is false', async () => {
    const user = userEvent.setup();
    const onItemChange = vi.fn();
    render(
      <Checklist
        items={mockItems}
        allowCheck={false}
        onItemChange={onItemChange}
      />
    );

    const checkboxes = screen.queryAllByRole('button', { name: /toggle/i });
    expect(checkboxes).toHaveLength(0);
  });

  it('should display completed items with strikethrough', async () => {
    const user = userEvent.setup();
    const completedItems: ChecklistItem[] = [
      { ...mockItems[0], completed: true },
      ...mockItems.slice(1),
    ];

    const { container } = render(
      <Checklist items={completedItems} allowCheck={true} />
    );

    const strikethroughElements = container.querySelectorAll('.line-through');
    expect(strikethroughElements.length).toBeGreaterThan(0);
  });

  it('should calculate required items completion', () => {
    const itemsWithRequired: ChecklistItem[] = [
      { id: '1', label: 'Required 1', required: true, completed: true },
      { id: '2', label: 'Optional 1', required: false, completed: false },
      { id: '3', label: 'Required 2', required: true, completed: false },
    ];

    render(
      <Checklist items={itemsWithRequired} showProgress={true} />
    );

    expect(screen.getByText(/Required items:/)).toBeInTheDocument();
    expect(screen.getByText(/1\/2/)).toBeInTheDocument();
  });

  it('should render sub-items inside expanded section', async () => {
    const user = userEvent.setup();
    render(<Checklist items={mockItems} />);

    const expandButton = screen.getByLabelText(/expand second task/i);
    await user.click(expandButton);

    const subItem1 = screen.getByText('Sub Task 1');
    expect(subItem1).toBeInTheDocument();
    // Verify sub-items are in a nested div with ml-8 class
    const parentDiv = subItem1.closest('.ml-8');
    expect(parentDiv).toBeInTheDocument();
  });
});
