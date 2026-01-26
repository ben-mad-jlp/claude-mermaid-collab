import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  SmachPropertiesPane,
  isSmachContent,
  parseSmachState,
  SmachState,
} from '../SmachPropertiesPane';

describe('SmachPropertiesPane', () => {
  const mockState: SmachState = {
    name: 'IDLE',
    description: 'Initial idle state',
    transitions: [
      { outcome: 'success', target: 'RUNNING' },
      { outcome: 'failure', target: 'ERROR' },
    ],
  };

  const defaultProps = {
    state: mockState,
    onEditDescription: vi.fn(),
    onEditTransition: vi.fn(),
    onAddTransition: vi.fn(),
    onRemoveTransition: vi.fn(),
    onClose: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('rendering', () => {
    it('should render null when state is null', () => {
      const { container } = render(
        <SmachPropertiesPane {...defaultProps} state={null} />
      );
      expect(container.firstChild).toBeNull();
    });

    it('should render the state name in header', () => {
      render(<SmachPropertiesPane {...defaultProps} />);
      expect(screen.getByText('IDLE')).toBeDefined();
    });

    it('should render close button', () => {
      render(<SmachPropertiesPane {...defaultProps} />);
      const closeButtons = screen.getAllByRole('button');
      const closeButton = closeButtons.find((btn) => btn.textContent === '✕');
      expect(closeButton).toBeDefined();
    });

    it('should render description section', () => {
      render(<SmachPropertiesPane {...defaultProps} />);
      expect(screen.getByText('Description')).toBeDefined();
      expect(screen.getByText('Initial idle state')).toBeDefined();
    });

    it('should render "(none)" when description is empty', () => {
      const stateWithoutDesc: SmachState = {
        name: 'TEST',
        description: '',
        transitions: [],
      };
      render(<SmachPropertiesPane {...defaultProps} state={stateWithoutDesc} />);
      expect(screen.getByText('(none)')).toBeDefined();
    });

    it('should render transitions section', () => {
      render(<SmachPropertiesPane {...defaultProps} />);
      expect(screen.getByText('Transitions')).toBeDefined();
      expect(screen.getByText('success')).toBeDefined();
      expect(screen.getByText('RUNNING')).toBeDefined();
      expect(screen.getByText('failure')).toBeDefined();
      expect(screen.getByText('ERROR')).toBeDefined();
    });

    it('should render arrow between outcome and target', () => {
      render(<SmachPropertiesPane {...defaultProps} />);
      const arrows = screen.getAllByText('→');
      expect(arrows.length).toBe(2);
    });

    it('should render add transition button', () => {
      render(<SmachPropertiesPane {...defaultProps} />);
      expect(screen.getByText('+ Add Transition')).toBeDefined();
    });

    it('should apply custom className', () => {
      const { container } = render(
        <SmachPropertiesPane {...defaultProps} className="custom-class" />
      );
      expect(container.firstChild).toHaveClass('custom-class');
    });
  });

  describe('close functionality', () => {
    it('should call onClose when close button is clicked', () => {
      render(<SmachPropertiesPane {...defaultProps} />);
      const closeButtons = screen.getAllByRole('button');
      const closeButton = closeButtons.find((btn) => btn.textContent === '✕');
      fireEvent.click(closeButton!);
      expect(defaultProps.onClose).toHaveBeenCalledOnce();
    });
  });

  describe('description editing', () => {
    it('should show Edit button when not editing', () => {
      render(<SmachPropertiesPane {...defaultProps} />);
      expect(screen.getByText('Edit')).toBeDefined();
    });

    it('should switch to edit mode when Edit button is clicked', () => {
      render(<SmachPropertiesPane {...defaultProps} />);
      fireEvent.click(screen.getByText('Edit'));
      expect(screen.getByRole('textbox')).toBeDefined();
    });

    it('should show Save and Cancel buttons in edit mode', () => {
      render(<SmachPropertiesPane {...defaultProps} />);
      fireEvent.click(screen.getByText('Edit'));
      expect(screen.getByText('Save')).toBeDefined();
      expect(screen.getByText('Cancel')).toBeDefined();
    });

    it('should populate textarea with current description', () => {
      render(<SmachPropertiesPane {...defaultProps} />);
      fireEvent.click(screen.getByText('Edit'));
      const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
      expect(textarea.value).toBe('Initial idle state');
    });

    it('should call onEditDescription when Save is clicked', () => {
      render(<SmachPropertiesPane {...defaultProps} />);
      fireEvent.click(screen.getByText('Edit'));
      const textarea = screen.getByRole('textbox');
      fireEvent.change(textarea, { target: { value: 'Updated description' } });
      fireEvent.click(screen.getByText('Save'));
      expect(defaultProps.onEditDescription).toHaveBeenCalledWith('Updated description');
    });

    it('should exit edit mode after saving', () => {
      render(<SmachPropertiesPane {...defaultProps} />);
      fireEvent.click(screen.getByText('Edit'));
      fireEvent.click(screen.getByText('Save'));
      expect(screen.queryByRole('textbox')).toBeNull();
      expect(screen.getByText('Edit')).toBeDefined();
    });

    it('should exit edit mode when Cancel is clicked', () => {
      render(<SmachPropertiesPane {...defaultProps} />);
      fireEvent.click(screen.getByText('Edit'));
      fireEvent.click(screen.getByText('Cancel'));
      expect(screen.queryByRole('textbox')).toBeNull();
      expect(screen.getByText('Edit')).toBeDefined();
    });

    it('should not call onEditDescription when Cancel is clicked', () => {
      render(<SmachPropertiesPane {...defaultProps} />);
      fireEvent.click(screen.getByText('Edit'));
      fireEvent.change(screen.getByRole('textbox'), {
        target: { value: 'Changed' },
      });
      fireEvent.click(screen.getByText('Cancel'));
      expect(defaultProps.onEditDescription).not.toHaveBeenCalled();
    });
  });

  describe('transitions', () => {
    it('should call onAddTransition when add button is clicked', () => {
      render(<SmachPropertiesPane {...defaultProps} />);
      fireEvent.click(screen.getByText('+ Add Transition'));
      expect(defaultProps.onAddTransition).toHaveBeenCalledOnce();
    });

    it('should call onRemoveTransition with correct index when remove button is clicked', () => {
      render(<SmachPropertiesPane {...defaultProps} />);
      // Get all remove buttons (the ones with ✕ that are NOT the close button)
      const allButtons = screen.getAllByRole('button');
      const removeButtons = allButtons.filter(
        (btn) => btn.textContent === '✕' && btn.classList.contains('text-red-500')
      );
      expect(removeButtons.length).toBe(2);

      fireEvent.click(removeButtons[0]);
      expect(defaultProps.onRemoveTransition).toHaveBeenCalledWith(0);

      fireEvent.click(removeButtons[1]);
      expect(defaultProps.onRemoveTransition).toHaveBeenCalledWith(1);
    });

    it('should render empty transitions list gracefully', () => {
      const stateNoTransitions: SmachState = {
        name: 'EMPTY',
        description: 'No transitions',
        transitions: [],
      };
      render(<SmachPropertiesPane {...defaultProps} state={stateNoTransitions} />);
      expect(screen.getByText('Transitions')).toBeDefined();
      expect(screen.getByText('+ Add Transition')).toBeDefined();
    });
  });

  describe('state changes', () => {
    it('should reset editing state when state changes', () => {
      const { rerender } = render(<SmachPropertiesPane {...defaultProps} />);
      fireEvent.click(screen.getByText('Edit'));
      expect(screen.getByRole('textbox')).toBeDefined();

      const newState: SmachState = {
        name: 'RUNNING',
        description: 'Running state',
        transitions: [],
      };
      rerender(<SmachPropertiesPane {...defaultProps} state={newState} />);

      // Should exit edit mode and show the new state
      expect(screen.queryByRole('textbox')).toBeNull();
      expect(screen.getByText('RUNNING')).toBeDefined();
    });
  });
});

describe('isSmachContent', () => {
  it('should return true for valid SMACH content', () => {
    const content = `smach_diagram:
  states:
    IDLE:
      description: Initial state`;
    expect(isSmachContent(content)).toBe(true);
  });

  it('should return true with leading whitespace', () => {
    const content = `  smach_diagram:
  states: {}`;
    expect(isSmachContent(content)).toBe(true);
  });

  it('should return false for non-SMACH content', () => {
    const content = `flowchart TD
  A --> B`;
    expect(isSmachContent(content)).toBe(false);
  });

  it('should return false for empty content', () => {
    expect(isSmachContent('')).toBe(false);
  });

  it('should return false when smach_diagram is in comment', () => {
    const content = `# This is not smach_diagram:
flowchart TD`;
    expect(isSmachContent(content)).toBe(false);
  });

  it('should handle multiline content', () => {
    const content = `# Header comment
some other yaml

smach_diagram:
  version: 1`;
    expect(isSmachContent(content)).toBe(true);
  });
});

describe('parseSmachState', () => {
  const validContent = `smach_diagram:
  states:
    IDLE:
      description: Initial idle state
      transitions:
        start: RUNNING
        error: ERROR
    RUNNING:
      description: Active running state
      transitions:
        done: COMPLETE
        fail: ERROR
    ERROR:
      description: Error state
      transitions: {}
    COMPLETE:
      description: Completion state`;

  it('should parse a valid state with description and transitions', () => {
    const result = parseSmachState(validContent, 'IDLE');
    expect(result).not.toBeNull();
    expect(result!.name).toBe('IDLE');
    expect(result!.description).toBe('Initial idle state');
    expect(result!.transitions).toHaveLength(2);
    expect(result!.transitions[0]).toEqual({ outcome: 'start', target: 'RUNNING' });
    expect(result!.transitions[1]).toEqual({ outcome: 'error', target: 'ERROR' });
  });

  it('should parse a state with no transitions', () => {
    const result = parseSmachState(validContent, 'ERROR');
    expect(result).not.toBeNull();
    expect(result!.name).toBe('ERROR');
    expect(result!.transitions).toHaveLength(0);
  });

  it('should return null for non-existent state', () => {
    const result = parseSmachState(validContent, 'NONEXISTENT');
    expect(result).toBeNull();
  });

  it('should return null for invalid YAML', () => {
    const invalidContent = `smach_diagram:
  states:
    IDLE
      broken: yaml: structure`;
    const result = parseSmachState(invalidContent, 'IDLE');
    expect(result).toBeNull();
  });

  it('should return empty string for missing description', () => {
    const contentNoDesc = `smach_diagram:
  states:
    TEST:
      transitions:
        done: COMPLETE`;
    const result = parseSmachState(contentNoDesc, 'TEST');
    expect(result).not.toBeNull();
    expect(result!.description).toBe('');
  });

  it('should return empty transitions array for missing transitions', () => {
    const contentNoTransitions = `smach_diagram:
  states:
    TEST:
      description: Test state`;
    const result = parseSmachState(contentNoTransitions, 'TEST');
    expect(result).not.toBeNull();
    expect(result!.transitions).toHaveLength(0);
  });

  it('should handle empty content', () => {
    const result = parseSmachState('', 'TEST');
    expect(result).toBeNull();
  });

  it('should handle content without smach_diagram key', () => {
    const result = parseSmachState('other: data', 'TEST');
    expect(result).toBeNull();
  });

  it('should handle content without states key', () => {
    const result = parseSmachState('smach_diagram:\n  version: 1', 'TEST');
    expect(result).toBeNull();
  });
});
