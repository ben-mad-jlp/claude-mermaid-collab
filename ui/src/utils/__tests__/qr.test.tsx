/**
 * A QR with no light background and no quiet zone is not scannable.
 *
 * The pairing QR rendered black modules on a TRANSPARENT background with zero margin.
 * On the dark settings panel that is black-on-dark, and no phone camera could read it
 * (observed 2026-08-21, which is why the iOS app sat unpaired). The white plate and the
 * 4-module quiet zone the spec requires are part of the code, not styling.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { PairingQr } from '../qr';

const VALUE = 'mermaidcollab://pair?host=100.73.88.53:9002&token=tok123';

function renderQr() {
  const { container } = render(<PairingQr value={VALUE} testId="pair-qr" />);
  const svg = container.querySelector('[data-testid="pair-qr"]') as SVGSVGElement;
  const rects = Array.from(svg.querySelectorAll('rect'));
  return { svg, rects };
}

describe('PairingQr', () => {
  it('paints an opaque white plate behind the modules', () => {
    const { rects } = renderQr();
    const plate = rects[0];
    expect(plate.getAttribute('fill')).toBe('#ffffff');
    expect(plate.getAttribute('x')).toBe('0');
    expect(plate.getAttribute('y')).toBe('0');
  });

  it('the white plate covers the whole viewBox', () => {
    const { svg, rects } = renderQr();
    const [, , vbW, vbH] = svg.getAttribute('viewBox')!.split(' ');
    const plate = rects[0];
    expect(plate.getAttribute('width')).toBe(vbW);
    expect(plate.getAttribute('height')).toBe(vbH);
  });

  it('leaves a 4-module quiet zone on every side', () => {
    const { svg, rects } = renderQr();
    const extent = Number(svg.getAttribute('viewBox')!.split(' ')[2]);
    const modules = rects.slice(1);
    const xs = modules.map((r) => Number(r.getAttribute('x')));
    const ys = modules.map((r) => Number(r.getAttribute('y')));
    // Every dark module sits at least 4 in from each edge.
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(4);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(4);
    expect(Math.max(...xs)).toBeLessThanOrEqual(extent - 4 - 1);
    expect(Math.max(...ys)).toBeLessThanOrEqual(extent - 4 - 1);
  });

  it('still renders dark modules for the encoded value', () => {
    const { rects } = renderQr();
    const dark = rects.slice(1).filter((r) => r.getAttribute('fill') === '#000000');
    expect(dark.length).toBeGreaterThan(0);
  });
});
