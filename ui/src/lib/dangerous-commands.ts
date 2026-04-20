export interface DetectDangerResult { dangerous: boolean; reason?: string; }

const DANGER_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\brm\s+-rf\b/, reason: 'Recursive force delete (rm -rf)' },
  { pattern: /\bgit\s+push\s+(--force|-f)\b/, reason: 'Force push to git remote' },
  { pattern: /\bDROP\s+(TABLE|DATABASE|SCHEMA)\b/i, reason: 'SQL DROP statement' },
  { pattern: /\bkubectl\s+delete\b/, reason: 'Kubernetes resource deletion' },
  { pattern: /\bterraform\s+destroy\b/, reason: 'Terraform infrastructure destroy' },
];

export function detectDanger(command: string): DetectDangerResult {
  if (!command || typeof command !== 'string') return { dangerous: false };
  for (const { pattern, reason } of DANGER_PATTERNS) {
    if (pattern.test(command)) return { dangerous: true, reason };
  }
  return { dangerous: false };
}
