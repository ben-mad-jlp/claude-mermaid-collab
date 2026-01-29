/**
 * Alias Constants
 * Defines synonym and abbreviation mappings for keyword expansion
 */

// Synonym map for common term variations
export const SYNONYMS: Record<string, string[]> = {
  'auth': ['authentication', 'login', 'signin'],
  'ui': ['interface', 'frontend', 'gui'],
  'api': ['endpoints', 'routes', 'rest'],
  'db': ['database', 'storage', 'data'],
  'config': ['configuration', 'settings', 'options'],
};

// Abbreviation rules (long form -> short form)
export const ABBREVIATIONS: Record<string, string> = {
  'authentication': 'auth',
  'configuration': 'config',
  'development': 'dev',
  'application': 'app',
  'documentation': 'docs',
};
