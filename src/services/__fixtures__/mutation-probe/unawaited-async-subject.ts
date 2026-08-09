/**
 * Subject async function that is fired but not awaited by the test.
 * This demonstrates the "called-but-unobserved" mutation-probe shape:
 * the test only observes a synchronous token and never awaits the async result.
 */
export async function unawaitedAsyncSubject(): Promise<string> {
  await Promise.resolve();
  // Real async computation: return a deterministic value
  return 'async-result-42';
}

/**
 * Fires the async subject and forgets it, returning only a synchronous token.
 * The test only observes this return value, never the promise resolution.
 */
export function kickOff(): string {
  // LOAD-BEARING: The .catch(() => {}) handler is essential. Without it, an injected
  // throw inside unawaitedAsyncSubject becomes an unhandled promise rejection that bun's
  // test runner reports as a failure, converting this "called-unobserved" shape into
  // "called-observed" and destroying the fixture's ability to distinguish the two.
  void unawaitedAsyncSubject().catch(() => {});
  return 'sync-token-ok';
}
