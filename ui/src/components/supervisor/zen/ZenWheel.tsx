import React, { useRef, useState, useCallback, useEffect } from 'react';
import { ZenSessionCard, type DaemonTotals } from './ZenSessionCard';
import type { SessionSummary, Escalation } from '@/stores/supervisorStore';

// ZenWheel — a USER-rotatable 3D carousel of session cards (recency-ordered around a
// ring). Static until you grab it: drag horizontally, scroll, or use ←/→ to spin the
// ring all the way around. The card facing front is upright + fully opaque; cards rotate
// away and fade as they turn to the back, so it reads as a wheel you turn to browse —
// not a screensaver. Toggle from the masonry grid; same ZenSessionCard primitive.

export interface ZenWheelItem {
  s: { project: string; session: string; serverId?: string };
  summary?: SessionSummary;
  escalation?: Escalation | null;
}

export interface ZenWheelProps {
  items: ZenWheelItem[];
  now: number;
  totalsByProject: Record<string, import('@/components/supervisor/PlanTotals').PlanTotals>;
  daemonByProject: Record<string, DaemonTotals>;
  onDecideEscalation: (serverId: string, id: string, optionId: string) => void;
  onAnswerPane: (serverId: string, project: string, session: string, value: string) => void;
  onOpen: (project: string, session: string, serverId: string) => void;
}

const CARD_W = 320; // px — fixed card width on the ring
const DRAG_THRESHOLD = 5; // px before a press becomes a rotate (so card clicks still work)

export const ZenWheel: React.FC<ZenWheelProps> = ({
  items,
  now,
  totalsByProject,
  daemonByProject,
  onDecideEscalation,
  onAnswerPane,
  onOpen,
}) => {
  const [rot, setRot] = useState(0); // degrees the ring is turned
  const drag = useRef<{ startX: number; startRot: number; moved: boolean } | null>(null);

  const n = Math.max(items.length, 1);
  const step = 360 / n;
  // Radius so cards sit side-by-side around the circumference without crowding.
  const radius = Math.max(420, Math.round(CARD_W / (2 * Math.tan(Math.PI / n))) + 40);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    drag.current = { startX: e.clientX, startRot: rot, moved: false };
  }, [rot]);

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const dx = e.clientX - d.startX;
      if (Math.abs(dx) > DRAG_THRESHOLD) d.moved = true;
      if (d.moved) setRot(d.startRot + dx * 0.3); // 0.3°/px
    };
    const up = () => { drag.current = null; };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, []);

  const onWheel = useCallback((e: React.WheelEvent) => {
    setRot((r) => r + (e.deltaY + e.deltaX) * 0.15);
  }, []);

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight') setRot((r) => r - step);
    else if (e.key === 'ArrowLeft') setRot((r) => r + step);
  }, [step]);

  return (
    <div
      role="listbox"
      tabIndex={0}
      aria-label="Session wheel — drag, scroll, or use arrow keys to rotate"
      onPointerDown={onPointerDown}
      onWheel={onWheel}
      onKeyDown={onKeyDown}
      className="relative h-full w-full select-none outline-none cursor-grab active:cursor-grabbing"
      style={{ perspective: '1400px' }}
      data-testid="zen-wheel"
    >
      <div
        className="absolute left-1/2 top-1/2"
        style={{
          transformStyle: 'preserve-3d',
          transform: `translate(-50%, -50%) rotateY(${-rot}deg)`,
          transition: drag.current?.moved ? 'none' : 'transform 250ms ease-out',
        }}
      >
        {items.map((it, i) => {
          const angle = i * step;
          // Effective angle from the viewer (-180..180): 0 = front, ±180 = back.
          const eff = ((angle - rot) % 360 + 540) % 360 - 180;
          const facing = Math.cos((eff * Math.PI) / 180); // 1 front … -1 back
          const opacity = Math.max(0.12, (facing + 1) / 2); // fade toward the back
          const isFront = Math.abs(eff) < step / 2;
          return (
            <div
              key={`${it.s.serverId}:${it.s.project}:${it.s.session}`}
              className="absolute top-1/2 left-1/2 transition-opacity duration-200"
              style={{
                width: CARD_W,
                marginLeft: -CARD_W / 2,
                marginTop: -120,
                transform: `rotateY(${angle}deg) translateZ(${radius}px)`,
                opacity,
                // Cards past ~90° face away — don't let them intercept clicks.
                pointerEvents: facing > 0.1 ? 'auto' : 'none',
                zIndex: Math.round(facing * 100),
              }}
            >
              <div className={isFront ? 'ring-2 ring-accent-400/60 rounded-2xl transition-shadow' : ''}>
                <ZenSessionCard
                  project={it.s.project}
                  session={it.s.session}
                  serverId={it.s.serverId ?? 'local'}
                  summary={it.summary}
                  totals={totalsByProject[it.s.project]}
                  daemon={daemonByProject[it.s.project]}
                  escalation={it.escalation}
                  now={now}
                  onDecideEscalation={onDecideEscalation}
                  onAnswerPane={onAnswerPane}
                  onOpen={onOpen}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ZenWheel;
