import { describe, it, expect } from 'bun:test';
import { neverCalledSubject } from './never-called-subject';

describe('mutation-probe: never-called shape', () => {
  it('typeof neverCalledSubject === \'function\'', () => {
    expect(typeof neverCalledSubject).toBe('function');
  });
});
