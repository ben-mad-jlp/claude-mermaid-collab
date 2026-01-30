import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ROUGH_OPTIONS,
  COLORS,
  getButtonColors,
  getInputColors,
} from '../svg-utils';

// Note: Testing the DOM manipulation functions (getRoughSvg, appendRoughRect, etc.)
// requires a full DOM environment with SVG support. These are better tested
// via component integration tests.

describe('svg-utils', () => {
  describe('ROUGH_OPTIONS', () => {
    it('has expected default options', () => {
      expect(ROUGH_OPTIONS.roughness).toBe(1.2);
      expect(ROUGH_OPTIONS.bowing).toBe(0.8);
      expect(ROUGH_OPTIONS.strokeWidth).toBe(1.5);
    });
  });

  describe('COLORS', () => {
    it('has button variant colors', () => {
      expect(COLORS.button.primary).toBeDefined();
      expect(COLORS.button.secondary).toBeDefined();
      expect(COLORS.button.danger).toBeDefined();
      expect(COLORS.button.success).toBeDefined();
      expect(COLORS.button.disabled).toBeDefined();
      expect(COLORS.button.default).toBeDefined();
    });

    it('has input state colors', () => {
      expect(COLORS.input.normal).toBeDefined();
      expect(COLORS.input.disabled).toBeDefined();
    });

    it('has navigation colors', () => {
      expect(COLORS.nav.background).toBeDefined();
      expect(COLORS.nav.border).toBeDefined();
      expect(COLORS.nav.text).toBeDefined();
      expect(COLORS.nav.active).toBeDefined();
    });

    it('has display component colors', () => {
      expect(COLORS.display.avatar).toBeDefined();
      expect(COLORS.display.image).toBeDefined();
      expect(COLORS.display.icon).toBeDefined();
      expect(COLORS.display.list).toBeDefined();
    });

    it('has container colors', () => {
      expect(COLORS.container.screenBorder).toBeDefined();
      expect(COLORS.container.cardBorder).toBeDefined();
    });
  });

  describe('getButtonColors', () => {
    it('returns primary colors for primary variant', () => {
      const colors = getButtonColors('primary', false);
      expect(colors).toEqual(COLORS.button.primary);
    });

    it('returns secondary colors for secondary variant', () => {
      const colors = getButtonColors('secondary', false);
      expect(colors).toEqual(COLORS.button.secondary);
    });

    it('returns danger colors for danger variant', () => {
      const colors = getButtonColors('danger', false);
      expect(colors).toEqual(COLORS.button.danger);
    });

    it('returns success colors for success variant', () => {
      const colors = getButtonColors('success', false);
      expect(colors).toEqual(COLORS.button.success);
    });

    it('returns disabled colors for disabled variant', () => {
      const colors = getButtonColors('disabled', false);
      expect(colors).toEqual(COLORS.button.disabled);
    });

    it('returns default colors for default variant', () => {
      const colors = getButtonColors('default', false);
      expect(colors).toEqual(COLORS.button.default);
    });

    it('returns disabled colors when disabled prop is true', () => {
      const colors = getButtonColors('primary', true);
      expect(colors).toEqual(COLORS.button.disabled);
    });

    it('overrides variant with disabled when disabled is true', () => {
      const colors = getButtonColors('danger', true);
      expect(colors).toEqual(COLORS.button.disabled);
    });
  });

  describe('getInputColors', () => {
    it('returns normal colors when not disabled', () => {
      const colors = getInputColors(false);
      expect(colors).toEqual(COLORS.input.normal);
    });

    it('returns disabled colors when disabled', () => {
      const colors = getInputColors(true);
      expect(colors).toEqual(COLORS.input.disabled);
    });

    it('includes all required color properties', () => {
      const colors = getInputColors(false);
      expect(colors.background).toBeDefined();
      expect(colors.border).toBeDefined();
      expect(colors.text).toBeDefined();
      expect(colors.placeholder).toBeDefined();
    });
  });
});
