import { describe, it, expect } from 'vitest';
import { disambiguateProjectLabels } from '../SupervisorPanel';

describe('disambiguateProjectLabels', () => {
  it('uses the bare basename when it is unique', () => {
    const out = disambiguateProjectLabels(['/Users/me/Code/alpha', '/Users/me/Code/beta']);
    expect(out['/Users/me/Code/alpha']).toBe('alpha');
    expect(out['/Users/me/Code/beta']).toBe('beta');
  });

  it('parent-qualifies only the colliding basenames', () => {
    const out = disambiguateProjectLabels([
      '/Users/me/Code/build123d-ocp-mcp',
      '/repos/build123d-ocp-mcp',
      '/Users/me/Code/solo',
    ]);
    expect(out['/Users/me/Code/build123d-ocp-mcp']).toBe('Code/build123d-ocp-mcp');
    expect(out['/repos/build123d-ocp-mcp']).toBe('repos/build123d-ocp-mcp');
    expect(out['/Users/me/Code/solo']).toBe('solo'); // unique → bare
  });

  it('falls back to the full path when there is no parent segment', () => {
    const out = disambiguateProjectLabels(['/alpha', '/alpha']);
    // both collide but have no parent segment → bare basename (best effort)
    expect(out['/alpha']).toBe('alpha');
  });
});
