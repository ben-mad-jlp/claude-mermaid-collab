// Minimal ambient declarations for `js-yaml`. The full type surface lives
// in `@types/js-yaml`, which is not installed in this project. We only use
// `load` / `dump` at the call sites, so a narrow shim keeps tsc strict
// without pulling additional dependencies.

declare module 'js-yaml' {
  export function load(input: string, options?: unknown): unknown;
  export function loadAll(input: string, iterator?: (doc: unknown) => void, options?: unknown): unknown[] | void;
  export function dump(obj: unknown, options?: unknown): string;
  export class YAMLException extends Error {
    constructor(reason?: string, mark?: unknown);
  }
  const _default: {
    load: typeof load;
    loadAll: typeof loadAll;
    dump: typeof dump;
    YAMLException: typeof YAMLException;
  };
  export default _default;
}
