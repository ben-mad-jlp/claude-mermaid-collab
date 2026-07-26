import { test } from 'bun:test';
import { parseBlueprintCriteria, classifyCriterion } from '../criteria-citability';
test('probe', () => {
  const md = [
    '## Acceptance Criteria',
    '1. Implementation untouched. git diff HEAD --stat -- src/services/leaf-executor.ts is empty',
    '2. Test covers consumer — src/services/__tests__/criteria-citability.test.ts:120 adds the acquit case',
  ].join('\n');
  const parsed = parseBlueprintCriteria(md);
  console.log(JSON.stringify(parsed, null, 2));
  for (const c of parsed) {
    console.log(c, '=>', JSON.stringify(classifyCriterion(c, ['src/services/__tests__/criteria-citability.test.ts'])));
  }
});
