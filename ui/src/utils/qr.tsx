import qrcodegen from 'qrcode-generator';

export function PairingQr({ value, testId }: { value: string; testId?: string }) {
  const qr = qrcodegen(0, 'M');
  qr.addData(value);
  qr.make();

  const moduleCount = qr.getModuleCount();

  return (
    <svg
      viewBox={`0 0 ${moduleCount} ${moduleCount}`}
      className="w-48 h-48"
      data-testid={testId}
    >
      {Array.from({ length: moduleCount }).map((_, row) =>
        Array.from({ length: moduleCount }).map((_, col) =>
          qr.isDark(row, col) ? (
            <rect
              key={`${row}-${col}`}
              x={col}
              y={row}
              width={1}
              height={1}
              fill="black"
            />
          ) : null,
        ),
      )}
    </svg>
  );
}
