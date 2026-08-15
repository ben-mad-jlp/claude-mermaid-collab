/**
 * campaign-scheduling.test.ts — Unit tests for campaign scheduling throttle and runner.
 *
 * Pure unit tests with no DB or filesystem. All functions and pass implementations are injected.
 * Calls _resetCampaignPassThrottle() in beforeEach to keep tests order-independent.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import {
  CAMPAIGN_PASS_INTERVAL_MS,
  CAMPAIGN_PASS_SESSION,
  shouldRunCampaignPass,
  _resetCampaignPassThrottle,
  runCampaignPassForProject,
} from '../campaign-scheduling';
import type { CampaignPassResult } from '../campaign-pass';

describe('campaign-scheduling', () => {
  beforeEach(() => {
    _resetCampaignPassThrottle();
  });

  describe('shouldRunCampaignPass', () => {
    it('shouldRunCampaignPass runs on first call, throttles inside the interval, re-arms past it', () => {
      const now = 1000;
      const project = '/test/project';

      // First call always returns true and stamps the map
      expect(shouldRunCampaignPass(project, now)).toBe(true);

      // Inside the interval, returns false and does NOT advance the clock
      expect(shouldRunCampaignPass(project, now + CAMPAIGN_PASS_INTERVAL_MS - 1)).toBe(false);

      // At the interval boundary (measured from the FIRST stamp), returns true
      expect(shouldRunCampaignPass(project, now + CAMPAIGN_PASS_INTERVAL_MS)).toBe(true);
    });
  });

  describe('_resetCampaignPassThrottle', () => {
    it('_resetCampaignPassThrottle re-arms one project by name and all projects when argless', () => {
      const now = 1000;
      const projectA = '/test/a';
      const projectB = '/test/b';

      // Stamp both projects
      shouldRunCampaignPass(projectA, now);
      shouldRunCampaignPass(projectB, now);

      // Both should be throttled at the same now
      expect(shouldRunCampaignPass(projectA, now + 100)).toBe(false);
      expect(shouldRunCampaignPass(projectB, now + 100)).toBe(false);

      // Reset /a only
      _resetCampaignPassThrottle(projectA);

      // /a should be due, /b should still be throttled
      expect(shouldRunCampaignPass(projectA, now + 100)).toBe(true);
      expect(shouldRunCampaignPass(projectB, now + 100)).toBe(false);

      // Argless reset clears both
      _resetCampaignPassThrottle();

      // Both should now be due
      expect(shouldRunCampaignPass(projectA, now + 100)).toBe(true);
      expect(shouldRunCampaignPass(projectB, now + 100)).toBe(true);
    });
  });

  describe('runCampaignPassForProject', () => {
    it('runCampaignPassForProject invokes the pass once per campaign', async () => {
      const project = '/test/project';
      const campaign1 = { id: 'campaign-1', project, title: 'Campaign 1', createdAt: 1000 };
      const campaign2 = { id: 'campaign-2', project, title: 'Campaign 2', createdAt: 1001 };

      let passCallCount = 0;
      const passCallLog: Array<{ project: string; campaignId: string; session: string }> = [];

      const mockListCampaigns = () => [campaign1, campaign2];
      const mockRunCampaignPass = async (proj: string, campaignId: string, session: string) => {
        passCallCount++;
        passCallLog.push({ project: proj, campaignId, session });
        return {
          groups: [],
          forged: [],
          skipped: [],
          executed: [],
        } as CampaignPassResult;
      };

      const result = await runCampaignPassForProject(project, {
        deps: {
          listCampaigns: mockListCampaigns,
          runCampaignPass: mockRunCampaignPass,
        },
      });

      // Verify pass was called exactly twice
      expect(passCallCount).toBe(2);
      expect(result.campaigns).toEqual(['campaign-1', 'campaign-2']);
      expect(result.results).toHaveLength(2);

      // Verify default session was used
      expect(passCallLog[0].session).toBe(CAMPAIGN_PASS_SESSION);
      expect(passCallLog[1].session).toBe(CAMPAIGN_PASS_SESSION);

      // Verify campaign ids were threaded correctly
      expect(passCallLog[0].campaignId).toBe('campaign-1');
      expect(passCallLog[1].campaignId).toBe('campaign-2');
    });

    it('runCampaignPassForProject keeps going when one campaign throws', async () => {
      const project = '/test/project';
      const campaign1 = { id: 'campaign-1', project, title: 'Campaign 1', createdAt: 1000 };
      const campaign2 = { id: 'campaign-2', project, title: 'Campaign 2', createdAt: 1001 };

      let passCallCount = 0;
      const passCallLog: string[] = [];

      const mockListCampaigns = () => [campaign1, campaign2];
      const mockRunCampaignPass = async (proj: string, campaignId: string, session: string) => {
        passCallCount++;
        passCallLog.push(campaignId);

        // First campaign throws
        if (campaignId === 'campaign-1') {
          throw new Error('First campaign failed');
        }

        // Second campaign resolves
        return {
          groups: [],
          forged: [],
          skipped: [],
          executed: [],
        } as CampaignPassResult;
      };

      // Suppress console.warn output for this test
      const originalWarn = console.warn;
      let warnCalled = false;
      console.warn = () => {
        warnCalled = true;
      };

      try {
        const result = await runCampaignPassForProject(project, {
          deps: {
            listCampaigns: mockListCampaigns,
            runCampaignPass: mockRunCampaignPass,
          },
        });

        // Pass should have been called twice despite the first throw
        expect(passCallCount).toBe(2);
        expect(passCallLog).toEqual(['campaign-1', 'campaign-2']);

        // Only the surviving campaign should be in results
        expect(result.results).toHaveLength(1);
        expect(result.campaigns).toEqual(['campaign-2']);

        // console.warn should have been called for the failed campaign
        expect(warnCalled).toBe(true);
      } finally {
        console.warn = originalWarn;
      }
    });
  });
});
