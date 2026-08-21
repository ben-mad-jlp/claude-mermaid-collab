import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { PhoneAccessEditor } from '../PhoneAccessEditor';

afterEach(() => vi.restoreAllMocks());

const QR = 'mermaidcollab://pair?v=2&d=eyJ2IjoyfQ';

function stub(servers: Array<{ id: string; label: string; host: string; token: string }>) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({
      version: 2,
      token: 'tok-local',
      port: 9002,
      bound: '0.0.0.0',
      hosts: [],
      qr: QR,
      servers,
    }),
  }) as any;
}

describe('PhoneAccessEditor multi-server', () => {
  it('(1) a stubbed two-server payload renders two server rows', async () => {
    stub([
      { id: 'srv-a', label: 'laptop', host: '100.64.0.5:9002', token: 'tok-a' },
      { id: 'srv-b', label: 'trimaxion', host: '100.64.0.9:9002', token: 'tok-b' },
    ]);

    render(<PhoneAccessEditor />);

    await waitFor(() => {
      expect(screen.getAllByTestId('pair-server-row')).toHaveLength(2);
    });

    expect(screen.getByText('laptop')).toBeTruthy();
    expect(screen.getByText('100.64.0.5:9002')).toBeTruthy();
    expect(screen.getByText('tok-a')).toBeTruthy();
    expect(screen.getByText('trimaxion')).toBeTruthy();
    expect(screen.getByText('100.64.0.9:9002')).toBeTruthy();
    expect(screen.getByText('tok-b')).toBeTruthy();
  });

  it('(2) the rendered QR value contains the string mermaidcollab://pair', async () => {
    stub([{ id: 'srv-a', label: 'laptop', host: '100.64.0.5:9002', token: 'tok-a' }]);

    render(<PhoneAccessEditor />);

    await waitFor(() => {
      expect(screen.getByTestId('pair-qr')).toBeTruthy();
    });

    const qr = screen.getByTestId('pair-qr');
    expect(qr.getAttribute('data-value')).toBe(QR);
    expect(qr.getAttribute('data-value')).toContain('mermaidcollab://pair');
  });

  it('(3) a stubbed single-server payload renders one server row', async () => {
    stub([{ id: 'srv-only', label: 'solo', host: '100.64.0.7:9002', token: 'tok-solo' }]);

    render(<PhoneAccessEditor />);

    await waitFor(() => {
      expect(screen.getAllByTestId('pair-server-row')).toHaveLength(1);
    });

    expect(screen.getByText('solo')).toBeTruthy();
    expect(screen.getByText('100.64.0.7:9002')).toBeTruthy();
    expect(screen.getByText('tok-solo')).toBeTruthy();
  });
});
