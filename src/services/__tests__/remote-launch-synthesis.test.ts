import { describe, it, expect } from 'vitest';
import {
  generateAuthToken,
  synthesizeStartCommand,
  applyTokenToCommand,
} from '../remote-launch';

// The security invariant under test: a remote launch binds 0.0.0.0 (reachable
// off-box), so every synthesized start command MUST also set MERMAID_AUTH_TOKEN
// — otherwise the server comes up OPEN on the LAN. These cover the only seam
// testable without a real SSH session (the pure command synthesis + threading).

describe('remote-launch command synthesis', () => {
  it('generates a non-trivial hex token, fresh each call', () => {
    const a = generateAuthToken();
    const b = generateAuthToken();
    expect(a).toMatch(/^[0-9a-f]{48}$/);
    expect(a).not.toBe(b);
  });

  it('global mermaid-collab path sets BOTH bind-host and token', () => {
    const { suggestedCommand } = synthesizeStartCommand({
      port: 9002, token: 'TOK', mc: '/usr/bin/mermaid-collab', cache: '', bun: '', snapBun: false,
    });
    expect(suggestedCommand).toContain('MERMAID_AUTH_TOKEN=TOK');
    expect(suggestedCommand).toContain('MERMAID_BIND_HOST=0.0.0.0');
    expect(suggestedCommand).toContain('--port 9002');
  });

  it('plugin-cache + bun path sets BOTH bind-host and token', () => {
    const { suggestedCommand } = synthesizeStartCommand({
      port: 1234, token: 'TOK', mc: '', cache: '/home/u/.claude/plugins/cache/x/mermaid-collab/5.0.0', bun: '/home/u/.bun/bin/bun', snapBun: false,
    });
    expect(suggestedCommand).toContain('MERMAID_AUTH_TOKEN=TOK');
    expect(suggestedCommand).toContain('MERMAID_BIND_HOST=0.0.0.0');
    expect(suggestedCommand).toContain('PORT=1234');
  });

  it('never emits a 0.0.0.0 command without a token, across every branch', () => {
    const cases = [
      { mc: '/usr/bin/mermaid-collab', cache: '', bun: '', snapBun: false },
      { mc: '', cache: '/c/mermaid-collab/5.0.0', bun: '/home/u/.bun/bin/bun', snapBun: false },
      { mc: '', cache: '/c/mermaid-collab/5.0.0', bun: '/snap/bin/bun', snapBun: true },
      { mc: '', cache: '', bun: '', snapBun: false },
      { mc: '', cache: '', bun: '/home/u/.bun/bin/bun', snapBun: false },
    ];
    for (const c of cases) {
      const { suggestedCommand } = synthesizeStartCommand({ port: 9002, token: 'TOK', ...c });
      if (suggestedCommand.includes('0.0.0.0')) {
        expect(suggestedCommand).toContain('MERMAID_AUTH_TOKEN=TOK');
      }
    }
  });

  it('snap-only / no-bun branches yield no command (and so no open server)', () => {
    expect(synthesizeStartCommand({ port: 9002, token: 'TOK', mc: '', cache: '/c/mermaid-collab/5.0.0', bun: '/snap/bin/bun', snapBun: true }).suggestedCommand).toBe('');
    expect(synthesizeStartCommand({ port: 9002, token: 'TOK', mc: '', cache: '', bun: '', snapBun: false }).suggestedCommand).toBe('');
  });
});

describe('applyTokenToCommand (launchRemoteServer threading)', () => {
  it('prepends the token when the command lacks one', () => {
    expect(applyTokenToCommand('MERMAID_BIND_HOST=0.0.0.0 mermaid-collab start', 'TOK'))
      .toBe('MERMAID_AUTH_TOKEN=TOK MERMAID_BIND_HOST=0.0.0.0 mermaid-collab start');
  });

  it('leaves a command that already sets the token unchanged', () => {
    const cmd = 'MERMAID_AUTH_TOKEN=EXISTING MERMAID_BIND_HOST=0.0.0.0 mermaid-collab start';
    expect(applyTokenToCommand(cmd, 'TOK')).toBe(cmd);
  });

  it('is a no-op when no token is supplied', () => {
    expect(applyTokenToCommand('mermaid-collab start', undefined)).toBe('mermaid-collab start');
  });
});
