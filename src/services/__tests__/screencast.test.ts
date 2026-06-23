import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ScreencastService } from '../screencast.js';
import { ensureTab } from '../cdp-session.js';

vi.mock('../cdp-session.js', () => ({
  ensureTab: vi.fn().mockResolvedValue('fake-target-id'),
}));

const ensureTabMock = vi.mocked(ensureTab);

/** A promise plus its resolver, for opening a controllable "mid-start" window. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

function makeFakeClient() {
  const pageEnable             = vi.fn().mockResolvedValue(undefined);
  const pageStartScreencast    = vi.fn().mockResolvedValue(undefined);
  const pageStopScreencast     = vi.fn().mockResolvedValue(undefined);
  const pageScreencastFrame    = vi.fn();
  const pageScreencastFrameAck = vi.fn().mockResolvedValue(undefined);
  const emulationSetDMO        = vi.fn().mockResolvedValue(undefined);
  const clientClose            = vi.fn().mockResolvedValue(undefined);
  return {
    Page: {
      enable:             pageEnable,
      startScreencast:    pageStartScreencast,
      stopScreencast:     pageStopScreencast,
      screencastFrame:    pageScreencastFrame,
      screencastFrameAck: pageScreencastFrameAck,
    },
    Emulation: {
      setDeviceMetricsOverride: emulationSetDMO,
    },
    close: clientClose,
    _spies: { pageEnable, pageStartScreencast, pageStopScreencast, pageScreencastFrame, emulationSetDMO, clientClose },
  };
}

function makeService() {
  const fakeClient = makeFakeClient();
  const cdpImpl = vi.fn().mockResolvedValue(fakeClient);
  const svc = new ScreencastService({ cdpPort: 9333, cdpImpl });
  return { svc, fakeClient, cdpImpl };
}

describe('ScreencastService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ensureTabMock.mockResolvedValue('fake-target-id');
  });

  it('subscribe starts screencast; last unsubscribe stops it', async () => {
    const { svc, fakeClient } = makeService();

    const unsub = await svc.subscribe('s1', vi.fn());

    expect(fakeClient._spies.pageEnable).toHaveBeenCalledOnce();
    expect(fakeClient._spies.pageStartScreencast).toHaveBeenCalledOnce();
    expect(fakeClient._spies.pageStartScreencast).toHaveBeenCalledWith(
      expect.objectContaining({ format: 'jpeg' })
    );

    unsub();
    await new Promise(r => setTimeout(r, 0));
    expect(fakeClient._spies.pageStopScreencast).toHaveBeenCalledOnce();
    expect(fakeClient._spies.clientClose).toHaveBeenCalledOnce();
  });

  it('second subscriber does not re-start screencast', async () => {
    const { svc, fakeClient } = makeService();
    await svc.subscribe('s1', vi.fn());
    await svc.subscribe('s1', vi.fn());
    expect(fakeClient._spies.pageStartScreencast).toHaveBeenCalledOnce();
  });

  it('setViewport calls setDeviceMetricsOverride and restarts with new dims', async () => {
    const { svc, fakeClient } = makeService();
    await svc.subscribe('s1', vi.fn());

    fakeClient._spies.pageStartScreencast.mockClear();
    fakeClient._spies.pageStopScreencast.mockClear();
    fakeClient._spies.emulationSetDMO.mockClear();

    await svc.setViewport('s1', { width: 800, height: 600 });

    expect(fakeClient._spies.pageStopScreencast).toHaveBeenCalledOnce();
    expect(fakeClient._spies.emulationSetDMO).toHaveBeenCalledOnce();
    expect(fakeClient._spies.emulationSetDMO).toHaveBeenCalledWith(
      expect.objectContaining({ width: 800, height: 600, mobile: false })
    );
    expect(fakeClient._spies.pageStartScreencast).toHaveBeenCalledOnce();
    expect(fakeClient._spies.pageStartScreencast).toHaveBeenCalledWith(
      expect.objectContaining({ maxWidth: 800, maxHeight: 600 })
    );
    expect(fakeClient._spies.pageEnable).toHaveBeenCalledOnce();
  });

  it('setViewport coalesces identical dimensions (no extra restart)', async () => {
    const { svc, fakeClient } = makeService();
    await svc.subscribe('s1', vi.fn());
    await svc.setViewport('s1', { width: 800, height: 600 });

    fakeClient._spies.pageStopScreencast.mockClear();
    fakeClient._spies.pageStartScreencast.mockClear();

    await svc.setViewport('s1', { width: 800, height: 600 });

    expect(fakeClient._spies.pageStopScreencast).not.toHaveBeenCalled();
    expect(fakeClient._spies.pageStartScreencast).not.toHaveBeenCalled();
  });

  it('setQuality restarts screencast with new quality without dropping subscribers', async () => {
    const { svc, fakeClient } = makeService();
    await svc.subscribe('s1', vi.fn());

    fakeClient._spies.pageStartScreencast.mockClear();
    fakeClient._spies.pageStopScreencast.mockClear();

    await svc.setQuality('s1', { quality: 85, everyNthFrame: 2 });

    expect(fakeClient._spies.pageStopScreencast).toHaveBeenCalledOnce();
    expect(fakeClient._spies.pageStartScreencast).toHaveBeenCalledOnce();
    expect(fakeClient._spies.pageStartScreencast).toHaveBeenCalledWith(
      expect.objectContaining({ quality: 85, everyNthFrame: 2 })
    );
    expect(svc.activeSessions()).toContain('s1');
    expect(svc.isAlive()).toBe(true);
  });

  it('setViewport and setQuality are safe no-ops for unknown sessions', async () => {
    const { svc } = makeService();
    await expect(svc.setViewport('ghost', { width: 100, height: 100 })).resolves.toBeUndefined();
    await expect(svc.setQuality('ghost', { quality: 60 })).resolves.toBeUndefined();
  });

  it('screencastFrame is fanned out to all subscribers', async () => {
    const { svc, fakeClient } = makeService();
    const sink1 = vi.fn();
    const sink2 = vi.fn();
    await svc.subscribe('s1', sink1);
    await svc.subscribe('s1', sink2);

    expect(fakeClient._spies.pageStartScreencast).toHaveBeenCalledOnce();

    const cb = fakeClient._spies.pageScreencastFrame.mock.calls[0][0];
    cb({ data: 'base64data', metadata: { timestamp: 1 }, sessionId: 42 });

    expect(sink1).toHaveBeenCalledWith({ data: 'base64data', metadata: { timestamp: 1 }, sessionName: 's1' });
    expect(sink2).toHaveBeenCalledWith({ data: 'base64data', metadata: { timestamp: 1 }, sessionName: 's1' });
  });

  it('setViewport requested while screencast is starting is applied after start', async () => {
    const { svc, fakeClient } = makeService();
    // Hold the start mid-flight by deferring ensureTab so entry.starting stays pending.
    const gate = deferred<string>();
    ensureTabMock.mockReturnValue(gate.promise);

    const subPromise = svc.subscribe('s1', vi.fn()); // do NOT await — start is in-flight
    const vpPromise = svc.setViewport('s1', { width: 1024, height: 768 });

    gate.resolve('fake-target-id'); // let the start complete
    await Promise.all([subPromise, vpPromise]);

    // The mid-start resize must have been applied (a restart with the panel dims).
    expect(fakeClient._spies.emulationSetDMO).toHaveBeenCalledWith(
      expect.objectContaining({ width: 1024, height: 768, mobile: false })
    );
    const startCalls = fakeClient._spies.pageStartScreencast.mock.calls;
    const lastStart = startCalls[startCalls.length - 1][0];
    expect(lastStart).toMatchObject({ maxWidth: 1024, maxHeight: 768 });
  });

  it('setQuality requested while screencast is starting is applied after start', async () => {
    const { svc, fakeClient } = makeService();
    const gate = deferred<string>();
    ensureTabMock.mockReturnValue(gate.promise);

    const subPromise = svc.subscribe('s1', vi.fn());
    const qPromise = svc.setQuality('s1', { quality: 85 });

    gate.resolve('fake-target-id');
    await Promise.all([subPromise, qPromise]);

    const startCalls = fakeClient._spies.pageStartScreencast.mock.calls;
    const lastStart = startCalls[startCalls.length - 1][0];
    expect(lastStart).toMatchObject({ quality: 85 });
  });

  it('setViewport scales maxWidth/maxHeight by deviceScaleFactor', async () => {
    const { svc, fakeClient } = makeService();
    await svc.subscribe('s1', vi.fn());

    fakeClient._spies.pageStartScreencast.mockClear();
    fakeClient._spies.emulationSetDMO.mockClear();

    await svc.setViewport('s1', { width: 800, height: 600, deviceScaleFactor: 2 });

    expect(fakeClient._spies.emulationSetDMO).toHaveBeenCalledWith(
      expect.objectContaining({ width: 800, height: 600, deviceScaleFactor: 2, mobile: false })
    );
    // Bitmap is CSS px * dsf, so the JPEG cap must be the device-px size.
    expect(fakeClient._spies.pageStartScreencast).toHaveBeenCalledWith(
      expect.objectContaining({ maxWidth: 1600, maxHeight: 1200 })
    );
  });
});
