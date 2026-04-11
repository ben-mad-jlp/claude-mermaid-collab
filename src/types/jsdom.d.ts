// Minimal ambient declaration for `jsdom`.
//
// The `jsdom` npm package does not ship type definitions, and `@types/jsdom`
// is not installed in this project. We use a single feature (the `JSDOM`
// class with its `.window` property) in `src/services/dom-setup.ts`, so a
// tiny shim is enough to keep tsc strict-clean without pulling in the full
// third-party `@types/jsdom` tree.

declare module 'jsdom' {
  export class JSDOM {
    constructor(html?: string, options?: unknown);
    readonly window: any;
  }
}
