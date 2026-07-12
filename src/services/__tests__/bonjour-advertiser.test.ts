import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import {
  startBonjourAdvertiser,
  stopBonjourAdvertiser,
  isLoopbackHost,
  type BonjourAdvertiserOptions,
  type ChildLike,
  type SpawnFn,
} from '../bonjour-advertiser';

describe('bonjour-advertiser', () => {
  beforeEach(() => {
    // Reset the module singleton between test cases
    stopBonjourAdvertiser();
  });

  afterEach(() => {
    // Clean up after each test
    stopBonjourAdvertiser();
  });

  test('isLoopbackHost recognizes localhost', () => {
    expect(isLoopbackHost('localhost')).toBe(true);
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('127.0.0.2')).toBe(true);
    expect(isLoopbackHost('::1')).toBe(true);
    expect(isLoopbackHost('::ffff:127.0.0.1')).toBe(true);
    expect(isLoopbackHost(undefined)).toBe(true);
    expect(isLoopbackHost(null)).toBe(true);
  });

  test('isLoopbackHost recognizes LAN IPs', () => {
    expect(isLoopbackHost('192.168.1.5')).toBe(false);
    expect(isLoopbackHost('0.0.0.0')).toBe(false);
    expect(isLoopbackHost('10.0.0.1')).toBe(false);
  });

  test('isLoopbackHost is case-insensitive', () => {
    expect(isLoopbackHost('LOCALHOST')).toBe(true);
    expect(isLoopbackHost('LocalHost')).toBe(true);
  });

  test('spawns with correct argv for LAN bind', () => {
    const spawnCalls: Array<{ cmd: string; args: string[] }> = [];
    const mockSpawn: SpawnFn = (cmd: string, args: string[]): ChildLike => {
      spawnCalls.push({ cmd, args });
      return {
        kill: () => true,
        pid: 12345,
      };
    };

    const consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    const result = startBonjourAdvertiser(
      { port: 9002, host: '0.0.0.0' },
      mockSpawn,
    );
    consoleSpy.mockRestore();

    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0]!.cmd).toBe('dns-sd');
    expect(spawnCalls[0]!.args).toContain('-R');
    expect(spawnCalls[0]!.args).toContain('_mermaidcollab._tcp');
    expect(spawnCalls[0]!.args).toContain('9002');
    expect(result).not.toBeNull();
  });

  test('loopback bind is a no-op', () => {
    const spawnCalls: Array<{ cmd: string; args: string[] }> = [];
    const mockSpawn: SpawnFn = (cmd: string, args: string[]): ChildLike => {
      spawnCalls.push({ cmd, args });
      return { kill: () => true };
    };

    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    const result = startBonjourAdvertiser(
      { port: 9002, host: '127.0.0.1' },
      mockSpawn,
    );
    warnSpy.mockRestore();

    expect(spawnCalls).toHaveLength(0);
    expect(result).toBeNull();
  });

  test('LAN IP advertises', () => {
    const spawnCalls: Array<{ cmd: string; args: string[] }> = [];
    const mockSpawn: SpawnFn = (cmd: string, args: string[]): ChildLike => {
      spawnCalls.push({ cmd, args });
      return {
        kill: () => true,
        pid: 12345,
      };
    };

    const consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    startBonjourAdvertiser(
      { port: 9002, host: '192.168.1.5' },
      mockSpawn,
    );
    consoleSpy.mockRestore();

    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0]!.cmd).toBe('dns-sd');
  });

  test('missing dns-sd does not throw', () => {
    const mockSpawn: SpawnFn = (cmd: string, args: string[]): ChildLike => {
      throw new Error('ENOENT: spawn dns-sd');
    };

    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    const result = startBonjourAdvertiser(
      { port: 9002, host: '0.0.0.0' },
      mockSpawn,
    );
    warnSpy.mockRestore();

    // Should not throw and should return null
    expect(result).toBeNull();
  });

  test('error event from child (e.g., ENOENT) does not throw', () => {
    let errorHandler: ((...args: any[]) => void) | null = null;
    const mockSpawn: SpawnFn = (cmd: string, args: string[]): ChildLike => {
      return {
        kill: () => true,
        on: (event: string, listener: (...args: any[]) => void) => {
          if (event === 'error') {
            errorHandler = listener;
          }
        },
        pid: 12345,
      };
    };

    const consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    startBonjourAdvertiser(
      { port: 9002, host: '0.0.0.0' },
      mockSpawn,
    );
    consoleSpy.mockRestore();

    // Trigger the error event
    expect(errorHandler).not.toBeNull();
    if (errorHandler) {
      const handler = errorHandler as (...args: any[]) => void;
      expect(() => {
        handler(new Error('ENOENT: spawn dns-sd'));
      }).not.toThrow();
    }
    warnSpy.mockRestore();
  });

  test('stop kills the held child', () => {
    const killCalls: number[] = [];
    const mockSpawn: SpawnFn = (cmd: string, args: string[]): ChildLike => {
      return {
        kill: () => {
          killCalls.push(1);
          return true;
        },
        pid: 12345,
      };
    };

    const consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    startBonjourAdvertiser(
      { port: 9002, host: '0.0.0.0' },
      mockSpawn,
    );
    consoleSpy.mockRestore();

    stopBonjourAdvertiser();
    expect(killCalls).toHaveLength(1);
  });

  test('double-stop is safe', () => {
    const killCalls: number[] = [];
    const mockSpawn: SpawnFn = (cmd: string, args: string[]): ChildLike => {
      return {
        kill: () => {
          killCalls.push(1);
          return true;
        },
        pid: 12345,
      };
    };

    const consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    startBonjourAdvertiser(
      { port: 9002, host: '0.0.0.0' },
      mockSpawn,
    );
    consoleSpy.mockRestore();

    stopBonjourAdvertiser();
    stopBonjourAdvertiser(); // Second call should not call kill again

    expect(killCalls).toHaveLength(1);
  });

  test('idempotent start returns the same child', () => {
    const spawnCalls: number[] = [];
    const mockSpawn: SpawnFn = (cmd: string, args: string[]): ChildLike => {
      spawnCalls.push(1);
      return {
        kill: () => true,
        pid: 12345,
      };
    };

    const consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    const first = startBonjourAdvertiser(
      { port: 9002, host: '0.0.0.0' },
      mockSpawn,
    );
    const second = startBonjourAdvertiser(
      { port: 9002, host: '0.0.0.0' },
      mockSpawn,
    );
    consoleSpy.mockRestore();

    expect(spawnCalls).toHaveLength(1); // spawn called only once
    expect(first).toBe(second); // same child returned
  });

  test('uses default name when not provided', () => {
    const spawnCalls: Array<{ cmd: string; args: string[] }> = [];
    const mockSpawn: SpawnFn = (cmd: string, args: string[]): ChildLike => {
      spawnCalls.push({ cmd, args });
      return { kill: () => true };
    };

    const consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    startBonjourAdvertiser(
      { port: 9002, host: '0.0.0.0' },
      mockSpawn,
    );
    consoleSpy.mockRestore();

    expect(spawnCalls[0]!.args).toContain('MermaidCollab');
  });

  test('uses custom name when provided', () => {
    const spawnCalls: Array<{ cmd: string; args: string[] }> = [];
    const mockSpawn: SpawnFn = (cmd: string, args: string[]): ChildLike => {
      spawnCalls.push({ cmd, args });
      return { kill: () => true };
    };

    const consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    startBonjourAdvertiser(
      { port: 9002, host: '0.0.0.0', name: 'MyService' },
      mockSpawn,
    );
    consoleSpy.mockRestore();

    expect(spawnCalls[0]!.args).toContain('MyService');
  });

  test('trims whitespace from custom name', () => {
    const spawnCalls: Array<{ cmd: string; args: string[] }> = [];
    const mockSpawn: SpawnFn = (cmd: string, args: string[]): ChildLike => {
      spawnCalls.push({ cmd, args });
      return { kill: () => true };
    };

    const consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    startBonjourAdvertiser(
      { port: 9002, host: '0.0.0.0', name: '  TrimMe  ' },
      mockSpawn,
    );
    consoleSpy.mockRestore();

    expect(spawnCalls[0]!.args).toContain('TrimMe');
  });

  test('uses default name when custom name is only whitespace', () => {
    const spawnCalls: Array<{ cmd: string; args: string[] }> = [];
    const mockSpawn: SpawnFn = (cmd: string, args: string[]): ChildLike => {
      spawnCalls.push({ cmd, args });
      return { kill: () => true };
    };

    const consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    startBonjourAdvertiser(
      { port: 9002, host: '0.0.0.0', name: '   ' },
      mockSpawn,
    );
    consoleSpy.mockRestore();

    expect(spawnCalls[0]!.args).toContain('MermaidCollab');
  });
});
