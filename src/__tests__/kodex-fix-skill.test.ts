/**
 * Test for kodex-fix skill file structure and YAML frontmatter
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('kodex-fix SKILL.md', () => {
  const skillPath = path.join(__dirname, '../../skills/kodex-fix/SKILL.md');
  let skillContent: string;

  beforeEach(() => {
    skillContent = fs.readFileSync(skillPath, 'utf-8');
  });

  it('should exist', () => {
    expect(fs.existsSync(skillPath)).toBe(true);
  });

  it('should have valid YAML frontmatter', () => {
    const frontmatterMatch = skillContent.match(/^---\n([\s\S]*?)\n---/);
    expect(frontmatterMatch).toBeTruthy();
  });

  it('should have correct name in frontmatter', () => {
    const nameMatch = skillContent.match(/^name:\s*kodex-fix\s*$/m);
    expect(nameMatch).toBeTruthy();
  });

  it('should have user-invocable: true', () => {
    const userInvocableMatch = skillContent.match(/^user-invocable:\s*true\s*$/m);
    expect(userInvocableMatch).toBeTruthy();
  });

  it('should have allowed-tools array', () => {
    const allowedToolsMatch = skillContent.match(/^allowed-tools:\s*$/m);
    expect(allowedToolsMatch).toBeTruthy();
  });

  it('should include AskUserQuestion in allowed-tools', () => {
    expect(skillContent).toContain('AskUserQuestion');
  });

  it('should include kodex_list_flags in allowed-tools', () => {
    expect(skillContent).toContain('kodex_list_flags');
  });

  it('should include kodex_list_topics in allowed-tools', () => {
    expect(skillContent).toContain('kodex_list_topics');
  });

  it('should have all 4 steps documented', () => {
    expect(skillContent).toContain('## Step 1: List Open Flags');
    expect(skillContent).toContain('## Step 2: Select Flag');
    expect(skillContent).toContain('## Step 3: Route to Sub-Skill');
    expect(skillContent).toContain('## Step 4: Completion');
  });

  it('should route to correct sub-skills based on flag type', () => {
    expect(skillContent).toContain('kodex-fix-outdated');
    expect(skillContent).toContain('kodex-fix-incorrect');
    expect(skillContent).toContain('kodex-fix-incomplete');
    expect(skillContent).toContain('kodex-fix-missing');
  });

  it('should ask user to fix another flag in completion step', () => {
    expect(skillContent).toContain('Fix another flag');
  });

  it('should have proper markdown formatting', () => {
    // Check that the content after frontmatter starts with a heading
    const contentMatch = skillContent.match(/^---\n[\s\S]*?\n---\n([\s\S]*)/);
    const mainContent = (contentMatch?.[1] || '').trim();
    expect(mainContent).toMatch(/^# /);
  });
});
