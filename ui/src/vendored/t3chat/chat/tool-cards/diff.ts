export interface DiffLine {
  kind: 'add' | 'del' | 'ctx';
  text: string;
  oldNo?: number;
  newNo?: number;
}

export function computeLineDiff(oldStr: string, newStr: string): DiffLine[] {
  if (oldStr === newStr) {
    const lines = oldStr.split(/\r?\n/);
    return lines.map((text, i) => ({
      kind: 'ctx',
      text,
      oldNo: i + 1,
      newNo: i + 1,
    }));
  }

  const oldLines = oldStr.split(/\r?\n/);
  const newLines = newStr.split(/\r?\n/);
  const m = oldLines.length;
  const n = newLines.length;

  const lcs: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0),
  );
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (oldLines[i] === newLines[j]) {
        lcs[i][j] = lcs[i + 1][j + 1] + 1;
      } else {
        lcs[i][j] = Math.max(lcs[i + 1][j], lcs[i][j + 1]);
      }
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (oldLines[i] === newLines[j]) {
      out.push({ kind: 'ctx', text: oldLines[i], oldNo: i + 1, newNo: j + 1 });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ kind: 'del', text: oldLines[i], oldNo: i + 1 });
      i++;
    } else {
      out.push({ kind: 'add', text: newLines[j], newNo: j + 1 });
      j++;
    }
  }
  while (i < m) {
    out.push({ kind: 'del', text: oldLines[i], oldNo: i + 1 });
    i++;
  }
  while (j < n) {
    out.push({ kind: 'add', text: newLines[j], newNo: j + 1 });
    j++;
  }
  return out;
}
