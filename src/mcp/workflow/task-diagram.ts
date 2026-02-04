/**
 * Task diagram generation from workflow state.
 * Generates Mermaid diagrams with batches as subgraphs.
 */

import type { TaskBatch } from './types.js';

/** Status colors for diagram nodes (muted, dark-mode friendly) */
export const STATUS_COLORS = {
  pending: 'fill:#64748b,stroke:#475569,color:#fff',      // muted gray
  in_progress: 'fill:#6987c9,stroke:#4b6cb7,color:#fff',  // muted blue
  completed: 'fill:#6b9e7d,stroke:#4a7c5c,color:#fff',    // muted green
  failed: 'fill:#c97676,stroke:#a85555,color:#fff',       // muted red
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
 * Build diagram content from batches
 */
export function buildDiagramContent(batches: TaskBatch[]): string {
  const lines: string[] = ['graph TD'];

  // Define class styles (higher specificity than theme defaults)
  lines.push(`    classDef pending ${STATUS_COLORS.pending}`);
  lines.push(`    classDef in_progress ${STATUS_COLORS.in_progress}`);
  lines.push(`    classDef completed ${STATUS_COLORS.completed}`);
  lines.push(`    classDef failed ${STATUS_COLORS.failed}`);
  lines.push('');

  // Add nodes for each task (no subgraphs)
  for (const batch of batches) {
    for (const task of batch.tasks) {
      const nodeId = sanitizeId(task.id);
      const label = task.id;
      lines.push(`    ${nodeId}["${label}"]`);
    }
  }

  lines.push('');

  // Add dependency arrows between tasks
  for (const batch of batches) {
    for (const task of batch.tasks) {
      for (const dep of task.dependsOn) {
        if (!dep || !dep.trim()) continue; // Skip empty or whitespace-only dependencies
        const fromId = sanitizeId(dep);
        if (!fromId || fromId === '_') continue; // Skip if sanitized ID is empty or just underscore
        const toId = sanitizeId(task.id);
        lines.push(`    ${fromId} --> ${toId}`);
      }
    }
  }

  lines.push('');

  // Apply class to each task based on status
  for (const batch of batches) {
    for (const task of batch.tasks) {
      const nodeId = sanitizeId(task.id);
      const statusClass = task.status || 'pending';
      lines.push(`    class ${nodeId} ${statusClass}`);
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
