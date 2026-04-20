import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function randomUUID(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  return (
    g.crypto?.randomUUID?.() ??
    Math.random().toString(36).slice(2) + Date.now().toString(36)
  );
}

export function truncate(s: string, max: number, suffix = '\u2026'): string {
  if (s.length <= max) return s;
  const keep = Math.max(0, max - suffix.length);
  return s.slice(0, keep) + suffix;
}
