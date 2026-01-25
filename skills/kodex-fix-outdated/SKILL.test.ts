import { test, expect, describe } from 'bun:test';
import { readFileSync } from 'fs';
import { existsSync } from 'fs';
import { resolve } from 'path';

describe('kodex-fix-outdated skill', () => {
  const skillPath = resolve(__dirname, './SKILL.md');

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
    expect(frontmatter).toContain('name: kodex-fix-outdated');
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

  test('should have Step 2: Analyze Codebase for Changes', () => {
    const content = readFileSync(skillPath, 'utf-8');
    expect(content).toContain('Step 2: Analyze Codebase for Changes');
    expect(content).toContain('codebase');
  });

  test('should have Step 3: Generate Updated Content', () => {
    const content = readFileSync(skillPath, 'utf-8');
    expect(content).toContain('Step 3: Generate Updated Content');
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

  test('should use kodex_update_topic not kodex_create_topic', () => {
    const content = readFileSync(skillPath, 'utf-8');
    expect(content).toContain('kodex_update_topic');
    expect(content).not.toContain('kodex_create_topic');
  });

  test('should mention analyzing code changes in Step 2', () => {
    const content = readFileSync(skillPath, 'utf-8');
    const step2Section = content.split('Step 2:')[1].split('Step 3:')[0];
    expect(step2Section).toContain('Grep');
    expect(step2Section).toContain('code');
  });
});
