import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ScreencastService } from '../screencast.js';

vi.mock('../cdp-session.js', () => ({
  ensureTab: vi.fn().mockResolvedValue('fake-target-id'),
}));

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
  beforeEach(() => { vi.clearAllMocks(); });

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
});
