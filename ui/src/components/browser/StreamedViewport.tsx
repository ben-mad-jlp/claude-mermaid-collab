import { useRef, useEffect } from 'react';
import type { ServerInfo } from '@/contexts/ServerContext';
import { getFrameClient } from '@/lib/serverFrameWs';

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

  useEffect(() => {
    const client = getFrameClient(server);
    let mounted = true;
    let sub: { unsubscribe(): void } | null = null;

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
      sub?.unsubscribe();
      client.unsubscribe('browser:' + session);
      // Do NOT call client.disconnect() — it's a shared client.
    };
  }, [session, server?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <canvas
      ref={canvasRef}
      className="flex-1 w-full h-full object-contain bg-black"
    />
  );
}
