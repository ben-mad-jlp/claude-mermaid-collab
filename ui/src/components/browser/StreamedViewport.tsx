import { useRef, useEffect } from 'react';
import type { ServerInfo } from '@/contexts/ServerContext';
import { getFrameClient } from '@/lib/serverFrameWs';
import { canvasPointToFrac, cdpModifiers, isPrintable } from './streamedInput';

export interface FrameMeta {
  offsetTop: number;
  pageScaleFactor: number;
  deviceWidth: number;
  deviceHeight: number;
  timestamp?: number;
}

export function StreamedViewport({
  session,
  server,
  metaRef,
}: {
  session: string;
  server?: ServerInfo;
  metaRef?: React.MutableRefObject<FrameMeta | null>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastMetaRef = useRef<FrameMeta | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  function paint(dataB64: string) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (!imgRef.current) imgRef.current = new Image();
    const img = imgRef.current;
    img.onload = () => {
      if (!canvasRef.current) return;
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      ctx.drawImage(img, 0, 0);
    };
    img.src = 'data:image/jpeg;base64,' + dataB64;
  }

  const pendingMoveRef = useRef<{ xFrac: number; yFrac: number } | null>(null);
  const wheelAccumRef = useRef<{ x: number; y: number; pt: { xFrac: number; yFrac: number } } | null>(null);
  const rafIdRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const el: HTMLCanvasElement = canvas;
    const client = getFrameClient(server);
    const sessionKey = session;
    const send = (m: Record<string, unknown>) =>
      client.send({ type: 'browser_input', session: sessionKey, ...m });

    function flush() {
      rafIdRef.current = 0;
      if (pendingMoveRef.current) {
        const { xFrac, yFrac } = pendingMoveRef.current;
        send({ action: 'mouse', event: 'move', xFrac, yFrac });
        pendingMoveRef.current = null;
      }
      if (wheelAccumRef.current) {
        const { pt, x, y } = wheelAccumRef.current;
        send({ action: 'scroll', xFrac: pt.xFrac, yFrac: pt.yFrac, deltaX: x, deltaY: y });
        wheelAccumRef.current = null;
      }
    }

    function scheduleFlush() {
      if (!rafIdRef.current) {
        rafIdRef.current = requestAnimationFrame(flush);
      }
    }

    function onPointermove(e: PointerEvent) {
      pendingMoveRef.current = canvasPointToFrac(el, e.clientX, e.clientY);
      scheduleFlush();
    }

    function onPointerdown(e: PointerEvent) {
      e.preventDefault();
      el.focus();
      el.setPointerCapture?.(e.pointerId);
      const frac = canvasPointToFrac(el, e.clientX, e.clientY);
      const button = (['left', 'middle', 'right'] as const)[e.button] ?? 'left';
      send({ action: 'mouse', event: 'down', button, ...frac });
    }

    function onPointerup(e: PointerEvent) {
      const frac = canvasPointToFrac(el, e.clientX, e.clientY);
      const button = (['left', 'middle', 'right'] as const)[e.button] ?? 'left';
      send({ action: 'mouse', event: 'up', button, ...frac });
    }

    function onContextmenu(e: Event) {
      e.preventDefault();
    }

    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const pt = canvasPointToFrac(el, e.clientX, e.clientY);
      const prev = wheelAccumRef.current;
      wheelAccumRef.current = { pt, x: (prev?.x ?? 0) + e.deltaX, y: (prev?.y ?? 0) + e.deltaY };
      scheduleFlush();
    }

    function onKeydown(e: KeyboardEvent) {
      e.preventDefault();
      send({
        action: 'key',
        keyType: 'keyDown',
        key: e.key,
        code: e.code,
        text: isPrintable(e.key) ? e.key : undefined,
        modifiers: cdpModifiers(e),
      });
    }

    function onKeyup(e: KeyboardEvent) {
      e.preventDefault();
      send({
        action: 'key',
        keyType: 'keyUp',
        key: e.key,
        code: e.code,
        text: isPrintable(e.key) ? e.key : undefined,
        modifiers: cdpModifiers(e),
      });
    }

    canvas.addEventListener('pointermove', onPointermove);
    canvas.addEventListener('pointerdown', onPointerdown);
    canvas.addEventListener('pointerup', onPointerup);
    canvas.addEventListener('contextmenu', onContextmenu);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('keydown', onKeydown);
    canvas.addEventListener('keyup', onKeyup);

    return () => {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = 0;
      canvas.removeEventListener('pointermove', onPointermove);
      canvas.removeEventListener('pointerdown', onPointerdown);
      canvas.removeEventListener('pointerup', onPointerup);
      canvas.removeEventListener('contextmenu', onContextmenu);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('keydown', onKeydown);
      canvas.removeEventListener('keyup', onKeyup);
    };
  }, [session, server?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const client = getFrameClient(server);
    let mounted = true;
    let sub: { unsubscribe(): void } | null = null;

    const reconn = client.onConnect(() => {
      client.subscribe('browser:' + session);
      const c = canvasRef.current;
      if (c && c.clientWidth > 0) {
        client.send({
          type: 'browser_resize', session,
          width: Math.round(c.clientWidth),
          height: Math.round(c.clientHeight),
          deviceScaleFactor: Math.min(window.devicePixelRatio || 1, 2),
        });
      }
    });

    client.connect().then(() => {
      if (!mounted) return;
      client.subscribe('browser:' + session);
      sub = client.onMessage((msg) => {
        if (msg.type !== 'browser_frame') return;
        const frame = msg as unknown as {
          type: 'browser_frame';
          session: string;
          data: string;
          meta: FrameMeta;
        };
        if (frame.session !== session) return;
        lastMetaRef.current = frame.meta;
        if (metaRef) metaRef.current = frame.meta;
        paint(frame.data);
      });
    });

    return () => {
      mounted = false;
      reconn.unsubscribe();
      sub?.unsubscribe();
      client.unsubscribe('browser:' + session);
      // Do NOT call client.disconnect() — it's a shared client.
    };
  }, [session, server?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const client = getFrameClient(server);
    let raf = 0;
    const report = () => {
      raf = 0;
      const w = Math.round(canvas.clientWidth);
      const h = Math.round(canvas.clientHeight);
      if (w > 0 && h > 0) {
        client.send({
          type: 'browser_resize', session, width: w, height: h,
          deviceScaleFactor: Math.min(window.devicePixelRatio || 1, 2),
        });
      }
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(report); };
    const ro = new ResizeObserver(schedule);
    ro.observe(canvas);
    schedule();
    return () => { ro.disconnect(); if (raf) cancelAnimationFrame(raf); };
  }, [session, server?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="relative flex-1 min-h-0">
      <canvas
        ref={canvasRef}
        tabIndex={0}
        className="absolute inset-0 w-full h-full object-contain bg-black outline-none"
      />
      <div className="absolute top-1 right-1 flex items-center gap-1 opacity-60 hover:opacity-100 text-2xs">
        <select
          aria-label="Stream quality"
          onChange={(e) =>
            getFrameClient(server).send({
              type: 'browser_quality', session, quality: Number(e.target.value),
            })
          }
          defaultValue="60"
          className="bg-black/60 text-white rounded px-1 py-0.5"
        >
          <option value="40">Low</option>
          <option value="60">Med</option>
          <option value="85">High</option>
        </select>
        <select
          aria-label="Stream fps"
          onChange={(e) =>
            getFrameClient(server).send({
              type: 'browser_quality', session, everyNthFrame: Number(e.target.value),
            })
          }
          defaultValue="1"
          className="bg-black/60 text-white rounded px-1 py-0.5"
        >
          <option value="1">High fps</option>
          <option value="2">Med fps</option>
          <option value="4">Low fps</option>
        </select>
      </div>
    </div>
  );
}
