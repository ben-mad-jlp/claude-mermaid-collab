import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('kodex-fix-missing skill', () => {
  const skillPath = resolve(__dirname, '../../..', 'skills/kodex-fix-missing/SKILL.md');

  it('should exist', () => {
    const content = readFileSync(skillPath, 'utf-8');
    expect(content).toBeDefined();
    expect(content.length).toBeGreaterThan(0);
  });

  it('should have correct YAML frontmatter', () => {
    const content = readFileSync(skillPath, 'utf-8');

    // Check for YAML frontmatter markers
    expect(content).toMatch(/^---\n/);
    expect(content).toMatch(/\n---\n/);

    // Extract YAML frontmatter
    const yamlMatch = content.match(/^---\n([\s\S]*?)\n---/);
    expect(yamlMatch).toBeDefined();

    const yaml = yamlMatch![1];

    // Check required fields
    expect(yaml).toContain('name: kodex-fix-missing');
    expect(yaml).toContain('user-invocable: false');
    expect(yaml).toContain('allowed-tools:');
  });

  it('should have correct allowed-tools', () => {
    const content = readFileSync(skillPath, 'utf-8');

    const requiredTools = [
      'Glob',
      'Grep',
      'Read',
      'AskUserQuestion',
      'mcp__plugin_mermaid-collab_mermaid__kodex_create_topic',
      'mcp__plugin_mermaid-collab_mermaid__kodex_list_topics',
    ];

    requiredTools.forEach(tool => {
      expect(content).toContain(tool);
    });
  });

  it('should have all 6 steps documented', () => {
    const content = readFileSync(skillPath, 'utf-8');

    const steps = [
      'Step 1: Understand What\'s Needed',
      'Step 2: Research the Topic',
      'Step 3: Identify Topic Scope',
      'Step 4: Generate All 4 Sections',
      'Step 5: Validate with User',
      'Step 6: Create Draft',
    ];

    steps.forEach(step => {
      expect(content).toContain(step);
    });
  });

  it('should use kodex_create_topic not kodex_update_topic', () => {
    const content = readFileSync(skillPath, 'utf-8');

    expect(content).toContain('kodex_create_topic');
    expect(content).not.toContain('kodex_update_topic');
  });

  it('should document step 2 searching codebase', () => {
    const content = readFileSync(skillPath, 'utf-8');

    expect(content).toContain('Step 2: Research the Topic');
    expect(content.toLowerCase()).toContain('glob');
    expect(content.toLowerCase()).toContain('grep');
  });

  it('should document all 4 content sections', () => {
    const content = readFileSync(skillPath, 'utf-8');

    expect(content).toContain('conceptual');
    expect(content).toContain('technical');
    expect(content).toContain('files');
    expect(content).toContain('related');
  });
});
