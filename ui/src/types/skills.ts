/**
 * Skill Type Definitions
 *
 * Provides type definitions and metadata for skill transitions in the AI-UI system.
 */

/**
 * SkillTransition interface for displaying skill transitions
 */
export interface SkillTransition {
  skillName: string;
  description?: string;
  className?: string;
}

/**
 * Descriptions for all available skills
 * Used when displaying skill transitions in the UI
 */
export const SKILL_DESCRIPTIONS: Record<string, string> = {
  'brainstorming': 'Exploring requirements and forming initial understanding',
  'brainstorming-clarifying': 'Discussing each item to fully understand requirements',
  'brainstorming-designing': 'Presenting design approach in validated sections',
  'brainstorming-exploring': 'Gathering context about the project',
  'brainstorming-transition': 'Transition from brainstorming to implementation',
  'brainstorming-validating': 'Running completeness gate to ensure design is ready',
  'collab': 'Starting collaborative design work with isolated sessions',
  'collab-cleanup': 'Archiving or deleting design artifacts',
  'collab-clear': 'Asking about clearing context before proceeding',
  'collab-session-mgmt': 'Managing collab session procedures',
  'collab-start': 'Starting the mermaid-collab server and session',
  'collab-work-item-loop': 'Processing work items one at a time',
  'dispatching-parallel-agents': 'Handling independent parallel tasks',
  'executing-plans': 'Executing implementation plans with independent tasks',
  'executing-plans-execution': 'Execution logic for the executing-plans skill',
  'executing-plans-review': 'Verification and drift detection for executing-plans',
  'finishing-a-development-branch': 'Deciding how to integrate development work',
  'gather-session-goals': 'Collecting and classifying work items',
  'mermaid-collab': 'Creating and collaborating on Mermaid diagrams',
  'ready-to-implement': 'Validating design and transitioning to implementation',
  'receiving-code-review': 'Implementing code review feedback',
  'requesting-code-review': 'Verifying work meets requirements before merging',
  'rough-draft': 'Bridging brainstorming to implementation',
  'rough-draft-handoff': 'Handing off to executing-plans',
  'rough-draft-interface': 'Defining structural contracts of the system',
  'rough-draft-pseudocode': 'Defining logic flow for each function',
  'rough-draft-skeleton': 'Generating stub files and task dependency graph',
  'task-planning': 'Planning operational tasks',
  'test-driven-development': 'Implementing features with TDD approach',
  'using-gui-wireframes': 'Creating and editing UI mockups',
  'using-superpowers': 'Starting conversation and establishing skill usage',
  'writing-plans': 'Writing multi-step task specifications',
  'writing-skills': 'Creating and editing skills',
};
