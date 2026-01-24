/**
 * ArtifactLink Component Tests
 *
 * Tests for the clickable artifact link component that displays
 * artifact notifications (created/updated documents and diagrams)
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ArtifactLink } from './ArtifactLink';

describe('ArtifactLink Component', () => {
  const mockOnClick = vi.fn();

  beforeEach(() => {
    mockOnClick.mockClear();
  });

  describe('Rendering', () => {
    it('should render without crashing', () => {
      const { container } = render(
        <ArtifactLink
          notification={{
            type: 'created',
            artifactType: 'document',
            id: 'doc-1',
            name: 'Test Document',
          }}
          onClick={mockOnClick}
        />
      );
      expect(container).toBeDefined();
    });

    it('should display the artifact name', () => {
      render(
        <ArtifactLink
          notification={{
            type: 'created',
            artifactType: 'document',
            id: 'doc-1',
            name: 'My Test Document',
          }}
          onClick={mockOnClick}
        />
      );
      expect(screen.getByText(/My Test Document/)).toBeDefined();
    });

    it('should show "Created" text for created notifications', () => {
      render(
        <ArtifactLink
          notification={{
            type: 'created',
            artifactType: 'document',
            id: 'doc-1',
            name: 'Test Document',
          }}
          onClick={mockOnClick}
        />
      );
      expect(screen.getByText(/Created/)).toBeDefined();
    });

    it('should show "Updated" text for updated notifications', () => {
      render(
        <ArtifactLink
          notification={{
            type: 'updated',
            artifactType: 'diagram',
            id: 'diag-1',
            name: 'Test Diagram',
          }}
          onClick={mockOnClick}
        />
      );
      expect(screen.getByText(/Updated/)).toBeDefined();
    });

    it('should display document icon for document artifacts', () => {
      const { container } = render(
        <ArtifactLink
          notification={{
            type: 'created',
            artifactType: 'document',
            id: 'doc-1',
            name: 'Test Document',
          }}
          onClick={mockOnClick}
        />
      );
      // The component should have the document emoji/icon
      expect(container.textContent).toContain('📄');
    });

    it('should display diagram icon for diagram artifacts', () => {
      const { container } = render(
        <ArtifactLink
          notification={{
            type: 'created',
            artifactType: 'diagram',
            id: 'diag-1',
            name: 'Test Diagram',
          }}
          onClick={mockOnClick}
        />
      );
      // The component should have the diagram emoji
      expect(container.textContent).toContain('📊');
    });

    it('should render as a clickable button/link', () => {
      render(
        <ArtifactLink
          notification={{
            type: 'created',
            artifactType: 'document',
            id: 'doc-1',
            name: 'Test Document',
          }}
          onClick={mockOnClick}
        />
      );
      const button = screen.getByRole('button');
      expect(button).toBeDefined();
    });

    it('should have hyperlink styling (blue text)', () => {
      const { container } = render(
        <ArtifactLink
          notification={{
            type: 'created',
            artifactType: 'document',
            id: 'doc-1',
            name: 'Test Document',
          }}
          onClick={mockOnClick}
        />
      );
      const button = screen.getByRole('button');
      // Should have blue color class
      expect(button.className).toMatch(/blue|text-blue/i);
    });

    it('should have underline on hover styling', () => {
      const { container } = render(
        <ArtifactLink
          notification={{
            type: 'created',
            artifactType: 'document',
            id: 'doc-1',
            name: 'Test Document',
          }}
          onClick={mockOnClick}
        />
      );
      const button = screen.getByRole('button');
      // Should have hover underline class
      expect(button.className).toMatch(/hover:underline|underline/i);
    });

    it('should support dark mode', () => {
      document.documentElement.classList.add('dark');
      const { container } = render(
        <ArtifactLink
          notification={{
            type: 'created',
            artifactType: 'document',
            id: 'doc-1',
            name: 'Test Document',
          }}
          onClick={mockOnClick}
        />
      );
      const button = screen.getByRole('button');
      // Should have dark mode color classes
      expect(button.className).toMatch(/dark:/);
      document.documentElement.classList.remove('dark');
    });

    it('should display "(click to view)" helper text', () => {
      render(
        <ArtifactLink
          notification={{
            type: 'created',
            artifactType: 'document',
            id: 'doc-1',
            name: 'Test Document',
          }}
          onClick={mockOnClick}
        />
      );
      expect(screen.getByText(/click to view/i)).toBeDefined();
    });
  });

  describe('Interaction', () => {
    it('should call onClick callback when clicked', async () => {
      const user = userEvent.setup();
      render(
        <ArtifactLink
          notification={{
            type: 'created',
            artifactType: 'document',
            id: 'doc-1',
            name: 'Test Document',
          }}
          onClick={mockOnClick}
        />
      );
      const button = screen.getByRole('button');
      await user.click(button);
      expect(mockOnClick).toHaveBeenCalledTimes(1);
    });

    it('should pass correct artifact ID to onClick callback', async () => {
      const user = userEvent.setup();
      const testId = 'doc-123-abc';
      render(
        <ArtifactLink
          notification={{
            type: 'created',
            artifactType: 'document',
            id: testId,
            name: 'Test Document',
          }}
          onClick={mockOnClick}
        />
      );
      const button = screen.getByRole('button');
      await user.click(button);
      expect(mockOnClick).toHaveBeenCalledWith(testId, 'document');
    });

    it('should pass correct artifact type to onClick callback for documents', async () => {
      const user = userEvent.setup();
      render(
        <ArtifactLink
          notification={{
            type: 'created',
            artifactType: 'document',
            id: 'doc-1',
            name: 'Test Document',
          }}
          onClick={mockOnClick}
        />
      );
      const button = screen.getByRole('button');
      await user.click(button);
      expect(mockOnClick).toHaveBeenCalledWith('doc-1', 'document');
    });

    it('should pass correct artifact type to onClick callback for diagrams', async () => {
      const user = userEvent.setup();
      render(
        <ArtifactLink
          notification={{
            type: 'created',
            artifactType: 'diagram',
            id: 'diag-1',
            name: 'Test Diagram',
          }}
          onClick={mockOnClick}
        />
      );
      const button = screen.getByRole('button');
      await user.click(button);
      expect(mockOnClick).toHaveBeenCalledWith('diag-1', 'diagram');
    });

    it('should handle multiple clicks', async () => {
      const user = userEvent.setup();
      render(
        <ArtifactLink
          notification={{
            type: 'created',
            artifactType: 'document',
            id: 'doc-1',
            name: 'Test Document',
          }}
          onClick={mockOnClick}
        />
      );
      const button = screen.getByRole('button');
      await user.click(button);
      await user.click(button);
      expect(mockOnClick).toHaveBeenCalledTimes(2);
    });

    it('should work with fireEvent click', () => {
      render(
        <ArtifactLink
          notification={{
            type: 'created',
            artifactType: 'document',
            id: 'doc-1',
            name: 'Test Document',
          }}
          onClick={mockOnClick}
        />
      );
      const button = screen.getByRole('button');
      fireEvent.click(button);
      expect(mockOnClick).toHaveBeenCalledTimes(1);
    });
  });

  describe('Accessibility', () => {
    it('should be keyboard accessible', async () => {
      const user = userEvent.setup();
      render(
        <ArtifactLink
          notification={{
            type: 'created',
            artifactType: 'document',
            id: 'doc-1',
            name: 'Test Document',
          }}
          onClick={mockOnClick}
        />
      );
      const button = screen.getByRole('button');
      button.focus();
      expect(document.activeElement).toBe(button);
      await user.keyboard('{Enter}');
      expect(mockOnClick).toHaveBeenCalledTimes(1);
    });

    it('should be a button role for proper semantics', () => {
      render(
        <ArtifactLink
          notification={{
            type: 'created',
            artifactType: 'document',
            id: 'doc-1',
            name: 'Test Document',
          }}
          onClick={mockOnClick}
        />
      );
      const button = screen.getByRole('button');
      expect(button).toBeDefined();
    });

    it('should have readable text content', () => {
      render(
        <ArtifactLink
          notification={{
            type: 'created',
            artifactType: 'document',
            id: 'doc-1',
            name: 'My Important Document',
          }}
          onClick={mockOnClick}
        />
      );
      const button = screen.getByRole('button');
      // Should contain the artifact name in the text
      expect(button.textContent).toContain('My Important Document');
    });

    it('should have sufficient focus indicators', () => {
      const { container } = render(
        <ArtifactLink
          notification={{
            type: 'created',
            artifactType: 'document',
            id: 'doc-1',
            name: 'Test Document',
          }}
          onClick={mockOnClick}
        />
      );
      const button = screen.getByRole('button');
      // Should have focus-visible or focus styles
      expect(button.className).toMatch(/focus|ring/i);
    });
  });

  describe('Display Format', () => {
    it('should show format "[Created]: [name] (click to view)"', () => {
      render(
        <ArtifactLink
          notification={{
            type: 'created',
            artifactType: 'document',
            id: 'doc-1',
            name: 'Test Document',
          }}
          onClick={mockOnClick}
        />
      );
      const text = screen.getByRole('button').textContent;
      expect(text).toMatch(/Created.*Test Document.*click to view/i);
    });

    it('should show format "[Updated]: [name] (click to view)"', () => {
      render(
        <ArtifactLink
          notification={{
            type: 'updated',
            artifactType: 'diagram',
            id: 'diag-1',
            name: 'Test Diagram',
          }}
          onClick={mockOnClick}
        />
      );
      const text = screen.getByRole('button').textContent;
      expect(text).toMatch(/Updated.*Test Diagram.*click to view/i);
    });

    it('should handle artifact names with special characters', () => {
      render(
        <ArtifactLink
          notification={{
            type: 'created',
            artifactType: 'document',
            id: 'doc-1',
            name: 'Document (v2) & Notes',
          }}
          onClick={mockOnClick}
        />
      );
      expect(screen.getByText(/Document \(v2\) & Notes/)).toBeDefined();
    });

    it('should handle long artifact names', () => {
      const longName = 'A'.repeat(100);
      render(
        <ArtifactLink
          notification={{
            type: 'created',
            artifactType: 'document',
            id: 'doc-1',
            name: longName,
          }}
          onClick={mockOnClick}
        />
      );
      expect(screen.getByText(new RegExp(longName))).toBeDefined();
    });
  });

  describe('Styling', () => {
    it('should have inline text styling (not block)', () => {
      const { container } = render(
        <ArtifactLink
          notification={{
            type: 'created',
            artifactType: 'document',
            id: 'doc-1',
            name: 'Test Document',
          }}
          onClick={mockOnClick}
        />
      );
      const button = screen.getByRole('button');
      // Should be displayed as inline or inline-block to work within text flow
      expect(button.className).toMatch(/inline/);
    });

    it('should render within text without breaking paragraph flow', () => {
      const { container } = render(
        <p>
          This is some text with an{' '}
          <ArtifactLink
            notification={{
              type: 'created',
              artifactType: 'document',
              id: 'doc-1',
              name: 'artifact',
            }}
            onClick={mockOnClick}
          />{' '}
          in the middle.
        </p>
      );
      const paragraph = container.querySelector('p');
      expect(paragraph).toBeDefined();
      expect(paragraph?.textContent).toContain('This is some text');
      expect(paragraph?.textContent).toContain('artifact');
      expect(paragraph?.textContent).toContain('in the middle');
    });
  });

  describe('Different Notification Types', () => {
    it('should handle created document notifications', () => {
      render(
        <ArtifactLink
          notification={{
            type: 'created',
            artifactType: 'document',
            id: 'doc-1',
            name: 'Design Doc',
          }}
          onClick={mockOnClick}
        />
      );
      expect(screen.getByText(/Created/)).toBeDefined();
      expect(screen.getByText(/📄/)).toBeDefined();
    });

    it('should handle updated document notifications', () => {
      render(
        <ArtifactLink
          notification={{
            type: 'updated',
            artifactType: 'document',
            id: 'doc-1',
            name: 'Design Doc',
          }}
          onClick={mockOnClick}
        />
      );
      expect(screen.getByText(/Updated/)).toBeDefined();
      expect(screen.getByText(/📄/)).toBeDefined();
    });

    it('should handle created diagram notifications', () => {
      render(
        <ArtifactLink
          notification={{
            type: 'created',
            artifactType: 'diagram',
            id: 'diag-1',
            name: 'Flowchart',
          }}
          onClick={mockOnClick}
        />
      );
      expect(screen.getByText(/Created/)).toBeDefined();
      expect(screen.getByText(/📊/)).toBeDefined();
    });

    it('should handle updated diagram notifications', () => {
      render(
        <ArtifactLink
          notification={{
            type: 'updated',
            artifactType: 'diagram',
            id: 'diag-1',
            name: 'Flowchart',
          }}
          onClick={mockOnClick}
        />
      );
      expect(screen.getByText(/Updated/)).toBeDefined();
      expect(screen.getByText(/📊/)).toBeDefined();
    });
  });
});
