/**
 * chamber-constitution.ts — Chamber constitutional framework for campaign governance.
 *
 * The chamber is a decision body whose rules are codified as nine articles. The president rules
 * on whether to close a campaign, while five generals advise on distinct dimensions. Each general
 * receives the shared articles plus one article that frames their specific advisory role.
 *
 * The constitution itself is versioned and ships as code, not prose in a prompt file.
 */

export const CHAMBER_CONSTITUTION_VERSION = 1;

/**
 * An article of the chamber constitution.
 */
export interface ChamberArticle {
  number: number;
  title: string;
  text: string;
}

/**
 * The nine articles of the chamber constitution, governing chamber procedure and scope.
 *
 * Article I (Purpose): Establishes why the chamber exists and its authority.
 * Article II (Advice): Defines the advisory role and obligates generals to offer counsel.
 * Article III (Separation): Separates presidential ruling from advisory dissent.
 * Article IV (Metrics): Frames how evidence is evaluated and decisions are grounded.
 * Article V (Decision): Defines what a ruling is and when it resolves a campaign.
 * Article VI (Restraint): Bounds the chamber's authority and what it may not decide.
 * Article VII (Perimeter): Specifies what campaigns and facts are in scope.
 * Article VIII (Record): Requires a durable, complete transcript of every deliberation.
 * Article IX (Autonomy): Grants the chamber authority to act without human approval.
 */
export const CHAMBER_CONSTITUTION: readonly ChamberArticle[] = [
  {
    number: 1,
    title: 'Purpose',
    text: 'The chamber exists to decide whether a campaign is complete or must remain open. When probes have run and their verdicts are recorded, the chamber examines the evidence and rules on closure. The chamber acts as the final judge of a campaign\'s readiness to close.',
  },
  {
    number: 2,
    title: 'Advice',
    text: 'Five generals advise the president on distinct dimensions of readiness. Each general examines the facts through a dedicated lens and offers counsel. The president weighs all counsel before ruling, but retains final authority over the closure decision.',
  },
  {
    number: 3,
    title: 'Separation',
    text: 'Presidential ruling and general advice are distinct acts. Dissent from any general does not veto the president; the president may rule against unanimous advice if the evidence supports it. No general may be overruled, only disagreed with.',
  },
  {
    number: 4,
    title: 'Metrics',
    text: 'Evidence must be verifiable and recent. Decisions rest on recorded probe verdicts, commanded observations, and facts queryable from the project state at the time of ruling. Absent evidence is not assumed; it is noted as unknown.',
  },
  {
    number: 5,
    title: 'Decision',
    text: 'A ruling is the president\'s determination that a campaign is complete or must remain open. The ruling is final and persisted before any side effect. No campaign may transition to closed without an explicit presidential ruling recorded in the transcript.',
  },
  {
    number: 6,
    title: 'Restraint',
    text: 'The chamber may not modify code, dispatch work, or create new campaigns. The chamber observes the campaign state and judges it; it does not change it. If work is needed, the campaign is ruled incomplete, and the campaign\'s own edges carry the next probes.',
  },
  {
    number: 7,
    title: 'Perimeter',
    text: 'The chamber judges only closed campaigns with all probes run and verdicted. A campaign with pending probes or waiting work is out of scope. The president holds judgment until all signals are in.',
  },
  {
    number: 8,
    title: 'Record',
    text: 'Every deliberation is recorded before the ruling is acted on. The transcript carries the president\'s reasoning, every general\'s counsel and evidence, the facts examined, and the final ruling. The record is immutable and persists for audit.',
  },
  {
    number: 9,
    title: 'Autonomy',
    text: 'The chamber acts without human approval, except where an escalation card is its deliberate output. No campaign requires a human decision to close; the chamber\'s ruling is final and self-executing.',
  },
] as const;

/**
 * The five generals advising the president on campaign readiness.
 *
 * Each general examines the evidence through a distinct lens:
 * - operations: Can the probes run again without failure? Is the rig stable?
 * - intelligence: Have we measured what was asked? Are observations complete?
 * - comptroller: Is there budget remaining? Has cost been tracked accurately?
 * - counsel: Are we interpreting the campaign\'s own intent correctly? Is scope clear?
 * - inspector-general: Has the deliberation been recorded properly? Is the archive complete?
 */
export const CHAMBER_GENERALS: readonly string[] = [
  'operations',
  'intelligence',
  'comptroller',
  'counsel',
  'inspector-general',
] as const;

/**
 * Mapping of each general to their dedicated agenda article.
 *
 * Each general receives the shared articles (1, 3, 5, 9) plus exactly one agenda article:
 * - operations advises under Article II (Advice): what it means to offer counsel
 * - intelligence advises under Article IV (Metrics): how evidence is evaluated
 * - comptroller advises under Article VI (Restraint): bounds and what the chamber cannot decide
 * - counsel advises under Article VII (Perimeter): scope and what is in bounds
 * - inspector-general advises under Article VIII (Record): transcript and archive requirements
 */
export const AGENDA_ARTICLE: Readonly<Record<string, number>> = {
  operations: 2,
  intelligence: 4,
  comptroller: 6,
  counsel: 7,
  'inspector-general': 8,
} as const;

/**
 * A roster entry for a chamber member (general or president).
 *
 * Each entry pairs the member's name with a description of their agenda lens.
 */
export interface ChamberRosterEntry {
  name: string;
  agenda: string;
}

/**
 * The chamber roster: the five generals plus the president.
 *
 * Each member has a distinct agenda lens through which they examine campaign readiness.
 * Each general's agenda incorporates the title of their assigned article.
 */
export const CHAMBER_ROSTER: readonly ChamberRosterEntry[] = [
  {
    name: 'operations',
    agenda: 'Examines rig stability and operational readiness through the lens of advice',
  },
  {
    name: 'intelligence',
    agenda: 'Examines measurement completeness and evidence quality through the lens of metrics',
  },
  {
    name: 'comptroller',
    agenda: 'Examines budget consumption and cost tracking through the lens of restraint',
  },
  {
    name: 'counsel',
    agenda: 'Examines campaign intent and scope definition through the lens of perimeter',
  },
  {
    name: 'inspector-general',
    agenda: 'Examines transcript completeness and archive integrity through the lens of record',
  },
  {
    name: 'president',
    agenda: 'Renders the final decision on campaign closure or continuation',
  },
] as const;

/**
 * Lookup a roster entry by member name.
 *
 * Returns the matching entry if found, or undefined if the name is not recognized.
 * Unlike buildGeneralSystemPrompt, this does not throw; callers render a fallback instead.
 */
export function rosterEntryFor(name: string): ChamberRosterEntry | undefined {
  return CHAMBER_ROSTER.find(e => e.name === name);
}

/**
 * Article numbers shared by all generals and the president.
 *
 * These are the articles NOT claimed by any general\'s agenda:
 * 1 (Purpose), 3 (Separation), 5 (Decision), 9 (Autonomy).
 *
 * Derived from the complement of AGENDA_ARTICLE values.
 */
export const SHARED_ARTICLE_NUMBERS: readonly number[] = [1, 3, 5, 9] as const;

/**
 * Build the system and user prompts for the president\'s ruling on a campaign.
 *
 * The system prompt begins with the Article I (Purpose) text verbatim, followed by all
 * remaining articles and the reply contract. The user prompt carries the campaign context
 * and front summary.
 *
 * Returns { system, user } for use with JudgmentLLM.complete(system, user).
 */
export function buildPresidentSystemPrompt(
  campaignContext?: { title?: string; goal?: string },
): { system: string; user: string } {
  const articles = CHAMBER_CONSTITUTION;
  const purpose = articles[0].text; // Article I Purpose

  // All nine articles, then reply contract
  const articleTexts = articles.map(a => a.text).join('\n\n');

  // NO reply contract here — the decide phase appends the chosenIndex contract.
  // A baked ruling contract made the president answer {"ruling":...} while the
  // decide parser wanted chosenIndex, yielding 'chosen candidate not among
  // surviving candidates' inaction on every convene.
  const system = [purpose, ...articles.slice(1).map(a => a.text)].join('\n\n');

  const campaignSection = campaignContext?.goal
    ? `Campaign Title: ${campaignContext.title || '(untitled)'}
Campaign Goal: ${campaignContext.goal}`
    : `Campaign Title: ${campaignContext?.title || '(untitled)'}
Campaign Goal: (none)`;

  const user = `${campaignSection}

You are the president of the chamber. Examine the campaign state and the counsel from the five generals. Decide whether this campaign is complete and may close, or whether it must remain open pending further work.

Render your ruling with the reasoning that explains the decision.`;

  return { system, user };
}

/**
 * Build the system and user prompts for a general\'s advice on a campaign.
 *
 * The system prompt contains exactly four shared articles (1, 3, 5, 9) plus the one agenda
 * article assigned to this general. It ends with the reply contract naming the expected
 * JSON shape.
 *
 * Throws if the general is not recognized.
 *
 * Returns { system, user } for use with JudgmentLLM.complete(system, user).
 */
export function buildGeneralSystemPrompt(
  general: string,
  campaignContext?: { title?: string; goal?: string },
): { system: string; user: string } {
  const agendaNumber = AGENDA_ARTICLE[general];
  if (agendaNumber === undefined) {
    throw new Error(`unknown general: ${general}`);
  }

  // Shared articles + this general's agenda article
  const sharedArticles = CHAMBER_CONSTITUTION.filter(a => SHARED_ARTICLE_NUMBERS.includes(a.number));
  const agendaArticle = CHAMBER_CONSTITUTION.find(a => a.number === agendaNumber);

  if (!agendaArticle) {
    throw new Error(`agenda article ${agendaNumber} not found for general ${general}`);
  }

  const articles = [...sharedArticles, agendaArticle];
  const articleTexts = articles.map(a => a.text).join('\n\n');

  // NO reply contract here: the calling PHASE appends exactly one contract
  // (propose/veto/wargame each have their own). A second contract baked into the
  // base prompt made every general answer the wrong shape — the parse-miss fell
  // through silently as '(failed)' and every convene ruled inaction (88 rows on
  // campaign 4513790d before this was excised).
  const system = articleTexts;

  const campaignSection = campaignContext?.goal
    ? `Campaign Title: ${campaignContext.title || '(untitled)'}
Campaign Goal: ${campaignContext.goal}`
    : `Campaign Title: ${campaignContext?.title || '(untitled)'}
Campaign Goal: (none)`;

  const user = `${campaignSection}

You are the ${general} general advising the president on campaign readiness. Examine the campaign state through your specific lens; the task and reply shape for this phase follow in the instructions above.`;

  return { system, user };
}
