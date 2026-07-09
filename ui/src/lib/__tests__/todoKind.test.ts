import { describe, it, expect } from 'vitest';
import * as ui from '../todoKind';
import * as server from '@server/services/todo-kind.ts';

describe('todoKind (UI mirror) — kindOf reads the column', () => {
  for (const c of server.KIND_FIXTURE) {
    it(JSON.stringify(c.input), () => {
      expect(ui.kindOf(c.input)).toBe(c.expect);
    });
  }
});

describe('todoKind (UI mirror) — BOMB 2: missing/garbage kind throws', () => {
  for (const c of server.KIND_THROW_FIXTURE) {
    it(JSON.stringify(c.input), () => {
      expect(() => ui.kindOf(c.input)).toThrow(ui.MissingKindError);
      expect(() => server.kindOf(c.input)).toThrow();
    });
  }

  it('predicates throw too', () => {
    expect(() => ui.isLeaf({})).toThrow();
  });
});

describe('todoKind (UI mirror) — predicates', () => {
  for (const c of server.KIND_FIXTURE) {
    it(JSON.stringify(c.input), () => {
      expect(ui.isMission(c.input)).toBe(c.expect === 'mission');
      expect(ui.isEpic(c.input)).toBe(c.expect === 'epic');
      expect(ui.isLand(c.input)).toBe(c.expect === 'land');
      expect(ui.isLeaf(c.input)).toBe(c.expect === 'leaf');
    });
  }
});

describe('todoKind (UI mirror) — labelFor', () => {
  it('labelFor("leaf") is empty string', () => {
    expect(ui.labelFor('leaf')).toBe('');
  });

  it('matches server KIND_LABEL for all four kinds', () => {
    for (const kind of ['mission', 'epic', 'land', 'leaf'] as ui.TodoKind[]) {
      expect(ui.labelFor(kind)).toBe(server.KIND_LABEL[kind]);
    }
  });
});

describe('todoKind (UI mirror) — server/UI agreement', () => {
  for (const c of server.KIND_FIXTURE) {
    it(JSON.stringify(c.input), () => {
      expect(ui.kindOf(c.input)).toBe(server.kindOf(c.input));
      expect(ui.isMission(c.input)).toBe(server.isMission(c.input));
      expect(ui.isEpic(c.input)).toBe(server.isEpic(c.input));
      expect(ui.isLand(c.input)).toBe(server.isLand(c.input));
      expect(ui.isLeaf(c.input)).toBe(server.isLeaf(c.input));
    });
  }
});

describe('todoKind (UI mirror) — column beats title', () => {
  it('kind column wins over a conflicting title prefix', () => {
    expect(ui.kindOf({ kind: 'epic', title: '[MISSION] x' })).toBe('epic');
  });
});

describe('todoKind (UI mirror) — topic tags are not roles', () => {
  it('a [UI] title tag does not affect kindOf', () => {
    expect(ui.kindOf({ kind: 'leaf', title: '[UI] Plan list doesn\'t refresh' })).toBe('leaf');
  });

  it('stripKindPrefix leaves a non-role bracket tag unchanged', () => {
    expect(ui.stripKindPrefix('[UI] Plan list doesn\'t refresh')).toBe(
      '[UI] Plan list doesn\'t refresh',
    );
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
      'Stop reading [EPIC] out of titles',
    );
  });

  it('null title becomes empty string', () => {
    expect(ui.stripKindPrefix(null)).toBe('');
  });

  it('stripKindPrefix does not decide a role', () => {
    expect(ui.kindOf({ kind: 'epic', title: ui.stripKindPrefix('[EPIC] Foo') })).toBe('epic');
  });
});

describe('todoKind (UI mirror) — strip helper agrees with the server', () => {
  const corpus = [
    '[EPIC] Foo',
    '[MISSION]  Bar',
    '[LAND] Land X → master',
    '[epic] lowercase',
    '[UI] Plan list doesn\'t refresh',
    '[EPIC] [LAND] weird',
    'Stop reading [EPIC] out of titles',
    'Bugfix inbox',
    '',
    null,
    undefined,
  ];

  for (const t of corpus) {
    it(JSON.stringify(t), () => {
      expect(ui.stripKindPrefix(t)).toBe(server.stripLabel(t));
    });
  }

  it('stripKindPrefix is an alias of stripLabel (no duplicated rules)', () => {
    expect(ui.stripKindPrefix).toBe(ui.stripLabel);
  });

  it('stripKindPrefix gains .trim() to agree with server', () => {
    expect(ui.stripKindPrefix('[EPIC]  Foo ')).toBe('Foo');
  });
});

describe('todoKind (UI mirror) — structure trap (9acb7cb2 bug)', () => {
  it('split leaf with 9 children is still a leaf', () => {
    const splitLeaf = { id: '9acb7cb2', kind: 'leaf' as const, title: 'split leaf', parentId: 'e1' };
    expect(ui.isLeaf(splitLeaf)).toBe(true);
    expect(ui.isEpic(splitLeaf)).toBe(false);
  });

  it('childless epic is still an epic', () => {
    expect(ui.isEpic({ id: 'e-new', kind: 'epic' as const, parentId: null })).toBe(true);
  });

  it('epicIdSet includes epics by declared kind (not by presence of children)', () => {
    const inputs = server.STRUCTURE_FIXTURE.map(f => f.input);
    const epicIds = ui.epicIdSet(inputs);
    expect(epicIds).toEqual(new Set(['e-new', 'e1']));
    expect(epicIds.has('9acb7cb2')).toBe(false);
  });

  it('parentEpicIdOf returns parent id only if parent is an epic', () => {
    const splitLeaf = { id: '9acb7cb2', kind: 'leaf' as const, title: 'split leaf', parentId: 'e1' };
    const childOfLeaf = { id: 'c1', kind: 'leaf' as const, title: 'file 1 of 9', parentId: '9acb7cb2' };
    const landNode = { id: 'l1', kind: 'land' as const, title: 'merge to master', parentId: 'e1' };
    const epicIds = new Set(['e-new', 'e1']);

    expect(ui.parentEpicIdOf(childOfLeaf, epicIds)).toBe(null);
    expect(ui.parentEpicIdOf(landNode, epicIds)).toBe('e1');
  });

  it('ui.epicIdSet and server.epicIdSet produce identical results', () => {
    const inputs = server.STRUCTURE_FIXTURE.map(f => f.input);
    expect(ui.epicIdSet(inputs)).toEqual(server.epicIdSet(inputs));
  });

  it('ui.parentEpicIdOf and server.parentEpicIdOf agree on all structure fixture cases', () => {
    const inputs = server.STRUCTURE_FIXTURE.map(f => f.input);
    const epicIds = server.epicIdSet(inputs);
    for (const f of server.STRUCTURE_FIXTURE) {
      expect(ui.parentEpicIdOf(f.input, epicIds)).toBe(server.parentEpicIdOf(f.input, epicIds));
    }
  });
});

describe('todoKind (UI mirror) — no title reader remains', () => {
  it('kindFromTitle no longer exists', () => {
    expect((ui as Record<string, unknown>).kindFromTitle).toBeUndefined();
  });

  it('kindFromTitle no longer exists on the server module either', () => {
    expect((server as Record<string, unknown>).kindFromTitle).toBeUndefined();
  });

  it('stripKindPrefix is a function that does not return a TodoKind', () => {
    expect(typeof ui.stripKindPrefix).toBe('function');
    expect(ui.kindOf({ kind: 'epic', title: ui.stripKindPrefix('[EPIC] Foo') })).toBe('epic');
  });

  it('create-time defaults (kindOfInput) are not leaked into render path', () => {
    expect((ui as Record<string, unknown>).kindOfInput).toBeUndefined();
    expect((ui as Record<string, unknown>).isEpicInput).toBeUndefined();
    expect((ui as Record<string, unknown>).isMissionInput).toBeUndefined();
  });
});

describe('todoKind (UI mirror) — mission is a root, and root is not a role', () => {
  // File-local: STRUCTURE_FIXTURE (server) has no mission row, and this leaf may not edit it.
  const mission = { id: 'm1', kind: 'mission' as const, title: 'Converge on X', parentId: null };
  const epicUnderMission = { id: 'e2', kind: 'epic' as const, title: 'child epic', parentId: 'm1' };
  const rootEpic = { id: 'e-new', kind: 'epic' as const, title: 'Freshly created epic', parentId: null };

  it('a mission is isMission and is a root', () => {
    expect(ui.isMission(mission)).toBe(true);
    expect(ui.isEpic(mission)).toBe(false);
    expect(ui.isLeaf(mission)).toBe(false);
    expect(mission.parentId).toBe(null);          // root by STRUCTURE …
  });

  it('an epic parented to a mission is still an epic', () => {
    expect(ui.isEpic(epicUnderMission)).toBe(true);     // … but not by ROLE
    expect(ui.isMission(epicUnderMission)).toBe(false);
  });

  it('parentId === null does not imply epic — it means epic OR mission', () => {
    // Both are roots; only `kind` separates them.
    expect(rootEpic.parentId).toBe(mission.parentId);
    expect(ui.kindOf(rootEpic)).not.toBe(ui.kindOf(mission));
  });

  it('epicIdSet admits the root epic and the nested epic, never the root mission', () => {
    const ids = ui.epicIdSet([mission, epicUnderMission, rootEpic]);
    expect(ids).toEqual(new Set(['e2', 'e-new']));
    expect(ids.has('m1')).toBe(false);
  });

  it('parentEpicIdOf: an epic under a mission has no parent EPIC', () => {
    const ids = ui.epicIdSet([mission, epicUnderMission, rootEpic]);
    expect(ui.parentEpicIdOf(epicUnderMission, ids)).toBe(null);
  });

  it('ui and server agree on the mission scenario', () => {
    const todos = [mission, epicUnderMission, rootEpic];
    expect(ui.epicIdSet(todos)).toEqual(server.epicIdSet(todos));
    for (const t of todos) expect(ui.kindOf(t)).toBe(server.kindOf(t));
  });

  it('labelFor(mission) is the display label; the stored title carries no prefix', () => {
    expect(ui.labelFor('mission')).toBe('[MISSION]');
    expect(mission.title).toBe('Converge on X');       // no role prefix stored
    expect(ui.stripKindPrefix(mission.title)).toBe(mission.title);
  });
});
