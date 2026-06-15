/**
 * P6: sidecar-launch-via-WSL command builder.
 */
import { describe, it, expect } from 'bun:test';
import { buildWslSidecarCommand } from '../sidecar-launch.ts';

describe('buildWslSidecarCommand', () => {
  it('wraps bun run in wsl.exe -d <distro> -- bash -lc with cd + exec', () => {
    const { cmd, args } = buildWslSidecarCommand({
      distro: 'Ubuntu-24.04',
      repoWslPath: '/home/ben/mermaid-collab',
      runtime: { cmd: 'bun', args: ['run', 'src/server.ts'] },
      env: { PORT: '9002', HOST: '127.0.0.1' },
    });
    expect(cmd).toBe('wsl.exe');
    expect(args.slice(0, 5)).toEqual(['-d', 'Ubuntu-24.04', '--', 'bash', '-lc']);
    expect(args[5]).toBe(
      "export PORT='9002'; export HOST='127.0.0.1'; cd '/home/ben/mermaid-collab'; exec bun 'run' 'src/server.ts'",
    );
  });

  it('translates path-valued env vars Windows→WSL', () => {
    const { args } = buildWslSidecarCommand({
      distro: 'Ubuntu',
      repoWslPath: '/mnt/c/repo',
      runtime: { cmd: 'bun', args: ['run', 'src/server.ts'] },
      env: { PORT: '9002', MERMAID_RESOURCES_PATH: 'C:\\app\\resources' },
      pathKeys: ['MERMAID_RESOURCES_PATH'],
    });
    expect(args[5]).toContain("export MERMAID_RESOURCES_PATH='/mnt/c/app/resources'");
    expect(args[5]).toContain("cd '/mnt/c/repo'");
  });

  it('skips undefined env values and shell-quotes safely', () => {
    const { args } = buildWslSidecarCommand({
      distro: 'Ubuntu',
      repoWslPath: '/r',
      runtime: { cmd: 'bun', args: [] },
      env: { A: 'x', B: undefined, TOKEN: "a'b" },
    });
    expect(args[5]).toBe("export A='x'; export TOKEN='a'\\''b'; cd '/r'; exec bun");
    expect(args[5]).not.toContain('B=');
  });

  it('handles no env (just cd + exec)', () => {
    const { args } = buildWslSidecarCommand({
      distro: 'Ubuntu',
      repoWslPath: '/r',
      runtime: { cmd: 'mc-server', args: [] },
      env: {},
    });
    expect(args[5]).toBe("cd '/r'; exec mc-server");
  });
});
