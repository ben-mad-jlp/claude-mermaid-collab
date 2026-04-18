export type EditorVariant = 'wysiwyg' | 'legacy';

export interface TelemetryEvent {
  editor_variant: EditorVariant;
  round_trip_drift_bytes?: number;
  autosave_latency_ms?: number;
  timestamp: number;
}

export type TelemetrySink = (evt: TelemetryEvent) => void;

declare global {
  interface Window {
    __telemetrySink?: TelemetrySink;
  }
}

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof performance !== 'undefined';
}

export function emitTelemetry(evt: TelemetryEvent): void {
  if (!isBrowser()) return;
  const sink: TelemetrySink =
    (typeof window !== 'undefined' && window.__telemetrySink) ||
    ((e: TelemetryEvent) => {
      // eslint-disable-next-line no-console
      console.debug('[telemetry]', e);
    });
  try {
    sink(evt);
  } catch {
    // swallow sink errors — telemetry must never break the editor
  }
}

export function nowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}
