/**
 * TYPED corpus for reviewer-lab — proves the leaf 6a5fdf36 incident shape holds at production
 * model config via groundReviewViaContract (the typed grounding path), not the prose gate.
 * See src/services/__tests__/diff-contract-review.test.ts:701-789 for the reference shape.
 */
import type { Case } from './cases';
import type { DiffContract } from '../../src/services/diff-contract';

const bp = (criteria: string[], prose = ''): string =>
  `${prose ? prose + '\n\n' : ''}ACCEPTANCE CRITERIA:\n${criteria.map((c) => `- ${c}`).join('\n')}`;

const contract: DiffContract = {
  schemaVersion: 2,
  leafKind: 'test',
  filesToCreate: ['src/users.invariant.test.ts'],
  filesToEdit: [],
  outOfScope: [],
  tasks: [],
  estimatedFiles: 1,
  estimatedTasks: 1,
  nonEnumerableFanout: false,
  requirements: [
    {
      kind: 'invariant',
      id: 'null-guard-preserved',
      description: 'getUser(id) returns null for an empty/falsy id, never indexes into the map',
    },
  ],
};

export const TYPED: Case[] = [
  {
    id: 'ts-nullguard-invariant-typed',
    lang: 'ts', concept: 'invariant-preservation', complexity: 'simple', expected: 'accept',
    title: 'Add regression test for getUser null-guard invariant',
    description: 'Add a test proving getUser("") returns null; the null-guard itself is already shipped and must not be touched.',
    blueprint: bp([
      'getUser(id) returns null for an empty/falsy id, before touching the map — this invariant is preserved, not reimplemented',
      'a new regression test asserts getUser("") === null',
    ]),
    base: {
      'src/users.ts':
`export const db: Record<string, { name: string }> = { u1: { name: 'Ada' } };

export function getUser(id: string) {
  if (!id) return null;
  return db[id];
}
`,
    },
    after: {
      'src/users.invariant.test.ts':
`import { describe, it, expect } from 'bun:test';
import { getUser } from './users';

describe('getUser invariant', () => {
  it('returns null for an empty id', () => {
    expect(getUser('')).toBeNull();
  });
});
`,
    },
    contract,
  },
];
