import { vi } from 'vitest';

// Mock external packages that might not be available
vi.mock('mermaid-wireframe', () => ({
  default: {},
}));

vi.mock('mermaid', () => ({
  default: {},
}));
