import { describe, it, expect } from 'bun:test';
import { kickOff } from './unawaited-async-subject';

describe('mutation-probe: unawaited-async shape', () => {
  it('kickOff returns its synchronous token without observing unawaitedAsyncSubject', () => {
    const result = kickOff();
    expect(result).toBe('sync-token-ok');
  });
});
