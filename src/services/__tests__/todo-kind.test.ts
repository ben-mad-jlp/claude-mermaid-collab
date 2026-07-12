/**
 * Unit tests for todo-kind.ts (stage C of epic ab9b32ca) — the predicate module
 * that reads the `kind` column only. A missing/invalid `kind` throws
 * `MissingKindError`; no predicate here ever reads a title. Pure; no DB.
 */
import { describe, it, expect } from 'bun:test';
import {
  kindOf,
  kindOfInput,
  isMission,
  isEpic,
  isLand,
  isLeaf,
  isGate,
  labelFor,
  stripLabel,
  KIND_LABEL,
  KIND_FIXTURE,
  KIND_THROW_FIXTURE,
  STRUCTURE_FIXTURE,
  epicIdSet,
  parentEpicIdOf,
  MissingKindError,
  type TodoKind,
  type KindBearing,
  type IdentifiedKindBearing,
} from '../todo-kind.ts';
import * as serverKind from '../todo-kind.ts';
import * as uiKind from '../../../ui/src/lib/todoKind.ts';

describe('kindOf — column only', () => {
  for (const { input, expect: want } of KIND_FIXTURE) {
    it(`${JSON.stringify(input)} -> ${want}`, () => {
      expect(kindOf(input)).toBe(want);
    });
  }

  it('column wins over a contradicting stale prefix', () => {
    expect(kindOf({ kind: 'epic', title: '[MISSION] stale prefix' })).toBe('epic');
  });

  it('a topic tag in the title is not a role', () => {
    expect(kindOf({ kind: 'leaf', title: "[UI] Plan list doesn't refresh" })).toBe('leaf');
  });
});

describe('predicates', () => {
  const predicates: Record<TodoKind, (t: KindBearing) => boolean> = {
    mission: isMission,
    epic: isEpic,
    land: isLand,
    leaf: isLeaf,
    gate: isGate,
  };

  for (const { input, expect: want } of KIND_FIXTURE) {
    it(`${JSON.stringify(input)} -> exactly ${want} is true`, () => {
      for (const [kind, pred] of Object.entries(predicates) as [TodoKind, (t: KindBearing) => boolean][]) {
        expect(pred(input)).toBe(kind === want);
      }
    });
  }
});

describe('BOMB 2 — a missing kind throws, never defaults to leaf', () => {
  for (const { input } of KIND_THROW_FIXTURE) {
    it(`${JSON.stringify(input)} throws MissingKindError`, () => {
      expect(() => kindOf(input)).toThrow(MissingKindError);
      expect(() => uiKind.kindOf(input as uiKind.TodoLike)).toThrow(uiKind.MissingKindError);
    });
  }

  it('negative control: a bare title with no kind throws, not "leaf"', () => {
    expect(() => kindOf({ title: 'Bugfix inbox' })).toThrow();
  });

  it('negative control: an undefined kind with a [LAND] title throws, not "land"', () => {
    expect(() => kindOf({ kind: undefined, title: 'Land X → master' })).toThrow();
  });

  it('negative control: null throws, not "leaf"', () => {
    expect(() => kindOf(null)).toThrow();
  });

  it('negative control: undefined throws, not "leaf"', () => {
    expect(() => kindOf(undefined)).toThrow();
  });

  it('predicates surface it too', () => {
    expect(() => isMission({})).toThrow();
    expect(() => isEpic({})).toThrow();
    expect(() => isLand({})).toThrow();
    expect(() => isLeaf({})).toThrow();
  });
});

describe('kindOfInput — CREATE-TIME resolution (absent kind defaults to leaf)', () => {
  it('absent kind (null) defaults to leaf', () => {
    expect(kindOfInput({ kind: null, title: '[EPIC] looks like one' })).toBe('leaf');
  });

  it('absent kind (undefined) defaults to leaf', () => {
    expect(kindOfInput({ kind: undefined, title: '[MISSION] looks like one' })).toBe('leaf');
  });

  it('missing kind property (bare object) defaults to leaf', () => {
    expect(kindOfInput({ title: 'plain' })).toBe('leaf');
  });

  it('null input defaults to leaf', () => {
    expect(kindOfInput(null)).toBe('leaf');
  });

  it('undefined input defaults to leaf', () => {
    expect(kindOfInput(undefined)).toBe('leaf');
  });

  it('garbage kind (bogus) still throws, not leaf', () => {
    expect(() => kindOfInput({ kind: 'bogus' as TodoKind, title: '[EPIC] x' })).toThrow(MissingKindError);
  });

  it('explicit kind is returned as-is', () => {
    expect(kindOfInput({ kind: 'epic', title: 'Foo' })).toBe('epic');
    expect(kindOfInput({ kind: 'mission', title: 'Bar' })).toBe('mission');
    expect(kindOfInput({ kind: 'land', title: 'Baz' })).toBe('land');
    expect(kindOfInput({ kind: 'leaf', title: 'Qux' })).toBe('leaf');
  });
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

describe('stripLabel — render-only', () => {
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

  it('does not touch a topic tag', () => {
    expect(stripLabel('[UI] Plan list doesn’t refresh')).toBe('[UI] Plan list doesn’t refresh');
    expect(stripLabel('[kind C] STRIP')).toBe('[kind C] STRIP');
  });

  it('does not decide a role', () => {
    expect(kindOf({ kind: 'epic', title: stripLabel('[EPIC] Foo') })).toBe('epic');
  });
});

describe('server/UI parity', () => {
  for (const { input, expect: want } of KIND_FIXTURE) {
    it(`kindOf(${JSON.stringify(input)}) agrees: server=UI=${want}`, () => {
      expect(kindOf(input)).toBe(want);
      expect(uiKind.kindOf(input)).toBe(want);
    });

    it(`predicates for ${JSON.stringify(input)} agree between server and UI`, () => {
      expect(isMission(input)).toBe(uiKind.isMission(input));
      expect(isEpic(input)).toBe(uiKind.isEpic(input));
      expect(isLand(input)).toBe(uiKind.isLand(input));
      expect(isLeaf(input)).toBe(uiKind.isLeaf(input));
    });
  }

  it('labelFor agrees across server and UI modules for all four kinds', () => {
    for (const kind of Object.keys(KIND_LABEL) as TodoKind[]) {
      expect(labelFor(kind)).toBe(uiKind.labelFor(kind));
    }
  });
});

describe('STRUCTURE_FIXTURE — the structure trap (9acb7cb2)', () => {
  it('kindOf respects the kind column regardless of childCount', () => {
    for (const { input, expect: want } of STRUCTURE_FIXTURE) {
      expect(kindOf(input)).toBe(want);
    }
  });

  it('server kindOf agrees with UI mirror for every structure case', () => {
    for (const { input, expect: want } of STRUCTURE_FIXTURE) {
      expect(kindOf(input)).toBe(want);
      expect(uiKind.kindOf(input)).toBe(want);
    }
  });

  it('epicIdSet selects epics by kind, not by children', () => {
    const all = STRUCTURE_FIXTURE.map(c => c.input);
    const epicIds = epicIdSet(all);
    expect(epicIds).toEqual(new Set(['e-new', 'e1']));
    expect(epicIds.has('9acb7cb2')).toBe(false);
    expect(epicIds.has('c1')).toBe(false);
    expect(epicIds.has('l1')).toBe(false);
  });

  it('parentEpicIdOf returns null for a child of a split leaf', () => {
    const all = STRUCTURE_FIXTURE.map(c => c.input);
    const epicIds = epicIdSet(all);
    const c1 = all.find(t => t.id === 'c1')!;
    expect(parentEpicIdOf(c1, epicIds)).toBe(null);
  });

  it('parentEpicIdOf returns the parentId for a child of an epic', () => {
    const all = STRUCTURE_FIXTURE.map(c => c.input);
    const epicIds = epicIdSet(all);
    const l1 = all.find(t => t.id === 'l1')!;
    expect(parentEpicIdOf(l1, epicIds)).toBe('e1');
  });

  it('a structure case with missing kind throws', () => {
    const missing: IdentifiedKindBearing = { id: 'no-kind', title: 'Has children', parentId: 'e1' };
    expect(() => kindOf(missing)).toThrow(MissingKindError);
  });
});

describe('no title reader is reachable from this module', () => {
  it('todo-kind.ts does not export kindFromTitle', () => {
    expect((serverKind as Record<string, unknown>).kindFromTitle).toBeUndefined();
  });

  it('the UI mirror does not export kindFromTitle', () => {
    expect((uiKind as Record<string, unknown>).kindFromTitle).toBeUndefined();
  });
});
