import { describe, it, expect } from 'bun:test';
import {
  CHAMBER_CONSTITUTION,
  CHAMBER_GENERALS,
  AGENDA_ARTICLE,
  SHARED_ARTICLE_NUMBERS,
  buildPresidentSystemPrompt,
  buildGeneralSystemPrompt,
  CHAMBER_ROSTER,
  rosterEntryFor,
} from '../chamber-constitution';

describe('chamber constitution', () => {
  it('president system prompt opens with the Article I Purpose text', () => {
    const { system } = buildPresidentSystemPrompt();

    // Article I (Purpose) is the first article
    const purposeArticle = CHAMBER_CONSTITUTION[0];
    expect(purposeArticle.title).toBe('Purpose');

    // System prompt must start with the Article I Purpose text
    expect(system.startsWith(purposeArticle.text)).toBe(true);
  });

  it('each general prompt carries the shared articles plus exactly one agenda article', () => {
    for (const general of CHAMBER_GENERALS) {
      const { system } = buildGeneralSystemPrompt(general);

      // Count how many article texts appear in the system prompt
      const matchingArticles = CHAMBER_CONSTITUTION.filter(a => system.includes(a.text));
      const articleCount = matchingArticles.length;

      // Should have shared articles (4) plus exactly one agenda article (1) = 5 total
      const expectedCount = SHARED_ARTICLE_NUMBERS.length + 1;
      expect(articleCount).toBe(expectedCount);

      // Verify all shared articles are present
      for (const sharedNumber of SHARED_ARTICLE_NUMBERS) {
        const sharedArticle = CHAMBER_CONSTITUTION.find(a => a.number === sharedNumber);
        expect(system.includes(sharedArticle!.text)).toBe(true);
      }

      // Verify exactly one agenda article is present (the one assigned to this general)
      const agendaNumber = AGENDA_ARTICLE[general];
      const agendaArticle = CHAMBER_CONSTITUTION.find(a => a.number === agendaNumber);
      expect(system.includes(agendaArticle!.text)).toBe(true);
    }
  });

  it('the roster entry for each general holds a non-empty agenda description matching its constitution article', () => {
    // Check roster size
    expect(CHAMBER_ROSTER.length).toBe(6);

    // Check all five generals are in the roster
    for (const general of CHAMBER_GENERALS) {
      const entry = rosterEntryFor(general);
      expect(entry).toBeDefined();
      expect(entry!.name).toBe(general);

      // Agenda must be non-empty
      expect(entry!.agenda.trim().length).toBeGreaterThan(0);

      // Agenda must contain the title of the assigned article (case-insensitive)
      const agendaNumber = AGENDA_ARTICLE[general];
      const agendaArticle = CHAMBER_CONSTITUTION.find(a => a.number === agendaNumber);
      expect(agendaArticle).toBeDefined();

      const agendaLower = entry!.agenda.toLowerCase();
      const titleLower = agendaArticle!.title.toLowerCase();
      expect(agendaLower).toContain(titleLower);
    }

    // Check president entry exists
    const presidentEntry = rosterEntryFor('president');
    expect(presidentEntry).toBeDefined();
    expect(presidentEntry!.name).toBe('president');
    expect(presidentEntry!.agenda.trim().length).toBeGreaterThan(0);
    // President's agenda should contain "decision"
    expect(presidentEntry!.agenda.toLowerCase()).toContain('decision');
  });
});
