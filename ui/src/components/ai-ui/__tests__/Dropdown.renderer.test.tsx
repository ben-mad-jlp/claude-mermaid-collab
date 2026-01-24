import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AIUIRenderer } from '../renderer';
import type { UIComponent } from '@/types/ai-ui';

describe('Dropdown with AIUIRenderer', () => {
  it('renders Dropdown component through the renderer', () => {
    const dropdownComponent: UIComponent = {
      type: 'Dropdown',
      props: {
        name: 'test-dropdown',
        label: 'Select an option',
        options: [
          { value: 'opt1', label: 'Option 1' },
          { value: 'opt2', label: 'Option 2' },
          { value: 'opt3', label: 'Option 3' },
        ],
        placeholder: 'Choose one...',
      },
    };

    render(<AIUIRenderer component={dropdownComponent} />);

    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select).toBeInTheDocument();
    expect(select.name).toBe('test-dropdown');
    expect(screen.getByText('Select an option')).toBeInTheDocument();
  });

  it('collects form data from Dropdown through renderer', () => {
    let collectedData: any = null;
    const dropdownComponent: UIComponent = {
      type: 'Dropdown',
      props: {
        name: 'country',
        options: [
          { value: 'us', label: 'United States' },
          { value: 'uk', label: 'United Kingdom' },
        ],
      },
      actions: [
        {
          id: 'submit',
          label: 'Submit',
          primary: true,
        },
      ],
    };

    const handleAction = (actionId: string, payload?: any) => {
      collectedData = payload?.data;
    };

    render(<AIUIRenderer component={dropdownComponent} onAction={handleAction} />);

    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('');

    // Change the value
    select.value = 'us';
    select.dispatchEvent(new Event('change', { bubbles: true }));

    const button = screen.getByRole('button', { name: 'Submit' });
    button.click();

    expect(collectedData).toBeDefined();
    expect(collectedData.country).toBe('us');
  });

  it('renders Dropdown with default value', () => {
    const dropdownComponent: UIComponent = {
      type: 'Dropdown',
      props: {
        name: 'status',
        options: [
          { value: 'active', label: 'Active' },
          { value: 'inactive', label: 'Inactive' },
        ],
        defaultValue: 'active',
      },
    };

    render(<AIUIRenderer component={dropdownComponent} />);

    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('active');
  });

  it('renders disabled Dropdown', () => {
    const dropdownComponent: UIComponent = {
      type: 'Dropdown',
      props: {
        name: 'disabled-dropdown',
        options: [{ value: 'opt1', label: 'Option 1' }],
        disabled: true,
      },
    };

    render(<AIUIRenderer component={dropdownComponent} />);

    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.disabled).toBe(true);
  });
});
