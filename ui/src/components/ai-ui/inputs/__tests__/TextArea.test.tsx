import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TextArea } from '../TextArea';
import { describe, it, expect, vi } from 'vitest';

describe('TextArea', () => {
  it('renders with label', () => {
    const mockOnChange = vi.fn();
    render(<TextArea onChange={mockOnChange} label="Comments" />);

    expect(screen.getByText('Comments')).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('renders with placeholder', () => {
    const mockOnChange = vi.fn();
    render(<TextArea onChange={mockOnChange} placeholder="Enter comments" />);

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(textarea.placeholder).toBe('Enter comments');
  });

  it('calls onChange on input change', async () => {
    const mockOnChange = vi.fn();
    const user = userEvent.setup();

    render(<TextArea onChange={mockOnChange} value="" />);

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    await user.type(textarea, 'a');

    expect(mockOnChange).toHaveBeenCalledWith('a');
  });

  it('displays value prop', () => {
    const mockOnChange = vi.fn();
    render(<TextArea onChange={mockOnChange} value="initial text" />);

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(textarea.value).toBe('initial text');
  });

  it('disables when disabled prop is true', () => {
    const mockOnChange = vi.fn();
    render(<TextArea onChange={mockOnChange} disabled />);

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(textarea.disabled).toBe(true);
  });

  it('shows required indicator', () => {
    const mockOnChange = vi.fn();
    render(<TextArea onChange={mockOnChange} label="Description" required />);

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(textarea.required).toBe(true);
  });

  it('renders required asterisk in label', () => {
    const mockOnChange = vi.fn();
    render(<TextArea onChange={mockOnChange} label="Description" required />);

    const asterisk = screen.getByText('*');
    expect(asterisk).toBeInTheDocument();
  });

  it('sets rows attribute', () => {
    const mockOnChange = vi.fn();
    render(<TextArea onChange={mockOnChange} rows={8} />);

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(textarea.rows).toBe(8);
  });

  it('sets default rows to 4', () => {
    const mockOnChange = vi.fn();
    render(<TextArea onChange={mockOnChange} />);

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(textarea.rows).toBe(4);
  });

  it('validates on blur', async () => {
    const mockOnChange = vi.fn();
    const mockValidation = vi.fn().mockReturnValue('Too short');
    const user = userEvent.setup();

    render(<TextArea onChange={mockOnChange} validation={mockValidation} />);

    const textarea = screen.getByRole('textbox');
    await user.click(textarea);
    await user.keyboard('test');
    await user.tab();

    await waitFor(() => {
      expect(screen.getByText('Too short')).toBeInTheDocument();
    });
  });

  it('shows validation error', async () => {
    const mockOnChange = vi.fn();
    const mockValidation = vi.fn().mockReturnValue('Comment required');

    render(
      <TextArea
        onChange={mockOnChange}
        value=""
        validation={mockValidation}
        label="Feedback"
      />
    );

    const textarea = screen.getByRole('textbox');
    fireEvent.blur(textarea);

    await waitFor(() => {
      expect(screen.getByText('Comment required')).toBeInTheDocument();
    });
  });

  it('applies error styling', async () => {
    const mockOnChange = vi.fn();
    const mockValidation = vi.fn().mockReturnValue('Error');

    render(
      <TextArea
        onChange={mockOnChange}
        value="test"
        validation={mockValidation}
      />
    );

    const textarea = screen.getByRole('textbox');
    fireEvent.blur(textarea);

    await waitFor(() => {
      expect(textarea.className).toContain('border-red-500');
      expect(textarea.className).toContain('focus:ring-red-500');
    });
  });

  it('respects maxLength attribute', () => {
    const mockOnChange = vi.fn();
    render(<TextArea onChange={mockOnChange} maxLength={100} />);

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(textarea.maxLength).toBe(100);
  });

  it('respects minLength attribute', () => {
    const mockOnChange = vi.fn();
    render(<TextArea onChange={mockOnChange} minLength={10} />);

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(textarea.minLength).toBe(10);
  });

  it('displays character count when maxLength is set', () => {
    const mockOnChange = vi.fn();
    render(<TextArea onChange={mockOnChange} value="test" maxLength={100} />);

    expect(screen.getByText('4/100')).toBeInTheDocument();
  });

  it('updates character count as text is entered', async () => {
    const mockOnChange = vi.fn();
    const user = userEvent.setup();

    const { rerender } = render(
      <TextArea onChange={mockOnChange} value="" maxLength={50} />
    );

    expect(screen.getByText('0/50')).toBeInTheDocument();

    const textarea = screen.getByRole('textbox');
    await user.type(textarea, 'hello');

    rerender(
      <TextArea onChange={mockOnChange} value="hello" maxLength={50} />
    );

    expect(screen.getByText('5/50')).toBeInTheDocument();
  });

  it('has correct aria attributes', () => {
    const mockOnChange = vi.fn();
    render(
      <TextArea
        onChange={mockOnChange}
        label="Feedback"
        ariaLabel="User feedback area"
      />
    );

    const textarea = screen.getByRole('textbox');
    expect(textarea).toHaveAttribute('aria-label', 'User feedback area');
  });

  it('associates label with textarea', () => {
    const mockOnChange = vi.fn();
    render(<TextArea onChange={mockOnChange} label="Comments" />);

    const label = screen.getByText('Comments');
    const textarea = screen.getByRole('textbox');

    expect(label.tagName).toBe('LABEL');
    expect(textarea).toHaveAttribute('id');
    expect(label).toHaveAttribute('for', textarea.id);
  });

  it('applies dark mode styles', () => {
    const mockOnChange = vi.fn();
    render(<TextArea onChange={mockOnChange} />);

    const textarea = screen.getByRole('textbox');
    expect(textarea.className).toContain('dark:bg-gray-800');
    expect(textarea.className).toContain('dark:text-white');
    expect(textarea.className).toContain('dark:border-gray-600');
  });

  it('prevents textarea resize', () => {
    const mockOnChange = vi.fn();
    render(<TextArea onChange={mockOnChange} />);

    const textarea = screen.getByRole('textbox');
    expect(textarea.className).toContain('resize-none');
  });

  it('calls validation during onChange', async () => {
    const mockOnChange = vi.fn();
    const mockValidation = vi.fn().mockReturnValue(null);
    const user = userEvent.setup();

    render(
      <TextArea
        onChange={mockOnChange}
        validation={mockValidation}
        value=""
      />
    );

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    await user.type(textarea, 'a');

    expect(mockValidation).toHaveBeenCalledWith('a');
  });

  it('clears validation error when valid', async () => {
    const mockOnChange = vi.fn();
    const mockValidation = vi.fn((value) => (value.length > 0 ? null : 'Required'));

    const { rerender } = render(
      <TextArea
        onChange={mockOnChange}
        value=""
        validation={mockValidation}
      />
    );

    const textarea = screen.getByRole('textbox');
    fireEvent.blur(textarea);

    await waitFor(() => {
      expect(screen.getByText('Required')).toBeInTheDocument();
    });

    rerender(
      <TextArea
        onChange={mockOnChange}
        value="valid text"
        validation={mockValidation}
      />
    );

    fireEvent.blur(textarea);

    await waitFor(() => {
      expect(screen.queryByText('Required')).not.toBeInTheDocument();
    });
  });

  it('preserves value on re-render', () => {
    const mockOnChange = vi.fn();
    const { rerender } = render(
      <TextArea onChange={mockOnChange} value="initial" />
    );

    let textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(textarea.value).toBe('initial');

    rerender(
      <TextArea onChange={mockOnChange} value="initial" label="New label" />
    );

    textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(textarea.value).toBe('initial');
  });

  it('handles multi-line input', async () => {
    const mockOnChange = vi.fn();
    const user = userEvent.setup();

    render(<TextArea onChange={mockOnChange} value="" />);

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    await user.type(textarea, 'a{Enter}b');

    expect(mockOnChange).toHaveBeenCalled();
  });
});
