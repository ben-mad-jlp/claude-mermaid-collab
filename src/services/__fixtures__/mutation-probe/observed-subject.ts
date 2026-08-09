/**
 * Subject async function whose result is awaited and asserted by the test.
 * This demonstrates the "called-and-observed" mutation-probe shape (positive control):
 * both neutering the body and injecting a throw are observable as failing assertions.
 */
export async function observedSubject(n: number): Promise<number> {
  await Promise.resolve();
  // Real async computation: deterministic transform of the input
  return n * 2 + 10;
}
