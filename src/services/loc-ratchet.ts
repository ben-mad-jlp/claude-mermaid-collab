export function locRatchetVerdict(args: { current: number; base: number }): { ok: boolean; reason: string } {
  const { current, base } = args;
  const ok = current <= base;

  if (ok) {
    if (current === base) {
      return { ok: true, reason: `${current} lines (stable at base)` };
    }
    return { ok: true, reason: `${current} lines (base ${base}, -${base - current})` };
  }

  return { ok: false, reason: `${current} lines (base ${base}, +${current - base})` };
}
