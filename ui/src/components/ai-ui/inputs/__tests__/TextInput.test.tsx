import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TextInput } from '../TextInput';
import { describe, it, expect, vi } from 'vitest';

describe('TextInput', () => {
  it('renders with label', () => {
    const mockOnChange = vi.fn();
    render(<TextInput onChange={mockOnChange} label="Name" />);

    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('renders with placeholder', () => {
    const mockOnChange = vi.fn();
    render(<TextInput onChange={mockOnChange} placeholder="Enter text" />);

    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.placeholder).toBe('Enter text');
  });

  it('calls onChange on input change', async () => {
    const mockOnChange = vi.fn();
    const user = userEvent.setup();

    render(<TextInput onChange={mockOnChange} value="" />);

    const input = screen.getByRole('textbox') as HTMLInputElement;
    await user.type(input, 'a');

    expect(mockOnChange).toHaveBeenCalledWith('a');
  });

  it('displays value prop', () => {
    const mockOnChange = vi.fn();
    render(<TextInput onChange={mockOnChange} value="initial" />);

    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.value).toBe('initial');
  });

  it('disables when disabled prop is true', () => {
    const mockOnChange = vi.fn();
    render(<TextInput onChange={mockOnChange} disabled />);

    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.disabled).toBe(true);
  });

  it('shows required indicator', () => {
    const mockOnChange = vi.fn();
    render(<TextInput onChange={mockOnChange} label="Email" required />);

    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.required).toBe(true);
  });

  it('renders required asterisk in label', () => {
    const mockOnChange = vi.fn();
    render(<TextInput onChange={mockOnChange} label="Email" required />);

    const asterisk = screen.getByText('*');
    expect(asterisk).toBeInTheDocument();
  });

  it('changes input type', () => {
    const mockOnChange = vi.fn();
    render(<TextInput onChange={mockOnChange} type="email" />);

    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.type).toBe('email');
  });

  it('validates on blur', async () => {
    const mockOnChange = vi.fn();
    const mockValidation = vi.fn().mockReturnValue('Invalid input');
    const user = userEvent.setup();

    render(<TextInput onChange={mockOnChange} validation={mockValidation} />);

    const input = screen.getByRole('textbox');
    await user.click(input);
    await user.keyboard('test');
    await user.tab();

    await waitFor(() => {
      expect(screen.getByText('Invalid input')).toBeInTheDocument();
    });
  });

  it('shows validation error', async () => {
    const mockOnChange = vi.fn();
    const mockValidation = vi.fn().mockReturnValue('Email is required');

    render(
      <TextInput
        onChange={mockOnChange}
        value=""
        validation={mockValidation}
        label="Email"
      />
    );

    const input = screen.getByRole('textbox');
    fireEvent.blur(input);

    await waitFor(() => {
      expect(screen.getByText('Email is required')).toBeInTheDocument();
    });
  });

  it('clears validation error when valid', async () => {
    const mockOnChange = vi.fn();
    const mockValidation = vi.fn((value) => (value.length > 0 ? null : 'Required'));
    const user = userEvent.setup();

    const { rerender } = render(
      <TextInput
        onChange={mockOnChange}
        value=""
        validation={mockValidation}
      />
    );

    const input = screen.getByRole('textbox');
    fireEvent.blur(input);

    await waitFor(() => {
      expect(screen.getByText('Required')).toBeInTheDocument();
    });

    rerender(
      <TextInput
        onChange={mockOnChange}
        value="valid"
        validation={mockValidation}
      />
    );

    fireEvent.blur(input);

    await waitFor(() => {
      expect(screen.queryByText('Required')).not.toBeInTheDocument();
    });
  });

  it('applies error styling', async () => {
    const mockOnChange = vi.fn();
    const mockValidation = vi.fn().mockReturnValue('Error');

    render(
      <TextInput
        onChange={mockOnChange}
        value="test"
        validation={mockValidation}
      />
    );

    const input = screen.getByRole('textbox');
    fireEvent.blur(input);

    await waitFor(() => {
      expect(input.className).toContain('border-red-500');
      expect(input.className).toContain('focus:ring-red-500');
    });
  });

  it('respects maxLength attribute', () => {
    const mockOnChange = vi.fn();
    render(<TextInput onChange={mockOnChange} maxLength={10} />);

    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.maxLength).toBe(10);
  });

  it('respects minLength attribute', () => {
    const mockOnChange = vi.fn();
    render(<TextInput onChange={mockOnChange} minLength={5} />);

    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.minLength).toBe(5);
  });

  it('respects pattern attribute', () => {
    const mockOnChange = vi.fn();
    const pattern = '^[a-z]+$';
    render(<TextInput onChange={mockOnChange} pattern={pattern} />);

    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.pattern).toBe(pattern);
  });

  it('has correct aria attributes', () => {
    const mockOnChange = vi.fn();
    render(
      <TextInput
        onChange={mockOnChange}
        label="Name"
        ariaLabel="Full name input"
      />
    );

    const input = screen.getByRole('textbox');
    expect(input).toHaveAttribute('aria-label', 'Full name input');
  });

  it('associates label with input', () => {
    const mockOnChange = vi.fn();
    render(<TextInput onChange={mockOnChange} label="Username" />);

    const label = screen.getByText('Username');
    const input = screen.getByRole('textbox');

    expect(label.tagName).toBe('LABEL');
    expect(input).toHaveAttribute('id');
    expect(label).toHaveAttribute('for', input.id);
  });

  it('applies dark mode styles', () => {
    const mockOnChange = vi.fn();
    render(<TextInput onChange={mockOnChange} />);

    const input = screen.getByRole('textbox');
    expect(input.className).toContain('dark:bg-gray-800');
    expect(input.className).toContain('dark:text-white');
    expect(input.className).toContain('dark:border-gray-600');
  });

  it('handles password type', () => {
    const mockOnChange = vi.fn();
    render(<TextInput onChange={mockOnChange} type="password" />);

    const input = screen.getByDisplayValue('') as HTMLInputElement;
    expect(input.type).toBe('password');
  });

  it('handles URL type', () => {
    const mockOnChange = vi.fn();
    render(<TextInput onChange={mockOnChange} type="url" />);

    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.type).toBe('url');
  });

  it('handles number type', () => {
    const mockOnChange = vi.fn();
    render(<TextInput onChange={mockOnChange} type="number" />);

    const input = screen.getByRole('spinbutton') as HTMLInputElement;
    expect(input.type).toBe('number');
  });

  it('calls validation during onChange', async () => {
    const mockOnChange = vi.fn();
    const mockValidation = vi.fn().mockReturnValue(null);
    const user = userEvent.setup();

    render(
      <TextInput
        onChange={mockOnChange}
        validation={mockValidation}
        value=""
      />
    );

    const input = screen.getByRole('textbox') as HTMLInputElement;
    await user.type(input, 'a');

    expect(mockValidation).toHaveBeenCalledWith('a');
  });

  it('preserves value on re-render', () => {
    const mockOnChange = vi.fn();
    const { rerender } = render(
      <TextInput onChange={mockOnChange} value="initial" />
    );

    let input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.value).toBe('initial');

    rerender(
      <TextInput onChange={mockOnChange} value="initial" label="New label" />
    );

    input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.value).toBe('initial');
  });
});
