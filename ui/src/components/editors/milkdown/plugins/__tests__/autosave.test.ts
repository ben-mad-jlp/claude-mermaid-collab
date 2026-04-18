import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createDebounced } from '../autosave';

describe('createDebounced', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('does not call fn before the delay elapses', () => {
    const fn = vi.fn();
    const d = createDebounced<[string]>(fn, 500);
    d('a');
    vi.advanceTimersByTime(499);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledWith('a');
  });

  it('collapses rapid calls into a single trailing call with the latest args', () => {
    const fn = vi.fn();
    const d = createDebounced<[string]>(fn, 500);
    d('a'); d('b'); d('c');
    vi.advanceTimersByTime(500);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('c');
  });

  it('flush() fires pending call immediately and clears the timer', () => {
    const fn = vi.fn();
    const d = createDebounced<[string]>(fn, 500);
    d('pending');
    d.flush();
    expect(fn).toHaveBeenCalledWith('pending');
    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('flush() is a no-op when nothing is pending', () => {
    const fn = vi.fn();
    const d = createDebounced<[string]>(fn, 500);
    d.flush();
    expect(fn).not.toHaveBeenCalled();
  });

  it('cancel() drops the pending call', () => {
    const fn = vi.fn();
    const d = createDebounced<[string]>(fn, 500);
    d('x');
    d.cancel();
    vi.advanceTimersByTime(1000);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('autosavePlugin module surface', () => {
  it('exports autosavePlugin and createDebounced', async () => {
    const mod = await import('../autosave');
    expect(typeof mod.autosavePlugin).toBe('function');
    expect(typeof mod.createDebounced).toBe('function');
  });
});

describe('autosavePlugin docId switch race', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  // Mirror the listener ctx shape: ctx.get(listenerCtx) returns an object with
  // markdownUpdated(cb) that registers a listener we can fire manually.
  function buildCtxStub() {
    let captured:
      | ((ctx: unknown, markdown: string, prevMarkdown: string) => void)
      | null = null;
    const listenerApi = {
      markdownUpdated(
        cb: (ctx: unknown, markdown: string, prevMarkdown: string) => void,
      ) {
        captured = cb;
        return listenerApi;
      },
    };
    const ctx = {
      get: (_key: unknown) => listenerApi,
    };
    return {
      ctx,
      fire: (md: string, prev = '') => {
        if (!captured) throw new Error('listener not registered');
        captured({}, md, prev);
      },
    };
  }

  // Run the Milkdown plugin lifecycle: each MilkdownPlugin is `(ctx) => () => cleanup`.
  // The autosavePlugin returns [listener, configurePlugin]; we only care about
  // configurePlugin (the last entry) for these tests.
  function runConfigurePlugin(
    plugins: ReturnType<typeof import('../autosave').autosavePlugin>,
    ctx: unknown,
  ): () => void {
    const configure = plugins[plugins.length - 1] as (
      c: unknown,
    ) => () => (() => void) | void;
    const cleanup = configure(ctx)();
    return typeof cleanup === 'function' ? cleanup : () => {};
  }

  it('cancel on teardown: pending persist is dropped, not flushed', async () => {
    const { autosavePlugin } = await import('../autosave');
    const onPersist = vi.fn();
    const { ctx, fire } = buildCtxStub();

    const plugins = autosavePlugin({ onPersist, delay: 500 });
    const teardown = runConfigurePlugin(plugins, ctx);

    fire('A-draft');
    vi.advanceTimersByTime(100);
    expect(onPersist).not.toHaveBeenCalled();

    teardown();

    vi.advanceTimersByTime(1000);
    expect(onPersist).not.toHaveBeenCalled();
  });

  it('instance-identity guard: tearing down A does not null B flush on shared onFlushRef', async () => {
    const { autosavePlugin } = await import('../autosave');
    const onFlushRef: { current: (() => void) | null } = { current: null };

    const ctxA = buildCtxStub();
    const pluginsA = autosavePlugin({
      onPersist: vi.fn(),
      onFlushRef,
      delay: 500,
    });
    const teardownA = runConfigurePlugin(pluginsA, ctxA.ctx);
    const flushAfterA = onFlushRef.current;
    expect(typeof flushAfterA).toBe('function');

    const ctxB = buildCtxStub();
    const pluginsB = autosavePlugin({
      onPersist: vi.fn(),
      onFlushRef,
      delay: 500,
    });
    runConfigurePlugin(pluginsB, ctxB.ctx);
    const flushAfterB = onFlushRef.current;
    expect(typeof flushAfterB).toBe('function');
    expect(flushAfterB).not.toBe(flushAfterA);

    teardownA();

    expect(onFlushRef.current).not.toBeNull();
    expect(onFlushRef.current).toBe(flushAfterB);
  });

  it.todo('latest-ref pattern for onPersist');
});
