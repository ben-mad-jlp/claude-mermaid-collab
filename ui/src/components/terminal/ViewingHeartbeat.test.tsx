import { render, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ViewingHeartbeat, VIEWING_HEARTBEAT_INTERVAL_MS } from './ViewingHeartbeat';
import { useSupervisorStore } from '@/stores/supervisorStore';

/**
 * ViewingHeartbeat — Part 1 (generation on desktop view). Verifies the terminal view
 * beats POST /api/zen/viewing (via pingViewing) while mounted + visible + session-bound,
 * and does NOT beat when hidden or unbound — preserving the interpret-pass cost floor.
 */

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
}

describe('ViewingHeartbeat', () => {
  let ping: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    ping = vi.fn();
    useSupervisorStore.setState({ pingViewing: ping });
    setVisibility('visible');
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    setVisibility('visible');
  });

  it('beats immediately on mount and again on the interval while visible + bound', () => {
    render(<ViewingHeartbeat serverId="srv" project="p" session="s" />);
    expect(ping).toHaveBeenCalledTimes(1); // immediate
    expect(ping).toHaveBeenLastCalledWith('srv');
    act(() => { vi.advanceTimersByTime(VIEWING_HEARTBEAT_INTERVAL_MS); });
    expect(ping).toHaveBeenCalledTimes(2);
    act(() => { vi.advanceTimersByTime(VIEWING_HEARTBEAT_INTERVAL_MS); });
    expect(ping).toHaveBeenCalledTimes(3);
  });

  it('does NOT beat when no session is bound (empty session)', () => {
    render(<ViewingHeartbeat serverId="srv" project="p" session="" />);
    act(() => { vi.advanceTimersByTime(VIEWING_HEARTBEAT_INTERVAL_MS * 2); });
    expect(ping).not.toHaveBeenCalled();
  });

  it('does NOT beat when disabled', () => {
    render(<ViewingHeartbeat serverId="srv" project="p" session="s" disabled />);
    act(() => { vi.advanceTimersByTime(VIEWING_HEARTBEAT_INTERVAL_MS * 2); });
    expect(ping).not.toHaveBeenCalled();
  });

  it('does NOT beat while the tab is hidden', () => {
    setVisibility('hidden');
    render(<ViewingHeartbeat serverId="srv" project="p" session="s" />);
    expect(ping).not.toHaveBeenCalled(); // immediate beat suppressed
    act(() => { vi.advanceTimersByTime(VIEWING_HEARTBEAT_INTERVAL_MS * 2); });
    expect(ping).not.toHaveBeenCalled(); // interval beats suppressed too
  });

  it('stops beating after unmount (heartbeat goes stale → interpret pass stops)', () => {
    const { unmount } = render(<ViewingHeartbeat serverId="srv" project="p" session="s" />);
    expect(ping).toHaveBeenCalledTimes(1);
    unmount();
    act(() => { vi.advanceTimersByTime(VIEWING_HEARTBEAT_INTERVAL_MS * 3); });
    expect(ping).toHaveBeenCalledTimes(1); // no further beats
  });
});
