/**
 * conductor-wake-context — the WAKE CONTEXT block injected into the conductor node's prompt.
 *
 * Its own file (mirroring conductor-signature.test.ts) because the renderer is PURE: no store, no
 * db, no clock, no module mocks. Everything is plain data passed in, so these tests state the
 * rendering contract with zero harness setup. The pass-level wiring (block reaches the prompt,
 * fail-open) is tested in conductor-pass.test.ts where the pass harness already lives.
 */
import { describe, test, expect } from 'bun:test';
import {
  buildWakeContextBlock,
  formatWakeAge,
  WAKE_CARD_RENDER_CAP,
  WAKE_CARD_EXCERPT_CHARS,
  type WakeCard,
} from '../conductor-wake-context';

const NOW = 1_800_000_000_000;
const LAST_PASS = NOW - 60 * 60 * 1000; // 1h ago

function card(over: Partial<WakeCard> & { id: string }): WakeCard {
  return {
    kind: 'blocker',
    createdAt: NOW - 30 * 60 * 1000,
    conditionKey: `blocker:${over.id}`,
    recurrenceCount: 0,
    questionText: `question for ${over.id}`,
    ...over,
  };
}

describe('buildWakeContextBlock — open cards section', () => {
  test('names every open card FULL id, kind and conditionKey', () => {
    const block = buildWakeContextBlock({
      missionId: 'm1',
      now: NOW,
      lastPassAt: LAST_PASS,
      openCards: [
        card({ id: 'esc-aaaaaaaa-1111-2222-3333-444444444444', kind: 'criterion-serve-cap', conditionKey: 'serve-cap:c1', recurrenceCount: 4 }),
        card({ id: 'esc-bbbbbbbb-5555-6666-7777-888888888888', kind: 'leaf-infra-rejected', conditionKey: 'infra:leaf-9' }),
      ],
    });
    expect(block).toContain('esc-aaaaaaaa-1111-2222-3333-444444444444');
    expect(block).toContain('esc-bbbbbbbb-5555-6666-7777-888888888888');
    expect(block).toContain('criterion-serve-cap');
    expect(block).toContain('leaf-infra-rejected');
    expect(block).toContain('serve-cap:c1');
    expect(block).toContain('infra:leaf-9');
    expect(block).toContain('recurrenceCount: 4');
    // The card content itself, not a pointer to go fetch it.
    expect(block).toContain('question for esc-aaaaaaaa-1111-2222-3333-444444444444');
    expect(block).toContain('act on these; do not go looking for them');
  });

  test('zero open cards ⇒ an explicit "none open" line (absence is stated, not implied)', () => {
    const block = buildWakeContextBlock({ missionId: 'm1', now: NOW, lastPassAt: LAST_PASS, openCards: [] });
    expect(block).toContain('none open');
    expect(block).toContain('NO open escalation card on this mission');
  });

  test('over the render cap ⇒ truncation notice states the OMITTED count and points at escalation_list', () => {
    const many = Array.from({ length: WAKE_CARD_RENDER_CAP + 3 }, (_, i) =>
      card({ id: `esc-${i}`, createdAt: NOW - (100 - i) * 60 * 1000 }),
    );
    const block = buildWakeContextBlock({ missionId: 'm1', now: NOW, lastPassAt: LAST_PASS, openCards: many });
    expect(block).toContain(`… 3 more open card(s) OMITTED`);
    expect(block).toContain(`render cap ${WAKE_CARD_RENDER_CAP}`);
    expect(block).toContain('escalation_list');
    // First cap cards rendered, the overflow ones are not.
    expect(block).toContain('id: esc-0');
    expect(block).not.toContain(`id: esc-${WAKE_CARD_RENDER_CAP + 2}`);
  });

  test('a long questionText is excerpted at the cap and marked truncated', () => {
    const block = buildWakeContextBlock({
      missionId: 'm1',
      now: NOW,
      lastPassAt: LAST_PASS,
      openCards: [card({ id: 'esc-long', questionText: 'X'.repeat(WAKE_CARD_EXCERPT_CHARS + 200) })],
    });
    expect(block).toContain('[truncated — escalation_list has the full text]');
    expect(block).not.toContain('X'.repeat(WAKE_CARD_EXCERPT_CHARS + 1));
  });

  test('the FULL-id warning is present so the node never resolves with a short id', () => {
    const block = buildWakeContextBlock({ missionId: 'm1', now: NOW, lastPassAt: LAST_PASS, openCards: [card({ id: 'esc-1' })] });
    expect(block).toContain('a short id silently no-ops');
  });
});

describe('buildWakeContextBlock — why you were woken', () => {
  test('a card created AFTER lastConductorPassAt is marked NEW; one created before is not', () => {
    const block = buildWakeContextBlock({
      missionId: 'm1',
      now: NOW,
      lastPassAt: LAST_PASS,
      openCards: [
        card({ id: 'esc-old', createdAt: LAST_PASS - 5 * 60 * 1000 }),
        card({ id: 'esc-new', createdAt: LAST_PASS + 5 * 60 * 1000 }),
      ],
    });
    expect(block).toContain('NEW card esc-new');
    expect(block).not.toContain('NEW card esc-old');
    const newLine = block.split('\n').find((l) => l.includes('id: esc-new'))!;
    const oldLine = block.split('\n').find((l) => l.includes('id: esc-old'))!;
    expect(newLine).toContain('(NEW since last pass)');
    expect(oldLine).not.toContain('(NEW since last pass)');
  });

  test('a card RESOLVED since the last pass appears in the woken-because section', () => {
    const block = buildWakeContextBlock({
      missionId: 'm1',
      now: NOW,
      lastPassAt: LAST_PASS,
      openCards: [],
      resolvedCards: [card({ id: 'esc-answered', kind: 'criterion-serve-cap', conditionKey: 'serve-cap:c7', resolvedAt: NOW - 60_000 })],
    });
    expect(block).toContain('RESOLVED since your last pass: card esc-answered');
    expect(block).toContain('serve-cap:c7');
    expect(block).toContain('a human ANSWERED this');
    // Resolved cards are NOT open cards.
    expect(block).toContain('none open');
  });

  test('criteria with discover/verify appear in the work list; met/building do not', () => {
    const block = buildWakeContextBlock({
      missionId: 'm1',
      now: NOW,
      lastPassAt: LAST_PASS,
      openCards: [],
      actions: [
        { id: 'c1', action: 'discover' },
        { id: 'c2', action: 'verify' },
        { id: 'c3', action: 'met' },
        { id: 'c4', action: 'building' },
        { id: 'c5', action: 'escalate' },
      ],
    });
    expect(block).toContain('- c1 [discover]');
    expect(block).toContain('- c2 [verify]');
    expect(block).toContain('Criteria ACTIONABLE right now (2)');
    expect(block).not.toContain('c3');
    expect(block).not.toContain('c4');
    expect(block).not.toContain('c5');
  });

  test('nothing attributable ⇒ the empty delta is STATED, not omitted', () => {
    const block = buildWakeContextBlock({
      missionId: 'm1',
      now: NOW,
      lastPassAt: LAST_PASS,
      openCards: [card({ id: 'esc-old', createdAt: LAST_PASS - 60_000 })],
      resolvedCards: [],
      actions: [{ id: 'c1', action: 'building' }],
    });
    expect(block).toContain('WHY YOU WERE WOKEN');
    expect(block).toContain('Nothing could be attributed');
    expect(block).toContain('An empty delta is itself information');
  });

  test('lastPassAt null ⇒ says so and treats every open card as new to the node', () => {
    const block = buildWakeContextBlock({
      missionId: 'm1',
      now: NOW,
      lastPassAt: null,
      openCards: [card({ id: 'esc-1' })],
    });
    expect(block).toContain('no previous conductor pass recorded');
    expect(block).toContain('NEW card esc-1');
  });
});

describe('formatWakeAge', () => {
  test('compact and never negative', () => {
    expect(formatWakeAge(45_000)).toBe('45s');
    expect(formatWakeAge(12 * 60_000)).toBe('12m');
    expect(formatWakeAge((3 * 60 + 12) * 60_000)).toBe('3h12m');
    expect(formatWakeAge((2 * 24 + 3) * 3600_000)).toBe('2d3h');
    expect(formatWakeAge(-5000)).toBe('0s');
  });
});
