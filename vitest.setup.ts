import { vi } from 'vitest';

// Mock external packages that might not be available
vi.mock('mermaid-wireframe', () => ({
  default: {},
}));

vi.mock('mermaid', () => ({
  default: {},
}));

// Mock bun:sqlite
vi.mock('bun:sqlite', () => {
  // Import better-sqlite3 as a fallback for testing
  const Database = require('better-sqlite3');
  return { default: Database };
});
