import { describe, it, expect } from 'vitest';
import { tmuxBaseName } from '../tmux-naming';

describe('tmuxBaseName', () => {
  it('basic happy path', () => {
    expect(tmuxBaseName('/a/my-project', 'bugfixes')).toBe('mc-myproject-bugfixes');
  });

  it('slug strips non-alphanumeric', () => {
    expect(tmuxBaseName('/a/my.proj!', 'my session!')).toBe('mc-myproj-mysession');
  });

  it('trailing slash on project', () => {
    expect(tmuxBaseName('/a/myproject/', 's')).toBe('mc-myproject-s');
  });

  it('truncation to 24 chars per part', () => {
    const longBasename = 'abcdefghijklmnopqrstuvwxyz1234'; // 30 chars, all alnum
    const longSession = 'abcdefghijklmnopqrstuvwxyz1234'; // 30 chars, all alnum
    const result = tmuxBaseName(`/a/${longBasename}`, longSession);
    // format: mc-{baseSlug}-{sessionSlug}
    const parts = result.split('-');
    // parts[0] = 'mc', parts[1] = baseSlug, parts[2] = sessionSlug
    const baseSlug = parts[1];
    expect(baseSlug.length).toBe(24);
    expect(baseSlug).toBe(longBasename.slice(0, 24));
  });

  it('all-symbols basename falls back to x', () => {
    expect(tmuxBaseName('/a/---/', 's')).toBe('mc-x-s');
  });

  it('all-symbols session falls back to x', () => {
    expect(tmuxBaseName('/a/proj', '---')).toBe('mc-proj-x');
  });

  it('distinct names for different basenames with same session', () => {
    expect(tmuxBaseName('/a/alpha', 'main')).not.toBe(tmuxBaseName('/a/beta', 'main'));
  });

  it('documented same-basename collision (expected/known)', () => {
    expect(tmuxBaseName('/a/foo', 'bar')).toBe(tmuxBaseName('/b/foo', 'bar'));
  });
});
