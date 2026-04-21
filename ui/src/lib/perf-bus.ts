export type PerfMark =
  | 'code-click'
  | 'code-fetch-start'
  | 'code-fetch-end'
  | 'code-first-paint'
  | 'prose-toggle'
  | 'prose-mounted';

function hasPerformanceMark(): boolean {
  return typeof performance !== 'undefined' && typeof performance.mark === 'function';
}

export function mark(name: PerfMark): void {
  if (!hasPerformanceMark()) return;
  try {
    performance.mark(name);
  } catch {
    /* noop */
  }
}

export function measureBetween(name: string, startMark: PerfMark, endMark: PerfMark): void {
  if (!hasPerformanceMark() || typeof performance.measure !== 'function') return;
  try {
    performance.measure(name, startMark, endMark);
  } catch {
    /* noop — missing start mark, etc. */
  }
}
