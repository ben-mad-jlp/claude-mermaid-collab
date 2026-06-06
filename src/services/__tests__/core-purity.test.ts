import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * CORE PURITY (design-system-object-primitive §7.1): the gate registry CORE
 * (gate-runner.ts) must learn ZERO domain specifics. Domain knowledge (CAD steps,
 * bsync, DOF, …) lives only in domain plugin files that register themselves. This
 * test greps the core's CODE (comments stripped) for any domain literal and fails
 * if one leaks in — the structural guarantee that collab core stays domain-free.
 */

/** Tokens that would betray domain coupling in the core. Matched case-insensitively
 *  as whole words against comment-stripped code. */
const DOMAIN_LITERALS = [
  'cad', 'bsync', 'dof', 'jacobian', 'joint', 'workspace',
  'mechanism', 'clearance', 'geometry', 'kinematic', 'solid', 'gripper',
];

/** Strip block (/* … *​/) and line (// …) comments so documentation may mention a
 *  domain by name without tripping the purity check — only CODE must be pure. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1'); // keep the char before // (avoids eating "http://")
}

describe('gate-runner core purity', () => {
  const coreSrc = readFileSync(join(__dirname, '..', 'gate-runner.ts'), 'utf8');
  const code = stripComments(coreSrc);

  for (const literal of DOMAIN_LITERALS) {
    it(`core contains no domain literal "${literal}"`, () => {
      const re = new RegExp(`\\b${literal}\\b`, 'i');
      expect(re.test(code)).toBe(false);
    });
  }
});
