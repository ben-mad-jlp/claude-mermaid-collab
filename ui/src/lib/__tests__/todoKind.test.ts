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
    expect(ui.kindOf({ kind: 'leaf', title: '[UI] Plan list doesn’t refresh' })).toBe('leaf');
  });

  it('stripKindPrefix leaves a non-role bracket tag unchanged', () => {
    expect(ui.stripKindPrefix('[UI] Plan list doesn’t refresh')).toBe(
      '[UI] Plan list doesn’t refresh',
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
  // No trailing whitespace in this corpus: server.stripLabel() additionally
  // .trim()s (a deliberate display-trim divergence, pinned separately below).
  const corpus = [
    '[EPIC] Foo',
    '[MISSION]  Bar',
    '[LAND] Land X → master',
    '[epic] lowercase',
    '[UI] Plan list doesn’t refresh',
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

  it('pins the intentional server-side .trim() divergence on trailing whitespace', () => {
    // server.stripLabel() additionally trims trailing whitespace (a display
    // canonicalisation); ui.stripKindPrefix() does not. This is deliberate —
    // not a bug to "fix" — hence the corpus above excludes trailing whitespace.
    expect(ui.stripKindPrefix('[EPIC] Foo ')).toBe('Foo ');
    expect(server.stripLabel('[EPIC] Foo ')).toBe('Foo');
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
});
