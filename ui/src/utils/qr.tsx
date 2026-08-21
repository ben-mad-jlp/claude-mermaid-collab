import qrcodegen from 'qrcode-generator';

/**
 * A QR needs a LIGHT background and a quiet zone to be scannable — the spec calls for
 * 4 light modules on every side. This used to draw black modules on a transparent
 * background with no margin, so on the dark settings panel it rendered black-on-dark
 * and no phone camera could read it (observed 2026-08-21). The white plate and the
 * quiet zone are part of the code, not decoration: do not make them theme-aware.
 */
const QUIET_ZONE_MODULES = 4;

export function PairingQr({ value, testId }: { value: string; testId?: string }) {
  const qr = qrcodegen(0, 'M');
  qr.addData(value);
  qr.make();

  const moduleCount = qr.getModuleCount();
  const extent = moduleCount + QUIET_ZONE_MODULES * 2;

  return (
    <svg
      viewBox={`0 0 ${extent} ${extent}`}
      className="w-48 h-48 rounded"
      data-testid={testId}
    >
      <rect x={0} y={0} width={extent} height={extent} fill="#ffffff" />
      {Array.from({ length: moduleCount }).map((_, row) =>
        Array.from({ length: moduleCount }).map((_, col) =>
          qr.isDark(row, col) ? (
            <rect
              key={`${row}-${col}`}
              x={col + QUIET_ZONE_MODULES}
              y={row + QUIET_ZONE_MODULES}
              width={1}
              height={1}
              fill="#000000"
            />
          ) : null,
        ),
      )}
    </svg>
  );
}
