import { describe, it, expect, afterEach, vi } from 'vitest';
import { mark, measureBetween } from '../perf-bus';

describe('perf-bus', () => {
  const origMark = performance.mark;
  const origMeasure = performance.measure;

  afterEach(() => {
    // Restore originals
    (performance as any).mark = origMark;
    (performance as any).measure = origMeasure;
    vi.restoreAllMocks();
  });

  describe('mark', () => {
    it('calls performance.mark when available', () => {
      const spy = vi.fn();
      (performance as any).mark = spy;
      mark('code-click');
      expect(spy).toHaveBeenCalledWith('code-click');
    });

    it('is a no-op when performance.mark is unavailable (guard works)', () => {
      (performance as any).mark = undefined;
      expect(() => mark('code-click')).not.toThrow();
    });

    it('swallows errors thrown by performance.mark', () => {
      (performance as any).mark = () => {
        throw new Error('boom');
      };
      expect(() => mark('prose-mounted')).not.toThrow();
    });
  });

  describe('measureBetween', () => {
    it('calls performance.measure when available', () => {
      (performance as any).mark = vi.fn();
      const measureSpy = vi.fn();
      (performance as any).measure = measureSpy;
      measureBetween('m', 'code-fetch-start', 'code-fetch-end');
      expect(measureSpy).toHaveBeenCalledWith('m', 'code-fetch-start', 'code-fetch-end');
    });

    it('swallows errors (e.g. missing start mark)', () => {
      (performance as any).mark = vi.fn();
      (performance as any).measure = () => {
        throw new Error('missing mark');
      };
      expect(() =>
        measureBetween('m', 'code-fetch-start', 'code-fetch-end')
      ).not.toThrow();
    });

    it('is a no-op when performance.measure is unavailable', () => {
      (performance as any).mark = vi.fn();
      (performance as any).measure = undefined;
      expect(() =>
        measureBetween('m', 'code-fetch-start', 'code-fetch-end')
      ).not.toThrow();
    });
  });
});
