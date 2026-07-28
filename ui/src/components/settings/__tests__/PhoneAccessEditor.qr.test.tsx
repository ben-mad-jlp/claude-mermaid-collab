import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { PhoneAccessEditor } from '../PhoneAccessEditor';

afterEach(() => vi.restoreAllMocks());

describe('PhoneAccessEditor QR', () => {
  it('renders QR when data.qr is provided', async () => {
    const qrValue = 'mermaidcollab://pair?host=100.64.0.5:9002&token=tok123';
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        token: 'tok123',
        port: 9002,
        bound: '0.0.0.0',
        hosts: [{ address: '100.64.0.5', iface: 'tailscale0', likelyTailscale: true }],
        qr: qrValue,
      }),
    }) as any;

    render(<PhoneAccessEditor />);

    await waitFor(() => {
      expect(screen.getByTestId('pair-qr')).toBeTruthy();
    });

    const qrElement = screen.getByTestId('pair-qr');
    expect(qrElement.getAttribute('data-value')).toBe(qrValue);
    expect(screen.getByText('100.64.0.5:9002')).toBeTruthy();
    expect(screen.getByText('tok123')).toBeTruthy();
  });

  it('does not render QR when qr is null', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        token: 'tok456',
        port: 9002,
        bound: '0.0.0.0',
        hosts: [],
        qr: null,
      }),
    }) as any;

    render(<PhoneAccessEditor />);

    await waitFor(() => {
      expect(screen.getByText('(no reachable interface) :9002')).toBeTruthy();
    });

    expect(screen.queryByTestId('pair-qr')).toBeNull();
    expect(screen.getByText('tok456')).toBeTruthy();
  });
});
