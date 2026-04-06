/**
 * Onboarding Manager - Wraps PseudoDb with onboarding-specific features
 *
 * Provides:
 * - Project configuration (file count, learning paths)
 * - Category derivation from file directory paths
 * - File relationship graph for visualization
 */

import { getPseudoDb, type PseudoFileSummary } from './pseudo-db.js';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// ============================================================================
// Types
// ============================================================================

export interface OnboardingConfig {
  title?: string;
  fileCount: number;
  defaultMode?: 'browse' | 'onboard';
  categories?: Category[];
  paths?: LearningPath[];
}

export interface LearningPath {
  id: string;
  name: string;
  color: string;
  topics: string[];
}

export interface Category {
  name: string;
  topics: string[];
}

export interface GraphNode {
  id: string;       // topic name
  name: string;     // topic title
  category: string;
}

export interface GraphEdge {
  source: string;   // topic name
  target: string;   // related topic name
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Derive categories from file paths by grouping by parent directory.
 */
export function deriveCategories(files: PseudoFileSummary[], config?: OnboardingConfig): Category[] {
  // If config has explicit categories, use those
  if (config?.categories) return config.categories;

  // Group by parent directory
  const groups = new Map<string, string[]>();
  for (const file of files) {
    const parts = file.filePath.split('/');
    // Use first 2 segments as category (e.g., "src/services")
    const category = parts.length > 2 ? parts.slice(0, 2).join('/') : parts[0] || 'root';
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category)!.push(file.filePath);
  }

  return Array.from(groups.entries()).map(([name, filePaths]) => ({
    name,
    topics: filePaths,
  }));
}

// ============================================================================
// OnboardingManager Class
// ============================================================================

export class OnboardingManager {
  private project: string;

  constructor(project: string) {
    this.project = project;
  }

  /**
   * Get onboarding configuration for the project.
   * Reads pseudo-onboarding.json if present, otherwise uses defaults.
   */
  getConfig(): OnboardingConfig {
    const db = getPseudoDb(this.project);
    const files = db.listFiles();
    // Read config file if exists
    const configPath = join(this.project, '.collab', 'pseudo-onboarding.json');
    let config: OnboardingConfig = { fileCount: files.length };
    if (existsSync(configPath)) {
      config = { ...config, ...JSON.parse(readFileSync(configPath, 'utf-8')) };
    }
    config.fileCount = files.length;
    return config;
  }

  /**
   * Get categories derived from file directory paths.
   */
  getCategories(): Category[] {
    const db = getPseudoDb(this.project);
    const files = db.listFiles();
    const config = this.getConfig();
    return deriveCategories(files, config);
  }

  /**
   * Build file relationship graph for visualization.
   */
  getGraph(): { nodes: GraphNode[]; edges: GraphEdge[] } {
    const db = getPseudoDb(this.project);
    const graph = db.getCallGraph();
    const categories = this.getCategories();

    // Map pseudo graph nodes to onboarding graph nodes
    const nodes: GraphNode[] = graph.nodes.map(n => {
      const category = categories.find(c => c.topics.some(t => n.filePath.startsWith(t) || t.startsWith(n.filePath)));
      return {
        id: n.id,
        name: n.label,
        category: category?.name || 'other',
      };
    });

    return { nodes, edges: graph.edges };
  }
}
