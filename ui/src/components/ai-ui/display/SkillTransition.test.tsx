/**
 * SkillTransition Component Tests
 *
 * Tests for the SkillTransition display component including:
 * - Rendering skill name prominently
 * - Displaying description in smaller text
 * - Visual indicator rendering
 * - Handling missing descriptions
 * - Custom className support
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { SkillTransition } from './SkillTransition';

describe('SkillTransition', () => {
  describe('Basic rendering', () => {
    it('should render skill name prominently', () => {
      render(
        <SkillTransition
          skillName="test-skill"
          description="Test description"
        />
      );

      const skillName = screen.getByText('test-skill');
      expect(skillName).toBeInTheDocument();
      expect(skillName).toHaveClass('text-lg', 'font-bold');
    });

    it('should render description in smaller text', () => {
      const description = 'This is a test description';
      render(
        <SkillTransition
          skillName="test-skill"
          description={description}
        />
      );

      const descElement = screen.getByText(description);
      expect(descElement).toBeInTheDocument();
      expect(descElement).toHaveClass('text-sm');
    });

    it('should include visual indicator (arrow icon)', () => {
      const { container } = render(
        <SkillTransition
          skillName="test-skill"
          description="Test description"
        />
      );

      // Check for arrow icon element
      const arrow = container.querySelector('[aria-label="skill-transition"]');
      expect(arrow).toBeInTheDocument();
    });
  });

  describe('Description handling', () => {
    it('should render without description', () => {
      render(<SkillTransition skillName="test-skill" />);

      const skillName = screen.getByText('test-skill');
      expect(skillName).toBeInTheDocument();
    });

    it('should render with optional description', () => {
      const description = 'Optional description text';
      render(
        <SkillTransition
          skillName="test-skill"
          description={description}
        />
      );

      expect(screen.getByText(description)).toBeInTheDocument();
    });
  });

  describe('Styling', () => {
    it('should apply custom className', () => {
      const { container } = render(
        <SkillTransition
          skillName="test-skill"
          description="Test description"
          className="custom-class"
        />
      );

      const wrapper = container.firstChild as HTMLElement;
      expect(wrapper).toHaveClass('custom-class');
    });

    it('should have distinct visual appearance', () => {
      const { container } = render(
        <SkillTransition
          skillName="test-skill"
          description="Test description"
        />
      );

      const wrapper = container.firstChild as HTMLElement;
      // Check for padding and border classes indicating visual distinction
      expect(wrapper.className).toMatch(/(p-|border|bg-)/);
    });
  });

  describe('Component structure', () => {
    it('should be visually distinct from other components', () => {
      const { container } = render(
        <SkillTransition
          skillName="test-skill"
          description="Test description"
        />
      );

      const wrapper = container.firstChild as HTMLElement;
      // Should have some styling applied
      expect(wrapper.className).toBeTruthy();
      expect(wrapper.className.length).toBeGreaterThan(0);
    });

    it('should render with proper hierarchy', () => {
      const { container } = render(
        <SkillTransition
          skillName="brainstorming"
          description="Exploring requirements"
        />
      );

      const wrapper = container.firstChild as HTMLElement;
      expect(wrapper).toBeInTheDocument();
      expect(wrapper.children.length).toBeGreaterThan(0);
    });
  });
});
