/**
 * composerDrop — a tiny singleton bridge so a file dropped ANYWHERE in the terminal
 * (the big xterm body, the chip rail, the composer) routes into the message
 * composer. The composer registers its drop processor on mount; the drawer's
 * body-level native drop listener forwards the DataTransfer here.
 *
 * Native listeners (not React synthetic onDrop) are used at the call sites because
 * OS file drops into a sandboxed Electron renderer don't reliably fire React's
 * synthetic drag events.
 */

type DropHandler = (dt: DataTransfer) => void;

let current: DropHandler | null = null;

/** The composer calls this on mount; returns an unregister fn for cleanup. */
export function registerComposerDrop(handler: DropHandler): () => void {
  current = handler;
  return () => { if (current === handler) current = null; };
}

/** Forward a dropped DataTransfer to the registered composer. Returns true if a
 *  composer was registered to handle it. */
export function routeComposerDrop(dt: DataTransfer): boolean {
  if (!current) return false;
  current(dt);
  return true;
}
