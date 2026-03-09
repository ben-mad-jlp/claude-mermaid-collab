/**
 * Onboarding Manager - Wraps KodexManager with onboarding-specific features
 *
 * Provides:
 * - Project configuration (title, default mode, learning paths)
 * - Category derivation from topic name prefixes
 * - Topic relationship graph for visualization
 * - Mermaid diagram extraction for topic detail
 */

import { getKodexManager } from './kodex-manager.js';
import { readFileSync, existsSync } from 'fs';
import { join, basename } from 'path';

// ============================================================================
// Types
// ============================================================================

export interface OnboardingConfig {
  title: string;
  topicCount: number;
  defaultMode: 'browse' | 'onboard';
  categories?: Record<string, string[]>;
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
  topicCount: number;
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

export interface DiagramBlock {
  title: string;
  content: string;  // raw mermaid syntax
  filePath: string; // path to .mmd file
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Parse related topics from related.md content.
 *
 * Handles all formats found in the wild:
 * - [title](../topic-name/) → extract slug from path
 * - **topic-name** - description → extract bold text
 * - bare word → validate against knownTopics
 */
export function parseRelatedTopics(content: string, knownTopics: Set<string>): string[] {
  if (!content.trim()) return [];

  const found = new Set<string>();
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Pattern 1: Markdown link — [Label](../topic-name/) or [Label](../topic-name)
    const linkRegex = /\[([^\]]*)\]\(\.\.\/([a-z0-9-]+)\/?[^)]*\)/g;
    let match;
    while ((match = linkRegex.exec(trimmed)) !== null) {
      const slug = match[2];
      if (knownTopics.has(slug)) {
        found.add(slug);
      }
    }

    // Pattern 2: Bold text — **topic-name**
    const boldRegex = /\*\*([a-z0-9-]+)\*\*/g;
    while ((match = boldRegex.exec(trimmed)) !== null) {
      const name = match[1];
      if (knownTopics.has(name)) {
        found.add(name);
      }
    }

    // Pattern 3: Bare words — check each hyphenated word against known topics
    // Only for lines that start with "- " (list items)
    if (trimmed.startsWith('- ')) {
      const words = trimmed.slice(2).split(/[\s,]+/);
      for (const word of words) {
        const clean = word.replace(/[*[\]()]/g, '').trim();
        if (clean && /^[a-z0-9-]+$/.test(clean) && knownTopics.has(clean)) {
          found.add(clean);
        }
      }
    }
  }

  return Array.from(found);
}

/**
 * Derive categories from topic names by splitting on first dash.
 * Groups with < 3 topics are merged into "other".
 * Config overrides are applied if present.
 */
export function deriveCategories(
  topics: { name: string }[],
  config?: OnboardingConfig
): Category[] {
  // Step 1: Group by prefix
  const groups = new Map<string, string[]>();

  for (const topic of topics) {
    const dashIdx = topic.name.indexOf('-');
    const prefix = dashIdx > 0 ? topic.name.slice(0, dashIdx) : topic.name;
    if (!groups.has(prefix)) {
      groups.set(prefix, []);
    }
    groups.get(prefix)!.push(topic.name);
  }

  // Step 2: Apply config overrides if present
  if (config?.categories) {
    for (const [categoryName, topicNames] of Object.entries(config.categories)) {
      // Remove these topics from their current groups
      for (const topicName of topicNames) {
        for (const [prefix, members] of groups) {
          const idx = members.indexOf(topicName);
          if (idx !== -1) {
            members.splice(idx, 1);
            if (members.length === 0) {
              groups.delete(prefix);
            }
            break;
          }
        }
      }
      // Add to override group
      const existing = groups.get(categoryName) || [];
      groups.set(categoryName, [...existing, ...topicNames]);
    }
  }

  // Step 3: Merge small groups (< 3 topics) into "other"
  const categories: Category[] = [];
  const otherTopics: string[] = [];

  for (const [name, topicList] of groups) {
    if (topicList.length < 3) {
      otherTopics.push(...topicList);
    } else {
      categories.push({
        name,
        topicCount: topicList.length,
        topics: topicList.sort(),
      });
    }
  }

  if (otherTopics.length > 0) {
    categories.push({
      name: 'other',
      topicCount: otherTopics.length,
      topics: otherTopics.sort(),
    });
  }

  // Step 4: Sort by topicCount descending
  categories.sort((a, b) => b.topicCount - a.topicCount);

  return categories;
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
   * Reads kodex-onboarding.json if present, otherwise uses defaults.
   */
  async getConfig(): Promise<OnboardingConfig> {
    const kodex = getKodexManager(this.project);
    const topics = await kodex.listTopics();

    let config: Partial<OnboardingConfig> = {};

    // Try to read kodex-onboarding.json
    const configPath = join(this.project, 'kodex-onboarding.json');
    if (existsSync(configPath)) {
      try {
        const raw = readFileSync(configPath, 'utf-8');
        config = JSON.parse(raw);
      } catch {
        // Invalid JSON — use defaults
      }
    }

    // Derive title
    let title = config.title || '';
    if (!title) {
      const pkgPath = join(this.project, 'package.json');
      if (existsSync(pkgPath)) {
        try {
          const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
          title = pkg.name || '';
        } catch {
          // ignore
        }
      }
      if (!title) {
        title = basename(this.project);
      }
    }

    return {
      title,
      topicCount: topics.length,
      defaultMode: config.defaultMode || 'browse',
      categories: config.categories,
      paths: config.paths,
    };
  }

  /**
   * Get categories derived from topic name prefixes.
   */
  async getCategories(): Promise<Category[]> {
    const kodex = getKodexManager(this.project);
    const topics = await kodex.listTopics();
    const config = await this.getConfig();
    return deriveCategories(topics, config);
  }

  /**
   * Build topic relationship graph for visualization.
   */
  async getGraph(): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
    const kodex = getKodexManager(this.project);
    const topics = await kodex.listTopics();

    // Build known topics set
    const knownTopics = new Set(topics.map(t => t.name));

    // Derive categories for node coloring
    const categories = await this.getCategories();
    const topicCategoryMap = new Map<string, string>();
    for (const cat of categories) {
      for (const topicName of cat.topics) {
        topicCategoryMap.set(topicName, cat.name);
      }
    }

    // Build nodes
    const nodes: GraphNode[] = topics.map(t => ({
      id: t.name,
      name: t.title,
      category: topicCategoryMap.get(t.name) || 'other',
    }));

    // Build edges by parsing related.md for each topic
    const edges: GraphEdge[] = [];
    const topicsDir = join(this.project, '.collab', 'kodex', 'topics');

    for (const topic of topics) {
      const relatedPath = join(topicsDir, topic.name, 'related.md');
      if (existsSync(relatedPath)) {
        const content = readFileSync(relatedPath, 'utf-8');
        const relatedNames = parseRelatedTopics(content, knownTopics);
        for (const target of relatedNames) {
          edges.push({ source: topic.name, target });
        }
      }
    }

    return { nodes, edges };
  }

  /**
   * Get mermaid diagram blocks for a topic.
   */
  async getDiagram(topicName: string): Promise<DiagramBlock[]> {
    const kodex = getKodexManager(this.project);
    const topic = await kodex.getTopic(topicName, true);

    if (!topic) return [];

    const diagramsContent = topic.content.diagrams;
    if (!diagramsContent?.trim()) return [];

    const blocks: DiagramBlock[] = [];
    const diagramsDir = join(this.project, '.collab', 'kodex', 'diagrams');

    // Parse .mmd file references from diagrams content
    // Format: - [Label](../../diagrams/file.mmd) — description
    // Or already resolved mermaid code blocks with ### headers
    const lines = diagramsContent.split('\n');
    let currentTitle = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Check for ### header (from resolved diagram links)
      const headerMatch = line.match(/^###\s+(.+)/);
      if (headerMatch) {
        currentTitle = headerMatch[1].trim();
        continue;
      }

      // Check for mermaid code block
      if (line.trim() === '```mermaid') {
        const contentLines: string[] = [];
        i++;
        while (i < lines.length && lines[i].trim() !== '```') {
          contentLines.push(lines[i]);
          i++;
        }
        if (contentLines.length > 0) {
          blocks.push({
            title: currentTitle || 'Diagram',
            content: contentLines.join('\n'),
            filePath: '',
          });
        }
        currentTitle = '';
        continue;
      }

      // Check for raw .mmd file reference
      const mmdMatch = line.match(/\[([^\]]+)\]\(([^)]+\.mmd)\)/);
      if (mmdMatch) {
        const label = mmdMatch[1];
        const relativePath = mmdMatch[2];
        // Resolve the path relative to the topic directory
        const topicDir = join(this.project, '.collab', 'kodex', 'topics', topicName);
        const fullPath = join(topicDir, relativePath);

        if (existsSync(fullPath)) {
          blocks.push({
            title: label,
            content: readFileSync(fullPath, 'utf-8').trim(),
            filePath: relativePath,
          });
        }
      }
    }

    return blocks;
  }
}
