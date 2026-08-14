import { describe, expect, test } from 'bun:test';
import { classifyTscOutput, isDependencyResolutionOnly } from '../tsc-infra-degraded';

const CACHED_DESKTOP_BLOCK = `desktop/src/component.tsx(3,24): error TS2307: Cannot find module 'react' or its corresponding type declarations.
desktop/src/component.tsx(5,10): error TS2307: Cannot find module '@types/node' or its corresponding type declarations.
desktop/src/utils.ts(12,5): error TS7016: Could not find a declaration file for module 'some-package'.
desktop/src/helpers.ts:8:15 - error TS7006: Parameter 'e' implicitly has an 'any' type.
desktop/src/index.tsx(1,1): error TS2307: Cannot find module 'missing-lib' or its corresponding type declarations.`;

describe('tsc-infra-degraded', () => {
  test('classifies the cached desktop-lane TS2307/TS7016/TS7006 block as infra-degraded', () => {
    const result = classifyTscOutput(CACHED_DESKTOP_BLOCK);
    expect(result).toBe('infra-degraded');
    expect(isDependencyResolutionOnly(CACHED_DESKTOP_BLOCK)).toBe(true);
  });

  test('classifies the block with one appended TS2345 as real', () => {
    const withTs2345 = CACHED_DESKTOP_BLOCK + '\ndesktop/src/api.ts(20,10): error TS2345: Argument of type \'string\' is not assignable to parameter of type \'number\'.';
    const result = classifyTscOutput(withTs2345);
    expect(result).toBe('real');
  });

  test('classifies the block with one appended TS2322 as real', () => {
    const withTs2322 = CACHED_DESKTOP_BLOCK + '\ndesktop/src/types.ts(15,5): error TS2322: Type \'string\' is not assignable to type \'boolean\'.';
    const result = classifyTscOutput(withTs2322);
    expect(result).toBe('real');
  });

  test('classifies empty output and a non-diagnostic blob as unparsed', () => {
    expect(classifyTscOutput('')).toBe('unparsed');
    expect(isDependencyResolutionOnly('')).toBe(false);

    const noDiagnosticsBlob = `npm ERR! code ERESOLVE
npm ERR! ERESOLVE unable to resolve dependency tree
Some random compilation chatter without error TS tokens.`;
    expect(classifyTscOutput(noDiagnosticsBlob)).toBe('unparsed');
    expect(isDependencyResolutionOnly(noDiagnosticsBlob)).toBe(false);
  });
});
