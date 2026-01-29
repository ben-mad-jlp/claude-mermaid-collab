import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AliasEditor } from '../AliasEditor';

describe('AliasEditor', () => {
  describe('rendering aliases', () => {
    it('renders list of aliases as AliasChip components', () => {
      const onAdd = vi.fn();
      const onRemove = vi.fn();
      const aliases = ['auth', 'login', 'signin'];

      render(
        <AliasEditor aliases={aliases} onAdd={onAdd} onRemove={onRemove} />
      );

      expect(screen.getByText('auth')).toBeInTheDocument();
      expect(screen.getByText('login')).toBeInTheDocument();
      expect(screen.getByText('signin')).toBeInTheDocument();
    });

    it('renders empty list when aliases array is empty', () => {
      const onAdd = vi.fn();
      const onRemove = vi.fn();

      render(<AliasEditor aliases={[]} onAdd={onAdd} onRemove={onRemove} />);

      const buttons = screen.queryAllByRole('button');
      expect(buttons).toHaveLength(1); // Only Add button
      expect(buttons[0]).toHaveTextContent('+ Add');
    });

    it('renders single alias correctly', () => {
      const onAdd = vi.fn();
      const onRemove = vi.fn();

      render(
        <AliasEditor aliases={['auth']} onAdd={onAdd} onRemove={onRemove} />
      );

      expect(screen.getByText('auth')).toBeInTheDocument();
    });
  });

  describe('removing aliases', () => {
    it('calls onRemove when user clicks remove button on an AliasChip', async () => {
      const onAdd = vi.fn();
      const onRemove = vi.fn();
      const user = userEvent.setup();

      render(
        <AliasEditor aliases={['auth']} onAdd={onAdd} onRemove={onRemove} />
      );

      const removeButton = screen.getByRole('button', { name: '×' });
      await user.click(removeButton);

      expect(onRemove).toHaveBeenCalledWith('auth');
    });

    it('calls onRemove with correct alias when multiple aliases are present', async () => {
      const onAdd = vi.fn();
      const onRemove = vi.fn();
      const user = userEvent.setup();

      render(
        <AliasEditor
          aliases={['auth', 'login', 'signin']}
          onAdd={onAdd}
          onRemove={onRemove}
        />
      );

      const removeButtons = screen.getAllByRole('button');
      await user.click(removeButtons[1]); // Remove 'login'

      expect(onRemove).toHaveBeenCalledWith('login');
    });
  });

  describe('adding aliases', () => {
    it('renders "Add" button', () => {
      const onAdd = vi.fn();
      const onRemove = vi.fn();

      render(
        <AliasEditor aliases={[]} onAdd={onAdd} onRemove={onRemove} />
      );

      expect(screen.getByRole('button', { name: /Add/i })).toBeInTheDocument();
    });

    it('shows input field when Add button is clicked', async () => {
      const onAdd = vi.fn();
      const onRemove = vi.fn();
      const user = userEvent.setup();

      render(
        <AliasEditor aliases={[]} onAdd={onAdd} onRemove={onRemove} />
      );

      const addButton = screen.getByRole('button', { name: /Add/i });
      await user.click(addButton);

      expect(
        screen.getByPlaceholderText(/Enter alias/i)
      ).toBeInTheDocument();
    });

    it('calls onAdd with new alias when Enter key is pressed in input', async () => {
      const onAdd = vi.fn().mockResolvedValue(undefined);
      const onRemove = vi.fn();
      const user = userEvent.setup();

      render(
        <AliasEditor aliases={[]} onAdd={onAdd} onRemove={onRemove} />
      );

      const addButton = screen.getByRole('button', { name: /Add/i });
      await user.click(addButton);

      const input = screen.getByPlaceholderText(
        /Enter alias/i
      ) as HTMLInputElement;
      await user.type(input, 'authentication');
      await user.keyboard('{Enter}');

      await waitFor(() => {
        expect(onAdd).toHaveBeenCalledWith('authentication');
      });
    });

    it('calls onAdd when submit button is clicked', async () => {
      const onAdd = vi.fn().mockResolvedValue(undefined);
      const onRemove = vi.fn();
      const user = userEvent.setup();

      render(
        <AliasEditor aliases={[]} onAdd={onAdd} onRemove={onRemove} />
      );

      const addButton = screen.getByRole('button', { name: /Add/i });
      await user.click(addButton);

      const input = screen.getByPlaceholderText(/Enter alias/i);
      await user.type(input, 'authentication');

      const submitButton = screen.getByRole('button', { name: /Submit/i });
      await user.click(submitButton);

      await waitFor(() => {
        expect(onAdd).toHaveBeenCalledWith('authentication');
      });
    });

    it('clears input and hides input field after successful add', async () => {
      const onAdd = vi.fn().mockResolvedValue(undefined);
      const onRemove = vi.fn();
      const user = userEvent.setup();

      render(
        <AliasEditor aliases={[]} onAdd={onAdd} onRemove={onRemove} />
      );

      const addButton = screen.getByRole('button', { name: /Add/i });
      await user.click(addButton);

      const input = screen.getByPlaceholderText(/Enter alias/i);
      await user.type(input, 'authentication');

      const submitButton = screen.getByRole('button', { name: /Submit/i });
      await user.click(submitButton);

      await waitFor(() => {
        expect(screen.queryByPlaceholderText(/Enter alias/i)).not.toBeInTheDocument();
      });
    });

    it('does not add empty alias', async () => {
      const onAdd = vi.fn();
      const onRemove = vi.fn();
      const user = userEvent.setup();

      render(
        <AliasEditor aliases={[]} onAdd={onAdd} onRemove={onRemove} />
      );

      const addButton = screen.getByRole('button', { name: /Add/i });
      await user.click(addButton);

      const input = screen.getByPlaceholderText(/Enter alias/i);
      await user.type(input, '   '); // Just whitespace

      const submitButton = screen.getByRole('button', { name: /Submit/i });
      await user.click(submitButton);

      expect(onAdd).not.toHaveBeenCalled();
    });

    it('does not add duplicate alias', async () => {
      const onAdd = vi.fn();
      const onRemove = vi.fn();
      const user = userEvent.setup();

      render(
        <AliasEditor
          aliases={['auth']}
          onAdd={onAdd}
          onRemove={onRemove}
        />
      );

      const addButton = screen.getByRole('button', { name: /Add/i });
      await user.click(addButton);

      const input = screen.getByPlaceholderText(/Enter alias/i);
      await user.type(input, 'auth');

      const submitButton = screen.getByRole('button', { name: /Submit/i });
      await user.click(submitButton);

      expect(onAdd).not.toHaveBeenCalled();
    });
  });

  describe('input field behavior', () => {
    it('closes input field when Escape key is pressed', async () => {
      const onAdd = vi.fn();
      const onRemove = vi.fn();
      const user = userEvent.setup();

      render(
        <AliasEditor aliases={[]} onAdd={onAdd} onRemove={onRemove} />
      );

      const addButton = screen.getByRole('button', { name: /Add/i });
      await user.click(addButton);

      const input = screen.getByPlaceholderText(/Enter alias/i);
      await user.type(input, 'auth');
      await user.keyboard('{Escape}');

      await waitFor(() => {
        expect(
          screen.queryByPlaceholderText(/Enter alias/i)
        ).not.toBeInTheDocument();
      });
    });

    it('does not call onAdd when Escape is pressed', async () => {
      const onAdd = vi.fn();
      const onRemove = vi.fn();
      const user = userEvent.setup();

      render(
        <AliasEditor aliases={[]} onAdd={onAdd} onRemove={onRemove} />
      );

      const addButton = screen.getByRole('button', { name: /Add/i });
      await user.click(addButton);

      const input = screen.getByPlaceholderText(/Enter alias/i);
      await user.type(input, 'auth');
      await user.keyboard('{Escape}');

      expect(onAdd).not.toHaveBeenCalled();
    });
  });

  describe('loading states', () => {
    it('disables input and buttons while onAdd is pending', async () => {
      const onAdd = vi.fn(
        () =>
          new Promise((resolve) => {
            setTimeout(resolve, 100);
          })
      );
      const onRemove = vi.fn();
      const user = userEvent.setup();

      render(
        <AliasEditor aliases={['auth']} onAdd={onAdd} onRemove={onRemove} />
      );

      const addButton = screen.getByRole('button', { name: /Add/i });
      await user.click(addButton);

      const input = screen.getByPlaceholderText(/Enter alias/i);
      await user.type(input, 'login');

      const submitButton = screen.getByRole('button', { name: /Submit/i });
      await user.click(submitButton);

      await waitFor(() => {
        expect(input).toBeDisabled();
        expect(submitButton).toBeDisabled();
      });
    });

    it('disables remove buttons while onRemove is pending', async () => {
      const onAdd = vi.fn();
      const onRemove = vi.fn(
        () =>
          new Promise((resolve) => {
            setTimeout(resolve, 100);
          })
      );
      const user = userEvent.setup();

      render(
        <AliasEditor
          aliases={['auth', 'login']}
          onAdd={onAdd}
          onRemove={onRemove}
        />
      );

      const removeButtons = screen.getAllByRole('button');
      await user.click(removeButtons[0]); // Remove 'auth'

      await waitFor(() => {
        expect(removeButtons[0]).toBeDisabled();
      });
    });
  });
});
