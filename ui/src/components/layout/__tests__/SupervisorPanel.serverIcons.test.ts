import { describe, it, expect } from 'vitest';
import { localServerOf, buildServerIconMap, buildServerLabelMap } from '../SupervisorPanel';

// Bug 2e3efadd: supervised/watched cards are stamped with the 'local' SENTINEL,
// but the icon/label maps were keyed only by REAL server ids → get('local') missed
// and the card rendered the generic fallback icon. These assert the sentinel now
// resolves to the actual local server.

const local = { id: 'srv-uuid-abc', icon: 'Cpu', label: 'My Mac', source: 'local', host: '127.0.0.1' };
const remote = { id: 'srv-uuid-xyz', icon: 'Cloud', label: 'Remote', source: 'peer', host: '10.0.0.5' };

describe('SupervisorPanel server-icon resolution (2e3efadd)', () => {
  it('localServerOf prefers source==="local", falls back to loopback host', () => {
    expect(localServerOf([remote, local])?.id).toBe('srv-uuid-abc');
    expect(localServerOf([remote, { id: 'l2', label: 'L', host: 'localhost' }])?.id).toBe('l2');
    expect(localServerOf([remote])).toBeUndefined();
  });

  it('buildServerIconMap aliases the "local" sentinel to the local server icon', () => {
    const m = buildServerIconMap([remote, local]);
    expect(m.get('local')).toBe('Cpu'); // was undefined → fallback icon (the bug)
    expect(m.get('srv-uuid-abc')).toBe('Cpu'); // real id still works
    expect(m.get('srv-uuid-xyz')).toBe('Cloud');
  });

  it('buildServerLabelMap aliases "local" to the local server label', () => {
    expect(buildServerLabelMap([remote, local]).get('local')).toBe('My Mac');
  });

  it('no local server → no "local" alias (graceful)', () => {
    expect(buildServerIconMap([remote]).get('local')).toBeUndefined();
  });
});
