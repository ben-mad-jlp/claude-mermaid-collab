/**
 * Task Diagram Generation
 *
 * Generates a Mermaid graph diagram representing the current task execution state.
 * Tasks are color-coded by status using muted, dark-mode-friendly colors.
 */

import type { TaskBatch } from './types.js';

// ============= Type Definitions =============

export interface TaskDiagramState {
  batches: TaskBatch[];
}

// ============= Status Colors =============

const STATUS_COLORS: Record<string, string> = {
  pending: 'fill:#4a4a5a,stroke:#6a6a8a,color:#ccc',
  in_progress: 'fill:#2a4a6a,stroke:#4a7aaa,color:#ccc',
  completed: 'fill:#2a5a3a,stroke:#4a8a5a,color:#ccc',
  failed: 'fill:#6a2a2a,stroke:#aa4a4a,color:#ccc',
};

// ============= Helper Functions =============

/**
 * Replace non-alphanumeric characters with underscores for valid Mermaid node IDs.
 */
export function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9]/g, '_');
}

// ============= Diagram Generation Functions =============

/**
 * Build the full Mermaid diagram content from task batches.
 */
export function buildDiagramContent(batches: TaskBatch[]): string {
  const lines: string[] = ['graph TD'];

  // Declare classDef styles for all four statuses
  lines.push(`    classDef pending ${STATUS_COLORS.pending}`);
  lines.push(`    classDef in_progress ${STATUS_COLORS.in_progress}`);
  lines.push(`    classDef completed ${STATUS_COLORS.completed}`);
  lines.push(`    classDef failed ${STATUS_COLORS.failed}`);

  // Emit a node for each task
  for (const batch of batches) {
    for (const task of batch.tasks) {
      const safeId = sanitizeId(task.id);
      lines.push(`    ${safeId}["${task.id}"]`);
    }
  }

  // Emit dependency arrows between tasks (skip empty/whitespace dependency strings)
  for (const batch of batches) {
    for (const task of batch.tasks) {
      if (task.dependsOn && task.dependsOn.length > 0) {
        for (const dep of task.dependsOn) {
          if (dep && dep.trim()) {
            const safeTaskId = sanitizeId(task.id);
            const safeDepId = sanitizeId(dep);
            lines.push(`    ${safeDepId} --> ${safeTaskId}`);
          }
        }
      }
    }
  }

  // Apply appropriate class to each task node based on current status
  for (const batch of batches) {
    for (const task of batch.tasks) {
      const safeId = sanitizeId(task.id);
      const status = task.status || 'pending';
      lines.push(`    class ${safeId} ${status}`);
    }
  }

  return lines.join('\n');
}

/**
 * Generate a Mermaid diagram from current task execution state.
 *
 * If batches is empty or absent, returns a placeholder "No tasks defined" graph.
 */
export function generateTaskDiagram(state: TaskDiagramState): string {
  const batches = state.batches;

  if (!batches || batches.length === 0) {
    return 'graph TD\n    empty["No tasks defined"]';
  }

  return buildDiagramContent(batches);
}
