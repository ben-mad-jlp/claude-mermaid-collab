/**
 * Unit tests for todo-kind.ts (stage B split of epic ab9b32ca) — the predicate
 * module that reads the `kind` column first and falls back to title-prefix
 * regexes only when the column is absent/invalid. Pure; no DB.
 */
import { describe, it, expect } from 'bun:test';
import {
  kindOf,
  isMission,
  isEpic,
  isLand,
  isLeaf,
  labelFor,
  stripLabel,
  KIND_LABEL,
  KIND_FIXTURE,
  type TodoKind,
  type KindBearing,
} from '../todo-kind.ts';
import { kindFromTitle } from '../claimability.ts';
import * as uiKind from '../../../ui/src/lib/todoKind.ts';

describe('kindOf', () => {
  for (const { input, expect: want } of KIND_FIXTURE) {
    it(`${JSON.stringify(input)} -> ${want}`, () => {
      expect(kindOf(input)).toBe(want);
    });
  }

  it('null -> leaf', () => {
    expect(kindOf(null)).toBe('leaf');
  });

  it('undefined -> leaf', () => {
    expect(kindOf(undefined)).toBe('leaf');
  });
});

describe('predicates', () => {
  const predicates: Record<TodoKind, (t: KindBearing) => boolean> = {
    mission: isMission,
    epic: isEpic,
    land: isLand,
    leaf: isLeaf,
  };

  for (const { input, expect: want } of KIND_FIXTURE) {
    it(`${JSON.stringify(input)} -> exactly ${want} is true`, () => {
      for (const [kind, pred] of Object.entries(predicates) as [TodoKind, (t: KindBearing) => boolean][]) {
        expect(pred(input)).toBe(kind === want);
      }
    });
  }
});

describe('kindOf parity with kindFromTitle', () => {
  const titles = [
    '[MISSION] Converge',
    '[EPIC] Foo',
    '[LAND] → master',
    'plain leaf',
    '  [epic] lower',
    null,
    undefined,
  ];

  for (const title of titles) {
    it(`title=${JSON.stringify(title)}`, () => {
      expect(kindOf({ title })).toBe(kindFromTitle(title));
    });
  }
});

describe('labelFor', () => {
  it('mission', () => expect(labelFor('mission')).toBe('[MISSION]'));
  it('epic', () => expect(labelFor('epic')).toBe('[EPIC]'));
  it('land', () => expect(labelFor('land')).toBe('[LAND]'));
  it('leaf', () => expect(labelFor('leaf')).toBe(''));

  it('matches KIND_LABEL', () => {
    for (const kind of Object.keys(KIND_LABEL) as TodoKind[]) {
      expect(labelFor(kind)).toBe(KIND_LABEL[kind]);
    }
  });
});

describe('stripLabel', () => {
  it('strips [EPIC] prefix', () => {
    expect(stripLabel('[EPIC] Foo')).toBe('Foo');
  });

  it('strips [MISSION] prefix with extra whitespace', () => {
    expect(stripLabel('[MISSION]  Bar')).toBe('Bar');
  });

  it('leaves plain titles untouched', () => {
    expect(stripLabel('Plain')).toBe('Plain');
  });

  it('strips exactly one leading label', () => {
    expect(stripLabel('[EPIC] [LAND] weird')).toBe('[LAND] weird');
  });

  it('does not strip a bracket that appears mid-title', () => {
    expect(stripLabel('Foo [EPIC] bar')).toBe('Foo [EPIC] bar');
  });

  it('null -> empty string', () => {
    expect(stripLabel(null)).toBe('');
  });

  it('undefined -> empty string', () => {
    expect(stripLabel(undefined)).toBe('');
  });

  it('round-trips with labelFor', () => {
    expect(stripLabel(`${labelFor('epic')} Foo`)).toBe('Foo');
  });
});

describe('server/UI parity (KIND_FIXTURE)', () => {
  for (const { input, expect: want } of KIND_FIXTURE) {
    it(`kindOf(${JSON.stringify(input)}) agrees: server=UI=${want}`, () => {
      expect(kindOf(input)).toBe(want);
      expect(uiKind.kindOf(input)).toBe(want);
    });
  }

  it('labelFor agrees across server and UI modules for all four kinds', () => {
    for (const kind of Object.keys(KIND_LABEL) as TodoKind[]) {
      expect(labelFor(kind)).toBe(uiKind.labelFor(kind));
    }
  });
});
