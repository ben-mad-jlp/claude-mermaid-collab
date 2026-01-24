import { describe, it, expect } from 'vitest';
import { hasComponent, getComponent, getComponentMetadata } from './registry';

describe('Dropdown Integration', () => {
  it('is registered in the component registry', () => {
    expect(hasComponent('Dropdown')).toBe(true);
  });

  it('can be retrieved from the registry', () => {
    const component = getComponent('Dropdown');
    expect(component).toBeDefined();
    expect(component?.displayName).toBe('Dropdown');
  });

  it('has correct metadata in the registry', () => {
    const metadata = getComponentMetadata('Dropdown');
    expect(metadata).toBeDefined();
    expect(metadata?.name).toBe('Dropdown');
    expect(metadata?.category).toBe('inputs');
    expect(metadata?.description).toBe('Dropdown select menu component');
  });

  it('is available in the inputs category', () => {
    const metadata = getComponentMetadata('Dropdown');
    expect(metadata?.category).toBe('inputs');
  });
});
