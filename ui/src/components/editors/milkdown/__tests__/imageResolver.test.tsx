import { describe, it, expect } from 'vitest';
import { resolveImageSrc } from '../../../../lib/resolveImageSrc';

describe('resolveImageSrc', () => {
  const ctx = { project: '/p', session: 's1', theme: 'dark' };

  it('resolves @diagram/:id to /api/render/:id with project, session, theme', () => {
    const out = resolveImageSrc('@diagram/abc', ctx);
    expect(out).toContain('/api/render/abc?');
    expect(out).toContain('project=%2Fp');
    expect(out).toContain('session=s1');
    expect(out).toContain('theme=dark');
  });

  it('resolves @design/:id to /api/design/:id/render', () => {
    const out = resolveImageSrc('@design/xyz', ctx);
    expect(out).toMatch(/^\/api\/design\/xyz\/render\?/);
    expect(out).toContain('session=s1');
  });

  it('resolves ./designs/:id(.json) to /api/design/:id/render', () => {
    const out = resolveImageSrc('./designs/foo.json', ctx);
    expect(out).toMatch(/^\/api\/design\/foo\/render\?/);
  });

  it('resolves ./diagrams/:id(.mmd) to /api/render/:id with theme', () => {
    const out = resolveImageSrc('./diagrams/bar.mmd', ctx);
    expect(out).toMatch(/^\/api\/render\/bar\?/);
    expect(out).toContain('theme=dark');
  });

  it('passes regular https URLs through unchanged', () => {
    const url = 'https://example.com/pic.png';
    expect(resolveImageSrc(url, ctx)).toBe(url);
  });

  it('returns raw src when project or session is missing', () => {
    expect(resolveImageSrc('@diagram/abc', {})).toBe('@diagram/abc');
    expect(resolveImageSrc('@diagram/abc', { project: '/p' })).toBe('@diagram/abc');
  });
});
