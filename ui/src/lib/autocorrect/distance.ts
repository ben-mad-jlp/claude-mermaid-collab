export function damerauLevenshtein(a: string, b: string, maxDist: number): number {
  if (a === b) return 0;

  const la = a.length;
  const lb = b.length;

  if (Math.abs(la - lb) > maxDist) return maxDist + 1;

  let prevPrev = new Array(lb + 1).fill(0);
  let prev = new Array(lb + 1).fill(0);
  let curr = new Array(lb + 1).fill(0);

  // Initialize first row
  for (let j = 0; j <= lb; j++) {
    prev[j] = j;
  }

  for (let i = 1; i <= la; i++) {
    curr[0] = i;
    let rowMin = i;

    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const deletion = prev[j] + 1;
      const insertion = curr[j - 1] + 1;
      const substitution = prev[j - 1] + cost;

      curr[j] = Math.min(deletion, insertion, substitution);

      // Check for transposition
      if (
        i > 1 &&
        j > 1 &&
        a[i - 1] === b[j - 2] &&
        a[i - 2] === b[j - 1]
      ) {
        curr[j] = Math.min(curr[j], prevPrev[j - 2] + 1);
      }

      rowMin = Math.min(rowMin, curr[j]);
    }

    if (rowMin > maxDist) return maxDist + 1;

    // Shift rows
    const temp = prevPrev;
    prevPrev = prev;
    prev = curr;
    curr = temp;
    curr.fill(0);
  }

  return prev[lb];
}
