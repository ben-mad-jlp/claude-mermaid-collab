/**
 * Task diagram generation from workflow state.
 * Generates Mermaid diagrams with batches as subgraphs.
 */

import type { TaskBatch } from './types.js';

/** Status colors for diagram nodes */
export const STATUS_COLORS = {
  pending: 'fill:#e0e0e0,stroke:#9e9e9e',
  in_progress: 'fill:#fff9c4,stroke:#f9a825',
  completed: 'fill:#c8e6c9,stroke:#2e7d32',
  failed: 'fill:#ffcdd2,stroke:#c62828',
} as const;

export type TaskStatus = keyof typeof STATUS_COLORS;

/**
 * Generate Mermaid diagram from current state
 */
export function generateTaskDiagram(state: { batches?: TaskBatch[] }): string {
  if (!state.batches || state.batches.length === 0) {
    return 'graph TD\n    empty["No tasks defined"]';
  }

  return buildDiagramContent(state.batches);
}

/**
 * Build diagram content with batch subgraphs
 */
export function buildDiagramContent(batches: TaskBatch[]): string {
  const lines: string[] = ['graph TD'];

  // Build subgraphs for each batch
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const batchLabel = `Wave ${i + 1}`;

    lines.push(`    subgraph ${batch.id}["${batchLabel}"]`);

    // Add nodes for each task
    for (const task of batch.tasks) {
      const nodeId = sanitizeId(task.id);
      const label = task.id;
      lines.push(`        ${nodeId}["${label}"]`);
    }

    lines.push('    end');
  }

  lines.push('');

  // Add dependency arrows between tasks
  for (const batch of batches) {
    for (const task of batch.tasks) {
      for (const dep of task.dependsOn) {
        const fromId = sanitizeId(dep);
        const toId = sanitizeId(task.id);
        lines.push(`    ${fromId} --> ${toId}`);
      }
    }
  }

  lines.push('');

  // Add styles for each task based on status
  for (const batch of batches) {
    for (const task of batch.tasks) {
      const nodeId = sanitizeId(task.id);
      const color = STATUS_COLORS[task.status] || STATUS_COLORS.pending;
      lines.push(`    style ${nodeId} ${color}`);
    }
  }

  return lines.join('\n');
}

/**
 * Sanitize task ID for use as Mermaid node ID
 */
function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, '_');
}

/**
 * Update diagram file in session via MCP API
 */
export async function updateTaskDiagram(
  project: string,
  session: string,
  state: { batches?: TaskBatch[] },
  apiBaseUrl = 'http://localhost:3737'
): Promise<void> {
  const content = generateTaskDiagram(state);

  // Check if diagram exists
  const listResponse = await fetch(
    `${apiBaseUrl}/api/projects/${encodeURIComponent(project)}/sessions/${encodeURIComponent(session)}/diagrams`
  );

  if (!listResponse.ok) {
    throw new Error(`Failed to list diagrams: ${listResponse.statusText}`);
  }

  const diagrams = (await listResponse.json()) as { diagrams: Array<{ id: string }> };
  const exists = diagrams.diagrams.some((d) => d.id === 'task-execution');

  if (exists) {
    // Update existing diagram
    const updateResponse = await fetch(
      `${apiBaseUrl}/api/projects/${encodeURIComponent(project)}/sessions/${encodeURIComponent(session)}/diagrams/task-execution`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      }
    );

    if (!updateResponse.ok) {
      throw new Error(`Failed to update diagram: ${updateResponse.statusText}`);
    }
  } else {
    // Create new diagram
    const createResponse = await fetch(
      `${apiBaseUrl}/api/projects/${encodeURIComponent(project)}/sessions/${encodeURIComponent(session)}/diagrams`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'task-execution', content }),
      }
    );

    if (!createResponse.ok) {
      throw new Error(`Failed to create diagram: ${createResponse.statusText}`);
    }
  }
}
