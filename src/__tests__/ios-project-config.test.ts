import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';

const manifestPath = join(import.meta.dir, '../../ios/MermaidCollab/project.yml');
const manifestText = readFileSync(manifestPath, 'utf8');
const parsed = yaml.load(manifestText);
const base = (parsed as any).targets.MermaidCollab.settings.base;

describe('ios/MermaidCollab/project.yml settings.base', () => {
  it('1. DEVELOPMENT_TEAM is a non-empty string', () => {
    expect(typeof base.DEVELOPMENT_TEAM).toBe('string');
    expect(base.DEVELOPMENT_TEAM.length).toBeGreaterThan(0);
  });

  it('2. CODE_SIGN_STYLE equals Automatic', () => {
    expect(base.CODE_SIGN_STYLE).toBe('Automatic');
  });

  it('3. PRODUCT_BUNDLE_IDENTIFIER equals com.mermaidcollab.app', () => {
    expect(base.PRODUCT_BUNDLE_IDENTIFIER).toBe('com.mermaidcollab.app');
  });
});
