import { test, expect, describe } from 'vitest';
import { readFileSync } from 'fs';
import { existsSync } from 'fs';
import { resolve } from 'path';

describe('kodex-fix-incomplete skill', () => {
  const skillPath = resolve(__dirname, '../../skills/kodex-fix-incomplete/SKILL.md');

  test('SKILL.md file should exist', () => {
    expect(existsSync(skillPath)).toBe(true);
  });

  test('should have correct YAML frontmatter', () => {
    const content = readFileSync(skillPath, 'utf-8');

    // Check frontmatter exists
    expect(content.startsWith('---')).toBe(true);

    // Extract frontmatter
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    expect(frontmatterMatch).toBeTruthy();

    const frontmatter = frontmatterMatch?.[1] || '';

    // Check required fields
    expect(frontmatter).toContain('name: kodex-fix-incomplete');
    expect(frontmatter).toContain('description:');
    expect(frontmatter).toContain('user-invocable: false');
    expect(frontmatter).toContain('allowed-tools:');
  });

  test('should have all required allowed-tools', () => {
    const content = readFileSync(skillPath, 'utf-8');
    const requiredTools = [
      'Glob',
      'Grep',
      'Read',
      'AskUserQuestion',
      'mcp__plugin_mermaid-collab_mermaid__kodex_query_topic',
      'mcp__plugin_mermaid-collab_mermaid__kodex_update_topic',
      'mcp__plugin_mermaid-collab_mermaid__kodex_list_topics',
    ];

    for (const tool of requiredTools) {
      expect(content).toContain(tool);
    }
  });

  test('should have Step 1: Get Existing Topic', () => {
    const content = readFileSync(skillPath, 'utf-8');
    expect(content).toContain('Step 1: Get Existing Topic');
    expect(content).toContain('kodex_query_topic');
  });

  test('should have Step 2: Gather Information for Missing Sections', () => {
    const content = readFileSync(skillPath, 'utf-8');
    expect(content).toContain('Step 2: Gather Information for Missing Sections');
  });

  test('should have Step 3: Generate Content for Missing Sections', () => {
    const content = readFileSync(skillPath, 'utf-8');
    expect(content).toContain('Step 3: Generate Content for Missing Sections');
  });

  test('should have Step 4: Validate with User', () => {
    const content = readFileSync(skillPath, 'utf-8');
    expect(content).toContain('Step 4: Validate with User');
    expect(content).toContain('AskUserQuestion');
  });

  test('should have Step 5: Create Draft', () => {
    const content = readFileSync(skillPath, 'utf-8');
    expect(content).toContain('Step 5: Create Draft');
    expect(content).toContain('kodex_update_topic');
  });

  test('should mention section detection for conceptual, technical, files, and related', () => {
    const content = readFileSync(skillPath, 'utf-8');
    expect(content).toContain('conceptual');
    expect(content).toContain('technical');
    expect(content).toContain('files');
    expect(content).toContain('related');
  });
});
