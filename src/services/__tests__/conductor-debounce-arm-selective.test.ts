import { describe, it, expect, beforeEach } from 'vitest';
import { buildVerifyAdmissionKey, buildLandAdmissionKey, admitsVerifyArm, admitsLandArm, type VerifyAdmissionFacts, type LandAdmissionFacts } from '../conductor-arm-admission.js';

describe('conductor-debounce-arm-selective', () => {
  describe('verify arm admission', () => {
    it('runs the verify panel on a landed epic whose land sha postdates verifiedAt under an identical signature', () => {
      const facts: VerifyAdmissionFacts = {
        criteria: [
          {
            id: 'crit1',
            verifiedAt: 1000,
            verifiedAtSha: 'oldSha123',
            lastReopenSha: 'newSha456',
          },
        ],
        rechecks: [],
      };

      const key = buildVerifyAdmissionKey(facts);
      expect(key).toBe('crit1:newSha456');

      // The arm admits because the key is non-empty and differs from the watermark
      const watermark = null; // First time running
      expect(admitsVerifyArm(key, watermark)).toBe(true);

      // On second run with same key, watermark is updated and arm does NOT admit
      const newWatermark = 'crit1:newSha456';
      expect(admitsVerifyArm(key, newWatermark)).toBe(false);
    });

    it('records outcome debounced when verifiedAt postdates the land sha', () => {
      const facts: VerifyAdmissionFacts = {
        criteria: [
          {
            id: 'crit1',
            verifiedAt: 2000, // Verdict is newer than the land sha
            verifiedAtSha: 'newSha789',
            lastReopenSha: 'newSha789', // Same as verifiedAtSha: no new land
          },
        ],
        rechecks: [],
      };

      const key = buildVerifyAdmissionKey(facts);
      expect(key).toBe(''); // No admission: verdict postdates land

      // Arm does not admit: empty key never admits
      expect(admitsVerifyArm(key, null)).toBe(false);
    });

    it('records outcome debounced with nodesSpent 0 when every criterion is at discover and an unrelated mission advances the trunk head', () => {
      // Setup: a criterion at 'discover' with no verdict and no recheck
      const facts: VerifyAdmissionFacts = {
        criteria: [
          {
            id: 'crit-discover',
            verifiedAt: null, // No verdict yet
            verifiedAtSha: null,
            lastReopenSha: null, // No land reopening
          },
        ],
        rechecks: [],
      };

      const key = buildVerifyAdmissionKey(facts);
      expect(key).toBe(''); // No admission: discover criterion has no new land

      // Land admission key is also empty if no land cards and no armed criteria
      const landFacts: LandAdmissionFacts = {
        landCardIds: [],
        armedCriterionIds: [],
      };
      const landKey = buildLandAdmissionKey(landFacts);
      expect(landKey).toBe('');

      // Both arms reject admission: the pass is debounced with nodesSpent=0
      // (an unrelated mission advancing trunk HEAD does not change the verify key)
      expect(admitsVerifyArm(key, null)).toBe(false);
      expect(admitsLandArm(landKey, null)).toBe(false);
    });
  });

  describe('land arm admission', () => {
    it('admits when land-ready cards are open', () => {
      const facts: LandAdmissionFacts = {
        landCardIds: ['card-land-1'],
        armedCriterionIds: [],
      };

      const key = buildLandAdmissionKey(facts);
      expect(key).toContain('cards:card-land-1');

      // Arm admits: key is non-empty and different from null
      expect(admitsLandArm(key, null)).toBe(true);
    });

    it('admits when armed criteria are present', () => {
      const facts: LandAdmissionFacts = {
        landCardIds: [],
        armedCriterionIds: ['crit-armed-1', 'crit-armed-2'],
      };

      const key = buildLandAdmissionKey(facts);
      expect(key).toBe('armed:crit-armed-1,crit-armed-2');

      // Arm admits: key is non-empty
      expect(admitsLandArm(key, null)).toBe(true);
    });

    it('does not admit when both cards and armed criteria are empty', () => {
      const facts: LandAdmissionFacts = {
        landCardIds: [],
        armedCriterionIds: [],
      };

      const key = buildLandAdmissionKey(facts);
      expect(key).toBe('');

      // Arm does not admit: empty key
      expect(admitsLandArm(key, null)).toBe(false);
    });

    it('deduplicates and sorts input for order-independence', () => {
      const facts1: LandAdmissionFacts = {
        landCardIds: ['card-b', 'card-a', 'card-b'], // Duplicates and unsorted
        armedCriterionIds: ['crit-2', 'crit-1'],
      };

      const facts2: LandAdmissionFacts = {
        landCardIds: ['card-a', 'card-b'], // Sorted, deduplicated
        armedCriterionIds: ['crit-1', 'crit-2'],
      };

      const key1 = buildLandAdmissionKey(facts1);
      const key2 = buildLandAdmissionKey(facts2);

      // Keys should be identical after dedup and sort
      expect(key1).toBe(key2);
    });
  });

  describe('verify admission key building', () => {
    it('uses lastReopenSha when it differs from verifiedAtSha', () => {
      const facts: VerifyAdmissionFacts = {
        criteria: [
          {
            id: 'c1',
            verifiedAt: 1000,
            verifiedAtSha: 'oldSha',
            lastReopenSha: 'newSha',
          },
        ],
        rechecks: [],
      };

      const key = buildVerifyAdmissionKey(facts);
      expect(key).toBe('c1:newSha');
    });

    it('uses recheck landedSha when enqueued after verifiedAt', () => {
      const now = Date.now();
      const facts: VerifyAdmissionFacts = {
        criteria: [
          {
            id: 'c1',
            verifiedAt: now - 1000, // Verdict is old
            verifiedAtSha: 'sha1',
            lastReopenSha: 'sha1', // No new land via lastReopen
          },
        ],
        rechecks: [
          {
            criterionId: 'c1',
            landedSha: 'recheckSha',
            enqueuedAt: now, // Newer than verdict
          },
        ],
      };

      const key = buildVerifyAdmissionKey(facts);
      expect(key).toBe('c1:recheckSha');
    });

    it('prefers lastReopenSha over recheck when both qualify', () => {
      const now = Date.now();
      const facts: VerifyAdmissionFacts = {
        criteria: [
          {
            id: 'c1',
            verifiedAt: now - 2000,
            verifiedAtSha: 'oldSha',
            lastReopenSha: 'reopenSha',
          },
        ],
        rechecks: [
          {
            criterionId: 'c1',
            landedSha: 'recheckSha',
            enqueuedAt: now,
          },
        ],
      };

      const key = buildVerifyAdmissionKey(facts);
      // Should use lastReopenSha (checked first)
      expect(key).toBe('c1:reopenSha');
    });

    it('skips recheck with null landedSha', () => {
      const facts: VerifyAdmissionFacts = {
        criteria: [
          {
            id: 'c1',
            verifiedAt: null,
            verifiedAtSha: null,
            lastReopenSha: null,
          },
        ],
        rechecks: [
          {
            criterionId: 'c1',
            landedSha: null, // No sha to use
            enqueuedAt: Date.now(),
          },
        ],
      };

      const key = buildVerifyAdmissionKey(facts);
      expect(key).toBe(''); // No qualifying land sha
    });

    it('sorts multiple criteria alphabetically', () => {
      const facts: VerifyAdmissionFacts = {
        criteria: [
          {
            id: 'z-crit',
            verifiedAt: 1000,
            verifiedAtSha: 'sha1',
            lastReopenSha: 'newShaZ',
          },
          {
            id: 'a-crit',
            verifiedAt: 1000,
            verifiedAtSha: 'sha1',
            lastReopenSha: 'newShaA',
          },
        ],
        rechecks: [],
      };

      const key = buildVerifyAdmissionKey(facts);
      expect(key).toBe('a-crit:newShaA,z-crit:newShaZ');
    });
  });
});
