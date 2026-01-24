/**
 * Component Registry Tests
 *
 * Tests for the AI-UI component registry system including:
 * - Component lookup and retrieval
 * - Component validation
 * - Metadata access
 * - Category filtering
 * - Registry statistics
 */

import { describe, it, expect } from 'vitest';
import {
  getComponent,
  getComponentMetadata,
  hasComponent,
  getAllComponentNames,
  getAllComponents,
  getComponentsByCategory,
  validateComponent,
  getComponentCount,
  getCategoryStats,
  aiUIRegistry,
} from '../registry';

describe('AI-UI Component Registry', () => {
  describe('getComponent', () => {
    it('should retrieve a registered component', () => {
      const component = getComponent('Card');
      expect(component).toBeDefined();
      expect(typeof component).toBe('function');
    });

    it('should return undefined for unregistered components', () => {
      const component = getComponent('NonExistentComponent');
      expect(component).toBeUndefined();
    });

    it('should retrieve all 22 AI-UI components', () => {
      const componentNames = [
        // Display (6)
        'Table',
        'CodeBlock',
        'DiffView',
        'JsonViewer',
        'Markdown',
        'SkillTransition',
        // Layout (5)
        'Card',
        'Section',
        'Columns',
        'Accordion',
        'Alert',
        // Interactive (5)
        'Wizard',
        'Checklist',
        'ApprovalButtons',
        'ProgressBar',
        'Tabs',
        // Inputs (5)
        'MultipleChoice',
        'TextInput',
        'TextArea',
        'Checkbox',
        'Confirmation',
        // Mermaid (2)
        'DiagramEmbed',
        'WireframeEmbed',
      ];

      componentNames.forEach((name) => {
        const component = getComponent(name);
        expect(component).toBeDefined();
        expect(typeof component).toBe('function');
      });
    });
  });

  describe('getComponentMetadata', () => {
    it('should retrieve metadata for a registered component', () => {
      const metadata = getComponentMetadata('Card');
      expect(metadata).toBeDefined();
      expect(metadata?.name).toBe('Card');
      expect(metadata?.category).toBe('layout');
      expect(metadata?.description).toBeDefined();
      expect(metadata?.component).toBeDefined();
    });

    it('should return undefined for unregistered components', () => {
      const metadata = getComponentMetadata('InvalidComponent');
      expect(metadata).toBeUndefined();
    });

    it('should have correct metadata structure', () => {
      const metadata = getComponentMetadata('CodeBlock');
      expect(metadata).toHaveProperty('name');
      expect(metadata).toHaveProperty('category');
      expect(metadata).toHaveProperty('description');
      expect(metadata).toHaveProperty('component');
    });
  });

  describe('hasComponent', () => {
    it('should return true for registered components', () => {
      expect(hasComponent('Alert')).toBe(true);
      expect(hasComponent('Wizard')).toBe(true);
      expect(hasComponent('TextInput')).toBe(true);
    });

    it('should return false for unregistered components', () => {
      expect(hasComponent('UnknownComponent')).toBe(false);
      expect(hasComponent('FakeComponent')).toBe(false);
    });

    it('should be case-sensitive', () => {
      expect(hasComponent('card')).toBe(false);
      expect(hasComponent('CARD')).toBe(false);
      expect(hasComponent('Card')).toBe(true);
    });
  });

  describe('getAllComponentNames', () => {
    it('should return all 34 component names', () => {
      const names = getAllComponentNames();
      expect(names.length).toBe(34);
    });

    it('should return array of strings', () => {
      const names = getAllComponentNames();
      expect(Array.isArray(names)).toBe(true);
      names.forEach((name) => {
        expect(typeof name).toBe('string');
      });
    });

    it('should contain all expected components', () => {
      const names = getAllComponentNames();
      const expectedComponents = [
        'Table',
        'CodeBlock',
        'Card',
        'Wizard',
        'TextInput',
        'DiagramEmbed',
      ];

      expectedComponents.forEach((comp) => {
        expect(names).toContain(comp);
      });
    });
  });

  describe('getAllComponents', () => {
    it('should return all 34 components metadata', () => {
      const components = getAllComponents();
      expect(components.length).toBe(34);
    });

    it('should return metadata objects', () => {
      const components = getAllComponents();
      components.forEach((meta) => {
        expect(meta).toHaveProperty('name');
        expect(meta).toHaveProperty('category');
        expect(meta).toHaveProperty('description');
        expect(meta).toHaveProperty('component');
      });
    });

    it('should have valid category values', () => {
      const components = getAllComponents();
      const validCategories = [
        'display',
        'layout',
        'interactive',
        'inputs',
        'mermaid',
      ];

      components.forEach((meta) => {
        expect(validCategories).toContain(meta.category);
      });
    });
  });

  describe('getComponentsByCategory', () => {
    it('should return 9 display components', () => {
      const displayComps = getComponentsByCategory('display');
      expect(displayComps.length).toBe(9);
      displayComps.forEach((comp) => {
        expect(comp.category).toBe('display');
      });
    });

    it('should return 6 layout components', () => {
      const layoutComps = getComponentsByCategory('layout');
      expect(layoutComps.length).toBe(6);
      layoutComps.forEach((comp) => {
        expect(comp.category).toBe('layout');
      });
    });

    it('should return 6 interactive components', () => {
      const interactiveComps = getComponentsByCategory('interactive');
      expect(interactiveComps.length).toBe(6);
      interactiveComps.forEach((comp) => {
        expect(comp.category).toBe('interactive');
      });
    });

    it('should return 11 input components', () => {
      const inputComps = getComponentsByCategory('inputs');
      expect(inputComps.length).toBe(11);
      inputComps.forEach((comp) => {
        expect(comp.category).toBe('inputs');
      });
    });

    it('should return 2 mermaid components', () => {
      const mermaidComps = getComponentsByCategory('mermaid');
      expect(mermaidComps.length).toBe(2);
      mermaidComps.forEach((comp) => {
        expect(comp.category).toBe('mermaid');
      });
    });
  });

  describe('validateComponent', () => {
    it('should return metadata for valid components', () => {
      const metadata = validateComponent('Card');
      expect(metadata).toBeDefined();
      expect(metadata.name).toBe('Card');
    });

    it('should throw error for unregistered components', () => {
      expect(() => validateComponent('InvalidComponent')).toThrow();
    });

    it('should include component names in error message', () => {
      try {
        validateComponent('FakeComponent');
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain('FakeComponent');
        expect((error as Error).message).toContain('not registered');
      }
    });

    it('should suggest available components in error', () => {
      try {
        validateComponent('UnknownComp');
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect((error as Error).message).toContain('Available components');
      }
    });
  });

  describe('getComponentCount', () => {
    it('should return 34 for total components', () => {
      expect(getComponentCount()).toBe(34);
    });
  });

  describe('getCategoryStats', () => {
    it('should return stats object with all categories', () => {
      const stats = getCategoryStats();
      expect(stats).toHaveProperty('display');
      expect(stats).toHaveProperty('layout');
      expect(stats).toHaveProperty('interactive');
      expect(stats).toHaveProperty('inputs');
      expect(stats).toHaveProperty('mermaid');
    });

    it('should have correct counts per category', () => {
      const stats = getCategoryStats();
      expect(stats.display).toBe(9);
      expect(stats.layout).toBe(6);
      expect(stats.interactive).toBe(6);
      expect(stats.inputs).toBe(11);
      expect(stats.mermaid).toBe(2);
    });

    it('should total 34 components', () => {
      const stats = getCategoryStats();
      const total =
        stats.display +
        stats.layout +
        stats.interactive +
        stats.inputs +
        stats.mermaid;
      expect(total).toBe(34);
    });
  });

  describe('aiUIRegistry default export', () => {
    it('should provide all registry methods', () => {
      expect(aiUIRegistry.getComponent).toBeDefined();
      expect(aiUIRegistry.getComponentMetadata).toBeDefined();
      expect(aiUIRegistry.hasComponent).toBeDefined();
      expect(aiUIRegistry.getAllComponentNames).toBeDefined();
      expect(aiUIRegistry.getAllComponents).toBeDefined();
      expect(aiUIRegistry.getComponentsByCategory).toBeDefined();
      expect(aiUIRegistry.validateComponent).toBeDefined();
      expect(aiUIRegistry.getComponentCount).toBeDefined();
      expect(aiUIRegistry.getCategoryStats).toBeDefined();
    });

    it('should work with namespace access', () => {
      expect(aiUIRegistry.getComponentCount()).toBe(34);
      expect(aiUIRegistry.hasComponent('Card')).toBe(true);
      expect(aiUIRegistry.getComponent('Card')).toBeDefined();
    });
  });

  describe('Component completeness', () => {
    it('should have metadata descriptions for all components', () => {
      const components = getAllComponents();
      components.forEach((comp) => {
        expect(comp.description).toBeDefined();
        expect(comp.description.length).toBeGreaterThan(0);
      });
    });

    it('should have valid component functions', () => {
      const components = getAllComponents();
      components.forEach((comp) => {
        expect(typeof comp.component).toBe('function');
      });
    });

    it('should have unique component names', () => {
      const names = getAllComponentNames();
      const uniqueNames = new Set(names);
      expect(uniqueNames.size).toBe(names.length);
    });

    it('should not have duplicate components in registry', () => {
      const components = getAllComponents();
      const names = components.map((c) => c.name);
      const uniqueNames = new Set(names);
      expect(uniqueNames.size).toBe(names.length);
    });
  });
});
