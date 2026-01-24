/**
 * SkillTransition Renderer Integration Tests
 *
 * Tests for SkillTransition component integration with the AIUIRenderer:
 * - Component rendering through renderer
 * - Props passing and validation
 * - Component registration and lookup
 * - Different skill names and descriptions
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AIUIRenderer } from '../renderer';
import type { UIComponent } from '@/types/ai-ui';

describe('SkillTransition Renderer Integration', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  describe('Component rendering through renderer', () => {
    it('should render SkillTransition component', () => {
      const component: UIComponent = {
        type: 'SkillTransition',
        props: {
          skillName: 'test-skill',
          description: 'Test skill description',
        },
      };

      render(<AIUIRenderer component={component} />);

      expect(screen.getByText('test-skill')).toBeInTheDocument();
      expect(screen.getByText('Test skill description')).toBeInTheDocument();
    });

    it('should render SkillTransition without description', () => {
      const component: UIComponent = {
        type: 'SkillTransition',
        props: {
          skillName: 'brainstorming',
        },
      };

      render(<AIUIRenderer component={component} />);

      expect(screen.getByText('brainstorming')).toBeInTheDocument();
    });

    it('should render multiple SkillTransition components', () => {
      const component: UIComponent = {
        type: 'Section',
        props: { heading: 'Skill Transitions' },
        children: [
          {
            type: 'SkillTransition',
            props: {
              skillName: 'brainstorming',
              description: 'First skill',
            },
          },
          {
            type: 'SkillTransition',
            props: {
              skillName: 'brainstorming-clarifying',
              description: 'Second skill',
            },
          },
        ],
      };

      render(<AIUIRenderer component={component} />);

      expect(screen.getByText('brainstorming')).toBeInTheDocument();
      expect(screen.getByText('brainstorming-clarifying')).toBeInTheDocument();
      expect(screen.getByText('First skill')).toBeInTheDocument();
      expect(screen.getByText('Second skill')).toBeInTheDocument();
    });
  });

  describe('Props handling', () => {
    it('should pass skillName prop correctly', () => {
      const component: UIComponent = {
        type: 'SkillTransition',
        props: {
          skillName: 'executing-plans',
          description: 'Execute implementation plans',
        },
      };

      render(<AIUIRenderer component={component} />);

      expect(screen.getByText('executing-plans')).toBeInTheDocument();
    });

    it('should pass description prop correctly', () => {
      const description = 'Custom skill description text';
      const component: UIComponent = {
        type: 'SkillTransition',
        props: {
          skillName: 'test-skill',
          description,
        },
      };

      render(<AIUIRenderer component={component} />);

      expect(screen.getByText(description)).toBeInTheDocument();
    });

    it('should pass className prop correctly', () => {
      const { container } = render(
        <AIUIRenderer
          component={{
            type: 'SkillTransition',
            props: {
              skillName: 'test-skill',
              className: 'custom-class',
            },
          }}
        />
      );

      const wrapper = container.querySelector('[aria-label="skill-transition"]');
      expect(wrapper).toHaveClass('custom-class');
    });
  });

  describe('Nested rendering', () => {
    it('should render SkillTransition nested in Card', () => {
      const component: UIComponent = {
        type: 'Card',
        props: { title: 'Skill Info' },
        children: [
          {
            type: 'SkillTransition',
            props: {
              skillName: 'brainstorming',
              description: 'Exploring requirements',
            },
          },
        ],
      };

      render(<AIUIRenderer component={component} />);

      expect(screen.getByText('Skill Info')).toBeInTheDocument();
      expect(screen.getByText('brainstorming')).toBeInTheDocument();
      expect(screen.getByText('Exploring requirements')).toBeInTheDocument();
    });

    it('should render SkillTransition in Columns layout', () => {
      const component: UIComponent = {
        type: 'Columns',
        props: { columns: 2 },
        children: [
          {
            type: 'SkillTransition',
            props: {
              skillName: 'skill-1',
              description: 'First skill',
            },
          },
          {
            type: 'SkillTransition',
            props: {
              skillName: 'skill-2',
              description: 'Second skill',
            },
          },
        ],
      };

      render(<AIUIRenderer component={component} />);

      expect(screen.getByText('skill-1')).toBeInTheDocument();
      expect(screen.getByText('skill-2')).toBeInTheDocument();
    });
  });

  describe('Component registration', () => {
    it('should have SkillTransition registered', () => {
      const component: UIComponent = {
        type: 'SkillTransition',
        props: {
          skillName: 'brainstorming',
          description: 'Testing registration',
        },
      };

      // Should not throw or render error
      render(<AIUIRenderer component={component} />);

      expect(screen.getByText('brainstorming')).toBeInTheDocument();
    });
  });
});
