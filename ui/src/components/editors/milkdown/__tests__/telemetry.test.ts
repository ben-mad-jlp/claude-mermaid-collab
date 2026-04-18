import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { emitTelemetry, type TelemetryEvent } from '../plugins/telemetry';

describe('telemetry', () => {
  beforeEach(() => {
    delete (window as unknown as { __telemetrySink?: unknown }).__telemetrySink;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as unknown as { __telemetrySink?: unknown }).__telemetrySink;
  });

  it('falls back to console.debug by default', () => {
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const evt: TelemetryEvent = {
      editor_variant: 'wysiwyg',
      timestamp: 123,
    };
    emitTelemetry(evt);
    expect(spy).toHaveBeenCalledWith('[telemetry]', evt);
  });

  it('routes through window.__telemetrySink when present', () => {
    const sink = vi.fn();
    (window as unknown as { __telemetrySink: typeof sink }).__telemetrySink = sink;
    const evt: TelemetryEvent = {
      editor_variant: 'wysiwyg',
      autosave_latency_ms: 12,
      timestamp: 456,
    };
    emitTelemetry(evt);
    expect(sink).toHaveBeenCalledWith(evt);
  });

  it('emits round_trip_drift_bytes when provided', () => {
    const sink = vi.fn();
    (window as unknown as { __telemetrySink: typeof sink }).__telemetrySink = sink;
    emitTelemetry({
      editor_variant: 'legacy',
      round_trip_drift_bytes: 42,
      timestamp: 1,
    });
    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({ round_trip_drift_bytes: 42, editor_variant: 'legacy' }),
    );
  });

  it('swallows sink failures', () => {
    const sink = vi.fn(() => {
      throw new Error('sink boom');
    });
    (window as unknown as { __telemetrySink: typeof sink }).__telemetrySink = sink;
    expect(() =>
      emitTelemetry({ editor_variant: 'wysiwyg', timestamp: 0 }),
    ).not.toThrow();
    expect(sink).toHaveBeenCalled();
  });
});
