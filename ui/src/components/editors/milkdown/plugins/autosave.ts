import type { MilkdownPlugin } from '@milkdown/ctx';
import { listener, listenerCtx } from '@milkdown/plugin-listener';
import type { MutableRefObject } from 'react';

export interface AutosavePluginOptions {
  docId?: string;
  onChange?: (md: string) => void;
  onPersist?: (md: string) => void;
  onFlushRef?: MutableRefObject<(() => void) | null>;
  onChangeRef?: MutableRefObject<((md: string) => void) | undefined | null>;
  onPersistRef?: MutableRefObject<((md: string) => void) | null>;
  delay?: number;
}

export interface DebouncedFn<Args extends unknown[]> {
  (...args: Args): void;
  flush: () => void;
  cancel: () => void;
}

export function createDebounced<Args extends unknown[]>(
  fn: (...args: Args) => void,
  delay: number,
): DebouncedFn<Args> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: Args | null = null;

  const debounced = ((...args: Args) => {
    lastArgs = args;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const a = lastArgs;
      lastArgs = null;
      if (a) fn(...a);
    }, delay);
  }) as DebouncedFn<Args>;

  debounced.flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (lastArgs) {
      const a = lastArgs;
      lastArgs = null;
      fn(...a);
    }
  };

  debounced.cancel = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    lastArgs = null;
  };

  return debounced;
}

export function autosavePlugin(opts: AutosavePluginOptions): MilkdownPlugin[] {
  const { onChange, onPersist, onFlushRef, onChangeRef: externalOnChangeRef, onPersistRef: externalOnPersistRef, delay = 500 } = opts;

  const instanceId = Symbol('autosave');

  const internalOnChangeRef: { current: ((md: string) => void) | undefined | null } = { current: onChange };
  const internalOnPersistRef: { current: ((md: string) => void) | null } = { current: onPersist ?? null };

  const onChangeRef = externalOnChangeRef ?? internalOnChangeRef;
  const onPersistRef = externalOnPersistRef ?? internalOnPersistRef;

  const debouncedPersist = createDebounced<[string]>((md) => {
    const fn = onPersistRef.current;
    if (fn) fn(md);
  }, delay);

  if (onFlushRef) {
    const flushFn = Object.assign(() => debouncedPersist.flush(), { __autosaveId: instanceId });
    onFlushRef.current = flushFn;
  }

  const configurePlugin: MilkdownPlugin = (ctx) => () => {
    ctx.get(listenerCtx).markdownUpdated((_ctx, markdown, prevMarkdown) => {
      if (markdown === prevMarkdown) return;
      onChangeRef.current?.(markdown);
      debouncedPersist(markdown);
    });

    return () => {
      debouncedPersist.cancel();
      if (onFlushRef && (onFlushRef.current as unknown as { __autosaveId?: symbol })?.__autosaveId === instanceId) {
        onFlushRef.current = null;
      }
    };
  };

  return [listener, configurePlugin].flat();
}

export default autosavePlugin;
