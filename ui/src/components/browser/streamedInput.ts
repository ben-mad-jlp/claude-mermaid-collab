export interface InputFrac {
  xFrac: number;
  yFrac: number;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export function canvasPointToFrac(
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number
): InputFrac {
  if (!canvas.width || !canvas.height) return { xFrac: 0, yFrac: 0 };
  const rect = canvas.getBoundingClientRect();
  const scale = Math.min(rect.width / canvas.width, rect.height / canvas.height);
  const dispW = canvas.width * scale;
  const dispH = canvas.height * scale;
  const offX = rect.left + (rect.width - dispW) / 2;
  const offY = rect.top + (rect.height - dispH) / 2;
  return {
    xFrac: clamp01((clientX - offX) / dispW),
    yFrac: clamp01((clientY - offY) / dispH),
  };
}

export function cdpModifiers(e: {
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}): number {
  return (e.altKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.metaKey ? 4 : 0) | (e.shiftKey ? 8 : 0);
}

export function isPrintable(key: string): boolean {
  return key.length === 1;
}
