/**
 * SplitPane Component Tests
 *
 * Test coverage includes:
 * - Component rendering and initialization
 * - Primary and secondary panel content display
 * - Horizontal and vertical split directions
 * - Default size configuration
 * - Minimum and maximum size constraints
 * - Collapsible panel functionality
 * - Resize handle visibility and interaction
 * - Three-way split pane variant
 * - Custom class names and styling
 * - Accessibility features
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SplitPane, ThreeWaySplitPane } from '../SplitPane';

// Mock react-resizable-panels
vi.mock('react-resizable-panels', () => ({
  Panel: ({ children, 'data-testid': testId, defaultSizePercentage, minSizePercentage, maxSizePercentage, collapsible }: any) => (
    <div
      data-testid={testId}
      data-default-size={defaultSizePercentage}
      data-min-size={minSizePercentage}
      data-max-size={maxSizePercentage}
      data-collapsible={collapsible}
    >
      {children}
    </div>
  ),
  PanelGroup: ({ children, direction, onLayout, autoSaveId }: any) => (
    <div
      data-testid="panel-group"
      data-direction={direction}
      data-auto-save-id={autoSaveId}
    >
      {children}
    </div>
  ),
  PanelResizeHandle: ({ children, 'data-testid': testId, className }: any) => (
    <div
      data-testid={testId}
      className={className}
      role="separator"
    >
      {children}
    </div>
  ),
}));

describe('SplitPane', () => {
  const mockPrimaryContent = <div data-testid="primary-content">Primary</div>;
  const mockSecondaryContent = <div data-testid="secondary-content">Secondary</div>;

  let mockOnSizeChange: ReturnType<typeof vi.fn>;
  let mockOnPrimaryCollapse: ReturnType<typeof vi.fn>;
  let mockOnPrimaryExpand: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockOnSizeChange = vi.fn();
    mockOnPrimaryCollapse = vi.fn();
    mockOnPrimaryExpand = vi.fn();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Rendering', () => {
    it('should render the split pane', () => {
      render(
        <SplitPane
          primaryContent={mockPrimaryContent}
          secondaryContent={mockSecondaryContent}
        />
      );
      expect(screen.getByTestId('split-pane')).toBeDefined();
    });

    it('should render primary panel', () => {
      render(
        <SplitPane
          primaryContent={mockPrimaryContent}
          secondaryContent={mockSecondaryContent}
        />
      );
      expect(screen.getByTestId('split-pane-primary')).toBeDefined();
    });

    it('should render secondary panel', () => {
      render(
        <SplitPane
          primaryContent={mockPrimaryContent}
          secondaryContent={mockSecondaryContent}
        />
      );
      expect(screen.getByTestId('split-pane-secondary')).toBeDefined();
    });

    it('should render resize handle', () => {
      render(
        <SplitPane
          primaryContent={mockPrimaryContent}
          secondaryContent={mockSecondaryContent}
        />
      );
      expect(screen.getByTestId('split-pane-handle')).toBeDefined();
    });

    it('should render primary content', () => {
      render(
        <SplitPane
          primaryContent={mockPrimaryContent}
          secondaryContent={mockSecondaryContent}
        />
      );
      expect(screen.getByTestId('primary-content')).toBeDefined();
      expect(screen.getByText('Primary')).toBeDefined();
    });

    it('should render secondary content', () => {
      render(
        <SplitPane
          primaryContent={mockPrimaryContent}
          secondaryContent={mockSecondaryContent}
        />
      );
      expect(screen.getByTestId('secondary-content')).toBeDefined();
      expect(screen.getByText('Secondary')).toBeDefined();
    });

    it('should apply custom className', () => {
      render(
        <SplitPane
          primaryContent={mockPrimaryContent}
          secondaryContent={mockSecondaryContent}
          className="custom-split"
        />
      );
      const splitPane = screen.getByTestId('split-pane');
      expect(splitPane.className).toContain('custom-split');
    });
  });

  describe('Direction', () => {
    it('should default to horizontal direction', () => {
      render(
        <SplitPane
          primaryContent={mockPrimaryContent}
          secondaryContent={mockSecondaryContent}
        />
      );
      const panelGroup = screen.getByTestId('panel-group');
      expect(panelGroup.getAttribute('data-direction')).toBe('horizontal');
    });

    it('should accept horizontal direction', () => {
      render(
        <SplitPane
          primaryContent={mockPrimaryContent}
          secondaryContent={mockSecondaryContent}
          direction="horizontal"
        />
      );
      const panelGroup = screen.getByTestId('panel-group');
      expect(panelGroup.getAttribute('data-direction')).toBe('horizontal');
    });

    it('should accept vertical direction', () => {
      render(
        <SplitPane
          primaryContent={mockPrimaryContent}
          secondaryContent={mockSecondaryContent}
          direction="vertical"
        />
      );
      const panelGroup = screen.getByTestId('panel-group');
      expect(panelGroup.getAttribute('data-direction')).toBe('vertical');
    });
  });

  describe('Size Configuration', () => {
    it('should use default primary size of 50', () => {
      render(
        <SplitPane
          primaryContent={mockPrimaryContent}
          secondaryContent={mockSecondaryContent}
        />
      );
      const primaryPanel = screen.getByTestId('split-pane-primary');
      expect(primaryPanel.getAttribute('data-default-size')).toBe('50');
    });

    it('should accept custom default primary size', () => {
      render(
        <SplitPane
          primaryContent={mockPrimaryContent}
          secondaryContent={mockSecondaryContent}
          defaultPrimarySize={30}
        />
      );
      const primaryPanel = screen.getByTestId('split-pane-primary');
      expect(primaryPanel.getAttribute('data-default-size')).toBe('30');
    });

    it('should use default minimum primary size of 10', () => {
      render(
        <SplitPane
          primaryContent={mockPrimaryContent}
          secondaryContent={mockSecondaryContent}
        />
      );
      const primaryPanel = screen.getByTestId('split-pane-primary');
      expect(primaryPanel.getAttribute('data-min-size')).toBe('10');
    });

    it('should accept custom minimum primary size', () => {
      render(
        <SplitPane
          primaryContent={mockPrimaryContent}
          secondaryContent={mockSecondaryContent}
          minPrimarySize={20}
        />
      );
      const primaryPanel = screen.getByTestId('split-pane-primary');
      expect(primaryPanel.getAttribute('data-min-size')).toBe('20');
    });

    it('should use default maximum primary size of 90', () => {
      render(
        <SplitPane
          primaryContent={mockPrimaryContent}
          secondaryContent={mockSecondaryContent}
        />
      );
      const primaryPanel = screen.getByTestId('split-pane-primary');
      expect(primaryPanel.getAttribute('data-max-size')).toBe('90');
    });

    it('should accept custom maximum primary size', () => {
      render(
        <SplitPane
          primaryContent={mockPrimaryContent}
          secondaryContent={mockSecondaryContent}
          maxPrimarySize={70}
        />
      );
      const primaryPanel = screen.getByTestId('split-pane-primary');
      expect(primaryPanel.getAttribute('data-max-size')).toBe('70');
    });
  });

  describe('Collapsible Panels', () => {
    it('should not be collapsible by default', () => {
      render(
        <SplitPane
          primaryContent={mockPrimaryContent}
          secondaryContent={mockSecondaryContent}
        />
      );
      const primaryPanel = screen.getByTestId('split-pane-primary');
      expect(primaryPanel.getAttribute('data-collapsible')).toBe('false');
    });

    it('should accept primaryCollapsible prop', () => {
      render(
        <SplitPane
          primaryContent={mockPrimaryContent}
          secondaryContent={mockSecondaryContent}
          primaryCollapsible={true}
        />
      );
      const primaryPanel = screen.getByTestId('split-pane-primary');
      expect(primaryPanel.getAttribute('data-collapsible')).toBe('true');
    });

    it('should accept secondaryCollapsible prop', () => {
      render(
        <SplitPane
          primaryContent={mockPrimaryContent}
          secondaryContent={mockSecondaryContent}
          secondaryCollapsible={true}
        />
      );
      const secondaryPanel = screen.getByTestId('split-pane-secondary');
      expect(secondaryPanel.getAttribute('data-collapsible')).toBe('true');
    });
  });

  describe('Storage', () => {
    it('should accept storageId for persistence', () => {
      render(
        <SplitPane
          primaryContent={mockPrimaryContent}
          secondaryContent={mockSecondaryContent}
          storageId="my-split-pane"
        />
      );
      const panelGroup = screen.getByTestId('panel-group');
      expect(panelGroup.getAttribute('data-auto-save-id')).toBe('my-split-pane');
    });

    it('should not have autoSaveId when storageId not provided', () => {
      render(
        <SplitPane
          primaryContent={mockPrimaryContent}
          secondaryContent={mockSecondaryContent}
        />
      );
      const panelGroup = screen.getByTestId('panel-group');
      expect(panelGroup.getAttribute('data-auto-save-id')).toBeNull();
    });
  });

  describe('Resize Handle', () => {
    it('should render resize handle with separator role', () => {
      render(
        <SplitPane
          primaryContent={mockPrimaryContent}
          secondaryContent={mockSecondaryContent}
        />
      );
      const handle = screen.getByTestId('split-pane-handle');
      expect(handle.getAttribute('role')).toBe('separator');
    });

    it('should apply hover styling classes', () => {
      render(
        <SplitPane
          primaryContent={mockPrimaryContent}
          secondaryContent={mockSecondaryContent}
        />
      );
      const handle = screen.getByTestId('split-pane-handle');
      expect(handle.className).toContain('hover:bg-accent-400');
    });

    it('should accept custom resize handle content', () => {
      render(
        <SplitPane
          primaryContent={mockPrimaryContent}
          secondaryContent={mockSecondaryContent}
          resizeHandleContent={<span data-testid="custom-handle">|||</span>}
        />
      );
      expect(screen.getByTestId('custom-handle')).toBeDefined();
    });
  });

  describe('Styling', () => {
    it('should have full width and height', () => {
      render(
        <SplitPane
          primaryContent={mockPrimaryContent}
          secondaryContent={mockSecondaryContent}
        />
      );
      const splitPane = screen.getByTestId('split-pane');
      expect(splitPane.className).toContain('w-full');
      expect(splitPane.className).toContain('h-full');
    });

    it('should have overflow hidden on panels', () => {
      render(
        <SplitPane
          primaryContent={mockPrimaryContent}
          secondaryContent={mockSecondaryContent}
        />
      );
      const primaryPanel = screen.getByTestId('split-pane-primary');
      const innerDiv = primaryPanel.querySelector('div');
      expect(innerDiv?.className).toContain('overflow-hidden');
    });
  });
});

describe('ThreeWaySplitPane', () => {
  const mockLeftContent = <div data-testid="left-content">Left</div>;
  const mockCenterContent = <div data-testid="center-content">Center</div>;
  const mockRightContent = <div data-testid="right-content">Right</div>;

  describe('Rendering', () => {
    it('should render the three-way split pane', () => {
      render(
        <ThreeWaySplitPane
          leftContent={mockLeftContent}
          centerContent={mockCenterContent}
          rightContent={mockRightContent}
        />
      );
      expect(screen.getByTestId('three-way-split-pane')).toBeDefined();
    });

    it('should render left panel', () => {
      render(
        <ThreeWaySplitPane
          leftContent={mockLeftContent}
          centerContent={mockCenterContent}
          rightContent={mockRightContent}
        />
      );
      expect(screen.getByTestId('split-pane-left')).toBeDefined();
    });

    it('should render center panel', () => {
      render(
        <ThreeWaySplitPane
          leftContent={mockLeftContent}
          centerContent={mockCenterContent}
          rightContent={mockRightContent}
        />
      );
      expect(screen.getByTestId('split-pane-center')).toBeDefined();
    });

    it('should render right panel', () => {
      render(
        <ThreeWaySplitPane
          leftContent={mockLeftContent}
          centerContent={mockCenterContent}
          rightContent={mockRightContent}
        />
      );
      expect(screen.getByTestId('split-pane-right')).toBeDefined();
    });

    it('should render two resize handles', () => {
      render(
        <ThreeWaySplitPane
          leftContent={mockLeftContent}
          centerContent={mockCenterContent}
          rightContent={mockRightContent}
        />
      );
      expect(screen.getByTestId('split-pane-handle-left')).toBeDefined();
      expect(screen.getByTestId('split-pane-handle-right')).toBeDefined();
    });

    it('should render all content', () => {
      render(
        <ThreeWaySplitPane
          leftContent={mockLeftContent}
          centerContent={mockCenterContent}
          rightContent={mockRightContent}
        />
      );
      expect(screen.getByText('Left')).toBeDefined();
      expect(screen.getByText('Center')).toBeDefined();
      expect(screen.getByText('Right')).toBeDefined();
    });
  });

  describe('Direction', () => {
    it('should default to horizontal direction', () => {
      render(
        <ThreeWaySplitPane
          leftContent={mockLeftContent}
          centerContent={mockCenterContent}
          rightContent={mockRightContent}
        />
      );
      const panelGroup = screen.getByTestId('panel-group');
      expect(panelGroup.getAttribute('data-direction')).toBe('horizontal');
    });

    it('should accept vertical direction', () => {
      render(
        <ThreeWaySplitPane
          leftContent={mockLeftContent}
          centerContent={mockCenterContent}
          rightContent={mockRightContent}
          direction="vertical"
        />
      );
      const panelGroup = screen.getByTestId('panel-group');
      expect(panelGroup.getAttribute('data-direction')).toBe('vertical');
    });
  });

  describe('Size Configuration', () => {
    it('should use default sizes [20, 60, 20]', () => {
      render(
        <ThreeWaySplitPane
          leftContent={mockLeftContent}
          centerContent={mockCenterContent}
          rightContent={mockRightContent}
        />
      );
      const leftPanel = screen.getByTestId('split-pane-left');
      const centerPanel = screen.getByTestId('split-pane-center');
      const rightPanel = screen.getByTestId('split-pane-right');

      expect(leftPanel.getAttribute('data-default-size')).toBe('20');
      expect(centerPanel.getAttribute('data-default-size')).toBe('60');
      expect(rightPanel.getAttribute('data-default-size')).toBe('20');
    });

    it('should accept custom default sizes', () => {
      render(
        <ThreeWaySplitPane
          leftContent={mockLeftContent}
          centerContent={mockCenterContent}
          rightContent={mockRightContent}
          defaultSizes={[25, 50, 25]}
        />
      );
      const leftPanel = screen.getByTestId('split-pane-left');
      const centerPanel = screen.getByTestId('split-pane-center');
      const rightPanel = screen.getByTestId('split-pane-right');

      expect(leftPanel.getAttribute('data-default-size')).toBe('25');
      expect(centerPanel.getAttribute('data-default-size')).toBe('50');
      expect(rightPanel.getAttribute('data-default-size')).toBe('25');
    });

    it('should accept minimum sizes for each panel', () => {
      render(
        <ThreeWaySplitPane
          leftContent={mockLeftContent}
          centerContent={mockCenterContent}
          rightContent={mockRightContent}
          minLeftSize={15}
          minCenterSize={40}
          minRightSize={15}
        />
      );
      const leftPanel = screen.getByTestId('split-pane-left');
      const centerPanel = screen.getByTestId('split-pane-center');
      const rightPanel = screen.getByTestId('split-pane-right');

      expect(leftPanel.getAttribute('data-min-size')).toBe('15');
      expect(centerPanel.getAttribute('data-min-size')).toBe('40');
      expect(rightPanel.getAttribute('data-min-size')).toBe('15');
    });
  });

  describe('Collapsible Panels', () => {
    it('should accept leftCollapsible prop', () => {
      render(
        <ThreeWaySplitPane
          leftContent={mockLeftContent}
          centerContent={mockCenterContent}
          rightContent={mockRightContent}
          leftCollapsible={true}
        />
      );
      const leftPanel = screen.getByTestId('split-pane-left');
      expect(leftPanel.getAttribute('data-collapsible')).toBe('true');
    });

    it('should accept rightCollapsible prop', () => {
      render(
        <ThreeWaySplitPane
          leftContent={mockLeftContent}
          centerContent={mockCenterContent}
          rightContent={mockRightContent}
          rightCollapsible={true}
        />
      );
      const rightPanel = screen.getByTestId('split-pane-right');
      expect(rightPanel.getAttribute('data-collapsible')).toBe('true');
    });
  });

  describe('Storage', () => {
    it('should accept storageId for persistence', () => {
      render(
        <ThreeWaySplitPane
          leftContent={mockLeftContent}
          centerContent={mockCenterContent}
          rightContent={mockRightContent}
          storageId="three-way-split"
        />
      );
      const panelGroup = screen.getByTestId('panel-group');
      expect(panelGroup.getAttribute('data-auto-save-id')).toBe('three-way-split');
    });
  });

  describe('Styling', () => {
    it('should apply custom className', () => {
      render(
        <ThreeWaySplitPane
          leftContent={mockLeftContent}
          centerContent={mockCenterContent}
          rightContent={mockRightContent}
          className="custom-three-way"
        />
      );
      const splitPane = screen.getByTestId('three-way-split-pane');
      expect(splitPane.className).toContain('custom-three-way');
    });

    it('should have full width and height', () => {
      render(
        <ThreeWaySplitPane
          leftContent={mockLeftContent}
          centerContent={mockCenterContent}
          rightContent={mockRightContent}
        />
      );
      const splitPane = screen.getByTestId('three-way-split-pane');
      expect(splitPane.className).toContain('w-full');
      expect(splitPane.className).toContain('h-full');
    });
  });
});
