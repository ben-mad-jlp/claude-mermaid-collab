import { useRef, useEffect, useState } from 'react';
import type { ServerInfo } from '@/contexts/ServerContext';
import { getFrameClient } from '@/lib/serverFrameWs';
import { canvasPointToFrac, cdpModifiers, isPrintable } from './streamedInput';
import { LatencySampler } from './latencyStats';

export interface FrameMeta {
  offsetTop: number;
  pageScaleFactor: number;
  deviceWidth: number;
  deviceHeight: number;
  timestamp?: number;
  /** Server wall-clock at frame emit — for frame-delivery latency on a local
   *  same-clock owned-Chrome (9b8adcea). */
  sentAt?: number;
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

  // Latency instrumentation (9b8adcea): frame-delivery (server emit → canvas paint)
  // and input round-trip (mousedown send → server dispatch ack). p50/p95 read off the
  // overlay; valid only against a LOCAL same-clock owned-Chrome.
  const frameLatRef = useRef(new LatencySampler());
  const inputLatRef = useRef(new LatencySampler());
  const inputSeqRef = useRef(0);
  const inputPendingRef = useRef(new Map<number, number>());
  const [showStats, setShowStats] = useState(false);
  const [stats, setStats] = useState<{ fp50: number | null; fp95: number | null; fn: number; ip50: number | null; ip95: number | null; in: number }>({ fp50: null, fp95: null, fn: 0, ip50: null, ip95: null, in: 0 });

  function paint(dataB64: string, sentAt?: number) {
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
      // Painted now — record delivery latency vs the server emit time.
      if (sentAt != null) frameLatRef.current.push(Date.now() - sentAt);
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
      // Tag mousedown with a correlation id so the server acks it → input RTT.
      const inputId = ++inputSeqRef.current;
      inputPendingRef.current.set(inputId, Date.now());
      send({ action: 'mouse', event: 'down', button, inputId, ...frac });
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
        // Input-ack → record round-trip latency for the matching mousedown.
        if (msg.type === 'browser_input_ack') {
          const ack = msg as unknown as { session: string; inputId: number };
          if (ack.session !== session) return;
          const sent = inputPendingRef.current.get(ack.inputId);
          if (sent != null) {
            inputLatRef.current.push(Date.now() - sent);
            inputPendingRef.current.delete(ack.inputId);
          }
          return;
        }
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
        paint(frame.data, frame.meta?.sentAt);
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

  // Refresh the latency readout while the overlay is open.
  useEffect(() => {
    if (!showStats) return;
    const tick = () => {
      const f = frameLatRef.current, i = inputLatRef.current;
      setStats({ fp50: f.p50(), fp95: f.p95(), fn: f.count, ip50: i.p50(), ip95: i.p95(), in: i.count });
    };
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [showStats]);

  const fmt = (v: number | null) => (v == null ? '—' : `${Math.round(v)}ms`);

  return (
    <div className="relative flex-1 min-h-0">
      <canvas
        ref={canvasRef}
        tabIndex={0}
        className="absolute inset-0 w-full h-full object-contain bg-black outline-none"
      />
      {/* Latency overlay (9b8adcea) — frame-delivery + input RTT p50/p95. */}
      <div className="absolute bottom-1 left-1 text-2xs">
        <button
          type="button"
          data-testid="latency-toggle"
          onClick={() => setShowStats((v) => !v)}
          className="bg-black/60 text-white rounded px-1 py-0.5 opacity-50 hover:opacity-100"
          title="Toggle frame/input latency readout"
        >
          {showStats ? 'lat ▾' : 'lat'}
        </button>
        {showStats && (
          <div className="mt-1 bg-black/70 text-white rounded px-2 py-1 font-mono leading-tight" data-testid="latency-readout">
            <div>frame Δ: p50 {fmt(stats.fp50)} · p95 {fmt(stats.fp95)} · n={stats.fn}</div>
            <div>input ⤺: p50 {fmt(stats.ip50)} · p95 {fmt(stats.ip95)} · n={stats.in}</div>
            <button
              type="button"
              onClick={() => { frameLatRef.current.reset(); inputLatRef.current.reset(); setStats({ fp50: null, fp95: null, fn: 0, ip50: null, ip95: null, in: 0 }); }}
              className="mt-0.5 underline opacity-70 hover:opacity-100"
            >reset</button>
          </div>
        )}
      </div>
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
