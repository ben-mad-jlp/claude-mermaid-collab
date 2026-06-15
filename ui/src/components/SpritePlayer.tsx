import React, { useEffect, useRef, useState } from 'react';

interface FrameRect { index: number; x: number; y: number; w: number; h: number }
interface SheetManifest {
  frameWidth: number; frameHeight: number; columns: number; rows: number;
  count: number; fps: number; frames: FrameRect[];
  /** directional sheets: cols = animation frames per row, angles = rows */
  cols?: number; angles?: number;
}

export interface SpritePlayerProps {
  atlasUrl: string;
  manifest: SheetManifest;
}

/** Canvas sprite-sheet player: plays an atlas via its manifest frame rects. For directional
 *  sheets (rows=angles, cols=frames) you can pick the facing row. */
export const SpritePlayer: React.FC<SpritePlayerProps> = ({ atlasUrl, manifest }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(true);
  const [fps, setFps] = useState(manifest.fps && manifest.fps > 0 ? manifest.fps : 10);
  const [angle, setAngle] = useState(0);

  const directional = !!(manifest.cols && manifest.angles && manifest.angles > 1);
  const perRow = directional ? manifest.cols! : manifest.count;
  const rowStart = directional ? angle * manifest.cols! : 0;

  useEffect(() => {
    const img = new Image();
    img.onload = () => { imgRef.current = img; setReady(true); };
    img.src = atlasUrl;
  }, [atlasUrl]);

  useEffect(() => {
    if (!ready || !playing) return;
    let frame = 0; let raf = 0; let last = 0;
    const cw = manifest.frameWidth, ch = manifest.frameHeight;
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      if (t - last < 1000 / fps) return;
      last = t;
      const canvas = canvasRef.current; const img = imgRef.current;
      if (!canvas || !img) return;
      const ctx = canvas.getContext('2d'); if (!ctx) return;
      const fr = manifest.frames[rowStart + (frame % perRow)] ?? manifest.frames[0];
      ctx.clearRect(0, 0, cw, ch);
      (ctx as any).imageSmoothingEnabled = false;
      ctx.drawImage(img, fr.x, fr.y, fr.w, fr.h, 0, 0, cw, ch);
      frame++;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [ready, playing, fps, rowStart, perRow, manifest]);

  return (
    <div className="flex flex-col items-center gap-3">
      <canvas
        ref={canvasRef}
        width={manifest.frameWidth}
        height={manifest.frameHeight}
        className="border border-gray-300 dark:border-gray-700 bg-[conic-gradient(#0001_90deg,transparent_90deg_180deg,#0001_180deg_270deg,transparent_270deg)] bg-[length:16px_16px]"
        style={{ width: Math.min(384, manifest.frameWidth * 3), height: 'auto', imageRendering: 'pixelated' }}
      />
      <div className="flex items-center gap-3 text-xs">
        <button
          onClick={() => setPlaying((p) => !p)}
          className="px-3 py-1.5 rounded bg-info-600 text-white hover:bg-info-700"
        >{playing ? '⏸ Pause' : '▶ Play'}</button>
        <label className="flex items-center gap-1 text-gray-600 dark:text-gray-300">
          fps
          <input type="range" min={1} max={24} value={fps} onChange={(e) => setFps(Number(e.target.value))} />
          <span className="w-6 tabular-nums">{fps}</span>
        </label>
        {directional && (
          <label className="flex items-center gap-1 text-gray-600 dark:text-gray-300">
            angle
            <input type="range" min={0} max={manifest.angles! - 1} value={angle} onChange={(e) => setAngle(Number(e.target.value))} />
            <span className="tabular-nums">{angle + 1}/{manifest.angles}</span>
          </label>
        )}
      </div>
    </div>
  );
};

export default SpritePlayer;
