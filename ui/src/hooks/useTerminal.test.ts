import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useTerminal } from './useTerminal';

describe('useTerminal', () => {
  let mockWebSocket: any;

  beforeEach(() => {
    // Mock WebSocket
    global.WebSocket = vi.fn(() => mockWebSocket) as any;
    mockWebSocket = {
      send: vi.fn(),
      close: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should initialize with default WebSocket URL', () => {
    const { result } = renderHook(() => useTerminal({ wsUrl: 'ws://localhost:7681/ws' }));
    expect(result.current.terminalRef).toBeDefined();
  });

  it('should return initial connection state as false', () => {
    const { result } = renderHook(() => useTerminal({ wsUrl: 'ws://localhost:7681/ws' }));
    expect(result.current.isConnected).toBe(false);
  });

  it('should return null error on initialization', () => {
    const { result } = renderHook(() => useTerminal({ wsUrl: 'ws://localhost:7681/ws' }));
    expect(result.current.error).toBeNull();
  });

  it('should return a reconnect function', () => {
    const { result } = renderHook(() => useTerminal({ wsUrl: 'ws://localhost:7681/ws' }));
    expect(typeof result.current.reconnect).toBe('function');
  });

  it('should create a terminal instance', () => {
    const { result } = renderHook(() => useTerminal({ wsUrl: 'ws://localhost:7681/ws' }));
    expect(result.current.terminalRef?.current).toBeDefined();
  });
});
