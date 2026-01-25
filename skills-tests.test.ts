import { test, expect, describe } from 'bun:test';
import { readFileSync } from 'fs';
import { existsSync } from 'fs';

describe('Kodex Fix Skills', () => {
  describe('kodex-fix-incorrect skill', () => {
    const skillPath = './skills/kodex-fix-incorrect/SKILL.md';

    test('skill file exists', () => {
      expect(existsSync(skillPath)).toBe(true);
    });

    test('has valid YAML frontmatter', () => {
      const content = readFileSync(skillPath, 'utf-8');

      // Check for YAML frontmatter markers
      expect(content.startsWith('---')).toBe(true);
      expect(content.includes('\n---\n')).toBe(true);

      // Extract frontmatter
      const match = content.match(/^---\n([\s\S]*?)\n---\n/);
      expect(match).not.toBeNull();
      const frontmatter = match![1];

      // Check required YAML fields
      expect(frontmatter).toContain('name: kodex-fix-incorrect');
      expect(frontmatter).toContain('description:');
      expect(frontmatter).toContain('user-invocable: false');
      expect(frontmatter).toContain('allowed-tools:');
    });

    test('has all 6 steps documented', () => {
      const content = readFileSync(skillPath, 'utf-8');

      expect(content).toContain('## Step 1:');
      expect(content).toContain('## Step 2:');
      expect(content).toContain('## Step 3:');
      expect(content).toContain('## Step 4:');
      expect(content).toContain('## Step 5:');
      expect(content).toContain('## Step 6:');
    });

    test('includes required allowed tools', () => {
      const content = readFileSync(skillPath, 'utf-8');

      const requiredTools = [
        'Glob',
        'Grep',
        'Read',
        'AskUserQuestion',
        'kodex_query_topic',
        'kodex_update_topic',
        'kodex_list_topics'
      ];

      requiredTools.forEach(tool => {
        expect(content).toContain(tool);
      });
    });

    test('Step 2 focuses on specific inaccuracy', () => {
      const content = readFileSync(skillPath, 'utf-8');
      const step2Section = content.split('## Step 2:')[1].split('## Step 3:')[0];

      expect(step2Section).toContain('inaccuracy');
    });

    test('Step 3 researches implementation in code', () => {
      const content = readFileSync(skillPath, 'utf-8');
      const step3Section = content.split('## Step 3:')[1].split('## Step 4:')[0];

      expect(step3Section).toContain('Grep');
      expect(step3Section).toContain('code');
    });

    test('Step 5 presents correction for user validation', () => {
      const content = readFileSync(skillPath, 'utf-8');
      const step5Section = content.split('## Step 5:')[1].split('## Step 6:')[0];

      expect(step5Section).toContain('Validate');
      expect(step5Section).toContain('user');
    });

    test('Step 6 calls kodex_update_topic with reason', () => {
      const content = readFileSync(skillPath, 'utf-8');
      const step6Section = content.split('## Step 6:')[1];

      expect(step6Section).toContain('kodex_update_topic');
      expect(step6Section).toContain('reason');
      expect(step6Section).toContain('Corrected');
    });
  });
});
