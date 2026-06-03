import { describe, it, expect } from 'bun:test';
import { validateUiSpec } from '../escalation-ui-schema';

const opt = { type: 'OptionButton', optionId: 'a', label: 'A' };

describe('validateUiSpec', () => {
  it('returns null for null/undefined (ui is optional)', () => {
    expect(validateUiSpec(null)).toBeNull();
    expect(validateUiSpec(undefined)).toBeNull();
  });

  it('accepts a valid spec with a terminal action', () => {
    const spec = { elements: [{ type: 'Heading', text: 'Pick' }, opt] };
    const out = validateUiSpec(spec);
    expect(out).not.toBeNull();
    expect(out!.elements).toHaveLength(2);
  });

  it('rejects a spec with NO terminal action (unanswerable)', () => {
    const spec = { elements: [{ type: 'Text', text: 'just prose' }] };
    expect(validateUiSpec(spec)).toBeNull();
  });

  it('rejects unknown element types (closed catalog)', () => {
    const spec = { elements: [{ type: 'Html', html: '<script>x</script>' }, opt] };
    expect(validateUiSpec(spec)).toBeNull();
  });

  it('rejects unknown props on a known element (strict)', () => {
    const spec = { elements: [{ type: 'OptionButton', optionId: 'a', label: 'A', onClick: 'evil()' }] };
    expect(validateUiSpec(spec)).toBeNull();
  });

  it('enforces the ≤40 element size cap', () => {
    const elements = Array.from({ length: 41 }, (_, i) => ({ type: 'Text', text: `t${i}` }));
    elements.push(opt as any);
    expect(validateUiSpec({ elements })).toBeNull();
  });

  it('accepts Form as a terminal action', () => {
    const spec = { elements: [{ type: 'Form', fields: [{ name: 'why', label: 'Why' }] }] };
    expect(validateUiSpec(spec)).not.toBeNull();
  });

  it('accepts evidence components (DiffView/CompareTable/CodeBlock) alongside a terminal', () => {
    const spec = {
      elements: [
        { type: 'DiffView', filename: 'a.ts', before: 'x', after: 'y' },
        { type: 'CompareTable', columns: ['k'], rows: [['v']] },
        { type: 'CodeBlock', code: 'const x = 1' },
        opt,
      ],
    };
    expect(validateUiSpec(spec)).not.toBeNull();
  });
});
