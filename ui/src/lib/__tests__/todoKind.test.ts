import { describe, it, expect } from 'vitest';
import fixture from '@shared-fixtures/todo-kind-cases.json';
import * as ui from '../todoKind';
import * as server from '@server/services/todo-kind.ts';

type Case = {
  name: string;
  title: string | null;
  kind: ui.TodoKind;
  isMission: boolean;
  isEpic: boolean;
  isLand: boolean;
  isLeaf: boolean;
  label: string;
  backfillParity?: boolean;
};

const cases = fixture.cases as Case[];

describe('todoKind (UI mirror) — kindOf reads the column', () => {
  for (const c of cases) {
    it(c.name, () => {
      expect(ui.kindOf({ kind: c.kind, title: c.title })).toBe(c.kind);
    });
  }
});

describe('todoKind (UI mirror) — predicates', () => {
  for (const c of cases) {
    it(c.name, () => {
      const t = { kind: c.kind, title: c.title };
      expect(ui.isMission(t)).toBe(c.isMission);
      expect(ui.isEpic(t)).toBe(c.isEpic);
      expect(ui.isLand(t)).toBe(c.isLand);
      expect(ui.isLeaf(t)).toBe(c.isLeaf);
    });
  }
});

describe('todoKind (UI mirror) — labelFor', () => {
  for (const c of cases) {
    it(c.name, () => {
      expect(ui.labelFor(c.kind)).toBe(c.label);
    });
  }

  it('labelFor("leaf") is empty string', () => {
    expect(ui.labelFor('leaf')).toBe('');
  });

  it('labels table maps onto labelFor for all fixture kinds', () => {
    for (const key of Object.keys(fixture.labels)) {
      const kind = key as ui.TodoKind;
      expect(ui.labelFor(kind)).toBe((fixture.labels as Record<string, string>)[key]);
    }
  });
});

describe('todoKind (UI mirror) — stage-A backfill parity (title ⇒ kind)', () => {
  for (const c of cases) {
    if (c.backfillParity === false) continue;
    it(c.name, () => {
      expect(ui.kindFromTitle(c.title)).toBe(c.kind);
    });
  }
});

describe('todoKind (UI mirror) — server/UI agreement', () => {
  for (const c of cases) {
    it(c.name, () => {
      const t = { kind: c.kind, title: c.title };
      expect(ui.kindOf(t)).toBe(server.kindOf(t));
      expect(ui.isMission(t)).toBe(server.isMission(t));
      expect(ui.isEpic(t)).toBe(server.isEpic(t));
      expect(ui.isLand(t)).toBe(server.isLand(t));
      expect(ui.isLeaf(t)).toBe(server.isLeaf(t));
      expect(ui.labelFor(c.kind)).toBe(server.labelFor(c.kind));
    });
  }

  it('label tables agree wholesale', () => {
    expect(fixture.labels).toEqual(server.KIND_LABEL);
    for (const kind of fixture.kinds as ui.TodoKind[]) {
      expect(ui.labelFor(kind)).toBe(server.KIND_LABEL[kind]);
    }
  });
});

describe('todoKind (UI mirror) — null/undefined totality', () => {
  it('kindOf(null) is leaf and matches server', () => {
    expect(ui.kindOf(null)).toBe('leaf');
    expect(ui.kindOf(null)).toBe(server.kindOf(null));
  });

  it('kindOf(undefined) is leaf and matches server', () => {
    expect(ui.kindOf(undefined)).toBe('leaf');
    expect(ui.kindOf(undefined)).toBe(server.kindOf(undefined));
  });

  it('kindOf({}) is leaf and matches server', () => {
    expect(ui.kindOf({})).toBe('leaf');
    expect(ui.kindOf({})).toBe(server.kindOf({}));
  });

  it('kindOf({ title: null }) is leaf and matches server', () => {
    expect(ui.kindOf({ title: null })).toBe('leaf');
    expect(ui.kindOf({ title: null })).toBe(server.kindOf({ title: null }));
  });
});

describe('todoKind (UI mirror) — column beats title', () => {
  it('kind column wins over a conflicting title prefix', () => {
    expect(ui.kindOf({ kind: 'epic', title: '[MISSION] x' })).toBe('epic');
  });
});

describe('todoKind (UI mirror) — stripKindPrefix is render-only', () => {
  it('strips a leading [EPIC] prefix', () => {
    expect(ui.stripKindPrefix('[EPIC] Foo')).toBe('Foo');
  });

  it('strips a leading [MISSION] prefix with extra whitespace', () => {
    expect(ui.stripKindPrefix('[MISSION]  Bar')).toBe('Bar');
  });

  it('strips exactly one leading label, leaving a subsequent bracket alone', () => {
    expect(ui.stripKindPrefix('[EPIC] [LAND] weird')).toBe('[LAND] weird');
  });

  it('does not strip a mid-string role mention', () => {
    expect(ui.stripKindPrefix('Stop reading [EPIC] out of titles')).toBe(
      'Stop reading [EPIC] out of titles'
    );
  });

  it('null title becomes empty string', () => {
    expect(ui.stripKindPrefix(null)).toBe('');
  });

  it('stripKindPrefix does not decide a role', () => {
    expect(ui.kindOf({ kind: 'epic', title: ui.stripKindPrefix('[EPIC] Foo') })).toBe('epic');
  });
});

describe('todoKind (UI mirror) — fixture is non-degenerate', () => {
  it('has at least 10 cases', () => {
    expect(cases.length).toBeGreaterThanOrEqual(10);
  });

  it('covers every fixture kind', () => {
    expect(new Set(cases.map((c) => c.kind))).toEqual(new Set(fixture.kinds));
  });
});
