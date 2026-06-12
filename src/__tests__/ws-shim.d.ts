/**
 * Minimal ambient types for the `ws` package, scoped to the two-server harness.
 *
 * The `ws` npm package ships no declarations resolvable from the ROOT tsconfig
 * (`types: ["bun-types"]`, no `@types/ws`; only `desktop/` has it). Rather than
 * add a root dependency, declare just the surface `two-server-harness.ts` uses so
 * `tsc --noEmit` stays clean. Loose-but-honest: enough to type the rig, no more.
 *
 * Shape matches ws v7 (the root dep): the default export IS the WebSocket class,
 * with the server class hung off it as the static `Server` (the named
 * `WebSocketServer` export only exists in v8).
 */
declare module 'ws' {
  import type { AddressInfo } from 'node:net';

  class WebSocketServer {
    constructor(opts: { port: number; host?: string });
    readonly clients: Set<WebSocket>;
    on(event: string, cb: (...args: any[]) => void): this;
    once(event: string, cb: (...args: any[]) => void): this;
    close(cb?: () => void): void;
    address(): AddressInfo | string;
  }

  class WebSocket {
    static readonly CLOSED: number;
    static readonly Server: typeof WebSocketServer;
    constructor(url: string);
    readonly readyState: number;
    on(event: string, cb: (...args: any[]) => void): this;
    once(event: string, cb: (...args: any[]) => void): this;
    send(data: string | Buffer, opts?: { binary?: boolean }): void;
    close(): void;
    terminate(): void;
  }

  export default WebSocket;
  export { WebSocket, WebSocketServer };
}
