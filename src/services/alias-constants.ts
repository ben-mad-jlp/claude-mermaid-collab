/**
 * Alias Constants
 * Defines synonym and abbreviation mappings for keyword expansion
 *
 * Used by the alias generator to:
 * 1. Expand queries so "auth" finds "authentication" topics
 * 2. Generate semantic aliases for new topics
 * 3. Help users discover related topics via synonym lookups
 */

// Type Definitions
export interface TopicContent {
  conceptual: string;
  technical: string;
  files: string;
  related: string;
}

export interface AliasGeneratorOptions {
  maxAliases?: number;  // Default: 10
  minAliasLength?: number;  // Default: 2
  includeSynonyms?: boolean;  // Default: true
  includeAbbreviations?: boolean;  // Default: true
  includeContentKeywords?: boolean;  // Default: false
}

// Default constants
export const MIN_ALIAS_LENGTH = 2;
export const MAX_ALIASES = 10;
export const CONTENT_KEYWORD_LIMIT = 5;

/**
 * Common stop words to exclude from keyword extraction.
 * These words are too generic to be useful as aliases.
 */
export const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
  'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did',
  'will', 'would', 'could', 'should', 'may', 'might', 'must', 'can',
  'this', 'that', 'these', 'those',
  'i', 'you', 'he', 'she', 'it', 'we', 'they',
  'what', 'which', 'who', 'when', 'where', 'why', 'how',
  'as', 'if', 'then', 'else', 'because',
  'from', 'up', 'down', 'out', 'off', 'over', 'under',
  'more', 'less', 'most', 'least', 'some', 'any', 'all', 'each', 'every', 'both', 'few',
  'no', 'not', 'so', 'also', 'just', 'only', 'very', 'too', 'such',
]);

/**
 * Maps common topic terms to their synonyms.
 * Used to expand queries and generate related aliases.
 *
 * Example: If a topic contains "authentication", we can also suggest
 * "auth", "login", "signin" as aliases.
 */
export const SYNONYMS: Record<string, string[]> = {
  // Authentication & Authorization (3 entries)
  'authentication': ['auth', 'login', 'signin', 'identity', 'access'],
  'authorization': ['authz', 'permissions', 'access-control', 'roles'],
  'security': ['encryption', 'protection', 'safety', 'compliance'],

  // Database & Storage (3 entries)
  'database': ['db', 'storage', 'persistence', 'datastore', 'backend'],
  'storage': ['persistence', 'cache', 'memory', 'data', 'records'],
  'sql': ['relational', 'queries', 'orm', 'transaction'],

  // API & Web Services (3 entries)
  'api': ['endpoints', 'routes', 'rest', 'interface', 'service'],
  'rest': ['api', 'http', 'crud', 'endpoints', 'web-service'],
  'graphql': ['api', 'queries', 'schema', 'types', 'query-language'],

  // Frontend & UI (3 entries)
  'ui': ['interface', 'frontend', 'gui', 'visual', 'components'],
  'frontend': ['ui', 'client', 'browser', 'react', 'vue'],
  'components': ['ui', 'elements', 'widgets', 'modules', 'views'],

  // Configuration & Environment (2 entries)
  'configuration': ['config', 'settings', 'options', 'environment', 'preferences'],
  'environment': ['config', 'variables', 'setup', 'deployment', 'context'],

  // Development & Testing (2 entries)
  'testing': ['tests', 'qa', 'validation', 'specs', 'verification'],
  'documentation': ['docs', 'guide', 'manual', 'reference', 'comments'],
};

/**
 * Maps common topic terms to their standard abbreviations.
 * Used to expand queries with shorter forms and generate abbreviated aliases.
 *
 * Example: "authentication" can also be queried as "auth",
 * "application" as "app".
 */
export const ABBREVIATIONS: Record<string, string> = {
  // Authentication & Authorization (3 entries)
  'authentication': 'auth',
  'authorization': 'authz',
  'security': 'sec',

  // Database & Storage (3 entries)
  'database': 'db',
  'storage': 'store',
  'persistence': 'persist',

  // Application & Development (4 entries)
  'application': 'app',
  'development': 'dev',
  'configuration': 'config',
  'documentation': 'docs',

  // API & Web Standards (3 entries)
  'rest': 'rest',
  'hypertext transfer protocol': 'http',
  'structured query language': 'sql',

  // Architecture & Patterns (2 entries)
  'microservices': 'ms',
  'continuous integration': 'ci',
};
