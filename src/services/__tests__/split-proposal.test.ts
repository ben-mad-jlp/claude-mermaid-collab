import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  SPLIT_PROPOSAL_TAG,
  SPLIT_PROPOSAL_TIMEOUT_MS,
  SPLIT_PROPOSAL_POLL_MS,
  raisedNodeBudget,
  awaitSplitDecision,
  proposeSplit,
  findOpenSplitProposal,
  listOpenSplitProposals,
} from '../split-proposal';
import { createEscalation, listEscalations, resolveEscalation, getEscalationDecision, recordEscalationDecision } from '../supervisor-store';

describe('split-proposal', () => {
  beforeEach(() => {
    // Clean up any existing escalations
    for (const e of listEscalations('open')) {
      if (e.questionText.startsWith(SPLIT_PROPOSAL_TAG)) {
        resolveEscalation(e.id, 'resolved', 'ai');
      }
    }
  });

  describe('raisedNodeBudget', () => {
    it('doubles the base budget', () => {
      expect(raisedNodeBudget(20)).toBe(40);
      expect(raisedNodeBudget(10)).toBe(20);
      expect(raisedNodeBudget(1)).toBe(2);
    });
  });

  describe('awaitSplitDecision', () => {
    it('returns "timeout" when deadline passes with no answer', async () => {
      const createdAt = 1000;
      let currentTime = createdAt + 30; // Start 30ms after creation
      const sleepCalls: number[] = [];

      const result = await awaitSplitDecision({
        escalationId: 'test-id',
        createdAt,
        timeoutMs: 100,
        pollMs: 20,
        now: () => currentTime,
        sleep: async (ms) => {
          sleepCalls.push(ms);
          currentTime += ms; // Simulate time passing
        },
        readDecision: () => null,
      });

      expect(result).toBe('timeout');
      expect(sleepCalls.length).toBeGreaterThan(0);
      expect(sleepCalls.length).toBeLessThanOrEqual(4); // (1100 - 1030) / 20 ≈ 3.5
    });

    it('returns "split" when optionId is "split"', async () => {
      const result = await awaitSplitDecision({
        escalationId: 'test-id',
        createdAt: 1000,
        readDecision: () => ({ optionId: 'split' }),
        now: () => 1000,
        sleep: async () => {},
      });
      expect(result).toBe('split');
    });

    it('returns "linear" when optionId is "linear"', async () => {
      const result = await awaitSplitDecision({
        escalationId: 'test-id',
        createdAt: 1000,
        readDecision: () => ({ optionId: 'linear' }),
        now: () => 1000,
        sleep: async () => {},
      });
      expect(result).toBe('linear');
    });

    it('returns "linear" for any non-"split" optionId (safe default)', async () => {
      const result = await awaitSplitDecision({
        escalationId: 'test-id',
        createdAt: 1000,
        readDecision: () => ({ optionId: 'weird-value' }),
        now: () => 1000,
        sleep: async () => {},
      });
      expect(result).toBe('linear');
    });

    it('returns "linear" for null optionId (note-only answer)', async () => {
      const result = await awaitSplitDecision({
        escalationId: 'test-id',
        createdAt: 1000,
        readDecision: () => ({ optionId: null }),
        now: () => 1000,
        sleep: async () => {},
      });
      expect(result).toBe('linear');
    });

    it('anchors deadline to createdAt (re-claim inherits original clock)', async () => {
      const createdAt = 1000;
      const now = 2000; // 1000ms later
      let sleepCount = 0;

      const result = await awaitSplitDecision({
        escalationId: 'test-id',
        createdAt,
        timeoutMs: 500, // deadline = 1000 + 500 = 1500, which is < now (2000)
        pollMs: 1000,
        now: () => now,
        sleep: async () => {
          sleepCount += 1;
          if (sleepCount > 10) throw new Error('infinite loop');
        },
        readDecision: () => null,
      });

      expect(result).toBe('timeout');
      // Should return immediately with zero sleeps since now >= deadline
      expect(sleepCount).toBe(0);
    });
  });

  describe('proposeSplit / findOpenSplitProposal / listOpenSplitProposals', () => {
    it('creates a new proposal on first call', () => {
      const proposal = proposeSplit({
        project: 'test-proj',
        session: 'sess1',
        leaf: { id: 'leaf1', title: 'My Leaf' },
        itemCount: 3,
        reason: 'too big',
      });

      expect(proposal.isNew).toBe(true);
      expect(proposal.escalationId).toBeTruthy();
      expect(proposal.createdAt).toBeGreaterThan(0);
    });

    it('dedupes a second proposal for the same leaf', () => {
      const prop1 = proposeSplit({
        project: 'test-proj',
        session: 'sess1',
        leaf: { id: 'leaf1', title: 'Leaf' },
        itemCount: 3,
        reason: 'reason 1',
      });

      const prop2 = proposeSplit({
        project: 'test-proj',
        session: 'sess1',
        leaf: { id: 'leaf1', title: 'Leaf' },
        itemCount: 5, // different count, different reason
        reason: 'reason 2',
      });

      expect(prop2.isNew).toBe(false);
      expect(prop2.escalationId).toBe(prop1.escalationId);
      expect(prop2.createdAt).toBe(prop1.createdAt);
    });

    it('creates separate proposals for different leaves', () => {
      const prop1 = proposeSplit({
        project: 'test-proj',
        session: 'sess1',
        leaf: { id: 'leaf1', title: 'Leaf 1' },
        itemCount: 3,
        reason: 'reason 1',
      });

      const prop2 = proposeSplit({
        project: 'test-proj',
        session: 'sess1',
        leaf: { id: 'leaf2', title: 'Leaf 2' },
        itemCount: 3,
        reason: 'reason 1',
      });

      expect(prop1.escalationId).not.toBe(prop2.escalationId);
    });

    it('findOpenSplitProposal returns the proposal for a leaf', () => {
      const prop = proposeSplit({
        project: 'test-proj',
        session: 'sess1',
        leaf: { id: 'leaf1', title: 'Leaf' },
        itemCount: 3,
        reason: 'reason',
      });

      const found = findOpenSplitProposal('test-proj', 'leaf1');
      expect(found).toBeTruthy();
      expect(found!.id).toBe(prop.escalationId);
      expect(found!.questionText).toContain(SPLIT_PROPOSAL_TAG);
      expect(found!.questionText).toContain('Leaf');
    });

    it('findOpenSplitProposal returns null when no proposal exists', () => {
      const found = findOpenSplitProposal('test-proj', 'nonexistent');
      expect(found).toBeNull();
    });

    it('listOpenSplitProposals returns all open proposals in a project', () => {
      const prop1 = proposeSplit({
        project: 'test-proj',
        session: 'sess1',
        leaf: { id: 'leaf1', title: 'Leaf 1' },
        itemCount: 3,
        reason: 'reason',
      });

      const prop2 = proposeSplit({
        project: 'test-proj',
        session: 'sess1',
        leaf: { id: 'leaf2', title: 'Leaf 2' },
        itemCount: 5,
        reason: 'reason',
      });

      const proposals = listOpenSplitProposals('test-proj');
      expect(proposals.length).toBeGreaterThanOrEqual(2);
      const ids = proposals.map((p) => p.escalationId);
      expect(ids).toContain(prop1.escalationId);
      expect(ids).toContain(prop2.escalationId);
    });

    it('proposal questionText states no children exist yet and timeout → linear', () => {
      const prop = proposeSplit({
        project: 'test-proj',
        session: 'sess1',
        leaf: { id: 'leaf1', title: 'My Task' },
        itemCount: 5,
        reason: 'too many files',
      });

      const escalation = findOpenSplitProposal('test-proj', 'leaf1');
      expect(escalation!.questionText).toContain('No children have been created yet');
      expect(escalation!.questionText).toContain('no answer by timeout');
      expect(escalation!.questionText).toContain('Linear');
      expect(escalation!.recommended).toBe('linear');
    });

    it('proposal has both "split" and "linear" options', () => {
      proposeSplit({
        project: 'test-proj',
        session: 'sess1',
        leaf: { id: 'leaf1', title: 'Leaf' },
        itemCount: 3,
        reason: 'reason',
      });

      const escalation = findOpenSplitProposal('test-proj', 'leaf1');
      const optionIds = escalation!.options!.map((o) => o.id);
      expect(optionIds).toContain('split');
      expect(optionIds).toContain('linear');
    });
  });
});
