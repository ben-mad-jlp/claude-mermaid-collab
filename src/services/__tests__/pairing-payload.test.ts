import { describe, expect, test } from 'bun:test';
import { buildPairingPayloadV2, buildPairingQrValue } from '../pairing-payload.ts';

describe('pairing-payload', () => {
  test('buildPairingQrValue encodes the whole wrapper object as base64url', () => {
    const servers = [
      { id: 'a', label: 'Desktop', host: '100.64.1.2:9002', token: 'tok-a' },
      { id: 'b', label: 'Laptop', host: '100.64.1.3:9002', token: 'tok-b' },
    ];
    const payload = buildPairingPayloadV2(servers);
    const qr = buildPairingQrValue(payload);

    const prefix = 'mermaidcollab://pair?v=2&servers=';
    expect(qr.startsWith(prefix)).toBe(true);

    const blob = qr.slice(prefix.length);
    expect(blob).not.toContain('+');
    expect(blob).not.toContain('/');
    expect(blob).not.toContain('=');

    let base64 = blob.replace(/-/g, '+').replace(/_/g, '/');
    const pad = base64.length % 4;
    if (pad) base64 += '='.repeat(4 - pad);
    const decoded = JSON.parse(Buffer.from(base64, 'base64').toString('utf8'));

    expect(decoded).toEqual({ version: 2, servers });
  });
});
