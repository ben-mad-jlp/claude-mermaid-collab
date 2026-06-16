/**
 * Shared CDP Input helpers — client-first, caller owns the connection lifecycle.
 * Used by both MCP browser_* tools (via withCDPSession) and the browser_input
 * WS inbound path (panel → server → CDP).
 */

export async function pressKey(client: any, key: string): Promise<void> {
  await client.Input.dispatchKeyEvent({ type: 'keyDown', key });
  await client.Input.dispatchKeyEvent({ type: 'keyUp', key });
}

export async function typeText(client: any, text: string): Promise<void> {
  for (const char of text) {
    await client.Input.dispatchKeyEvent({ type: 'keyDown', text: char, key: char });
    await client.Input.dispatchKeyEvent({ type: 'keyUp', text: char, key: char });
  }
}

export async function mouseMove(client: any, x: number, y: number): Promise<void> {
  await client.Input.dispatchMouseEvent({ type: 'mouseMoved', x, y });
}

export async function drag(client: any, sx: number, sy: number, tx: number, ty: number): Promise<void> {
  await client.Input.dispatchMouseEvent({ type: 'mousePressed', x: sx, y: sy, button: 'left', clickCount: 1 });
  await client.Input.dispatchMouseEvent({ type: 'mouseMoved', x: tx, y: ty, button: 'left' });
  await client.Input.dispatchMouseEvent({ type: 'mouseReleased', x: tx, y: ty, button: 'left', clickCount: 1 });
}

export async function click(
  client: any,
  x: number,
  y: number,
  button: 'left' | 'middle' | 'right' = 'left',
): Promise<void> {
  await client.Input.dispatchMouseEvent({ type: 'mousePressed', x, y, button, clickCount: 1 });
  await client.Input.dispatchMouseEvent({ type: 'mouseReleased', x, y, button, clickCount: 1 });
}

export async function scroll(
  client: any,
  x: number,
  y: number,
  deltaX: number,
  deltaY: number,
): Promise<void> {
  await client.Input.dispatchMouseEvent({ type: 'mouseWheel', x, y, deltaX, deltaY });
}

/**
 * Dispatch a key event with optional text, code, and modifier bitmask.
 * Sends keyDown then keyUp unless type is explicitly 'char' or 'keyUp'.
 */
export async function key(client: any, opts: {
  key: string;
  text?: string;
  code?: string;
  modifiers?: number;
  type?: 'keyDown' | 'keyUp' | 'char';
}): Promise<void> {
  const { key: keyName, text, code, modifiers, type = 'keyDown' } = opts;
  if (type === 'char') {
    await client.Input.dispatchKeyEvent({ type: 'char', key: keyName, text, unmodifiedText: text, code, modifiers });
  } else if (type === 'keyUp') {
    await client.Input.dispatchKeyEvent({ type: 'keyUp', key: keyName, text, code, modifiers });
  } else {
    await client.Input.dispatchKeyEvent({ type: 'keyDown', key: keyName, text, code, modifiers });
    await client.Input.dispatchKeyEvent({ type: 'keyUp', key: keyName, text, code, modifiers });
  }
}

/**
 * Dispatch a single mousePressed or mouseReleased event at (x, y).
 * Used by the panel path for individual down/up events from pointer input.
 */
export async function mousePress(
  client: any,
  x: number,
  y: number,
  eventType: 'down' | 'up',
  button: 'left' | 'middle' | 'right' = 'left',
): Promise<void> {
  const type = eventType === 'down' ? 'mousePressed' : 'mouseReleased';
  await client.Input.dispatchMouseEvent({ type, x, y, button, clickCount: 1 });
}
