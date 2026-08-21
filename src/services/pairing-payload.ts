/**
 * Shared v2 pairing payload schema + QR encoder.
 *
 * Single source of the v2 pairing contract, mirrored by the Swift
 * `PairingLink.decodeBase64` inverse on the phone. Pure — no side effects at
 * module load, no config/os/filesystem/network dependency. `Buffer` is the
 * only permitted dependency.
 */

export const PAIRING_PAYLOAD_VERSION = 2 as const;

export interface PairingServerEntry {
  id: string;
  label: string;
  /** Joined `addr:port` string, matching the desktop ServerEntry host+port join. */
  host: string;
  token: string;
}

export interface PairingPayloadV2 {
  version: 2;
  servers: PairingServerEntry[];
}

/** Pure wrapper — copies `servers` so the payload cannot be mutated via the caller's array. */
export function buildPairingPayloadV2(servers: PairingServerEntry[]): PairingPayloadV2 {
  return { version: PAIRING_PAYLOAD_VERSION, servers: [...servers] };
}

/**
 * Encodes the WHOLE wrapper object (not a bare array) as a base64url blob and
 * returns the deep link `mermaidcollab://pair?v=2&servers=<blob>`.
 */
export function buildPairingQrValue(payload: PairingPayloadV2): string {
  const json = JSON.stringify(payload);
  const blob = Buffer.from(json, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `mermaidcollab://pair?v=2&servers=${blob}`;
}
