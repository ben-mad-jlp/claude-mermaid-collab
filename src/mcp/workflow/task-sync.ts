/**
 * Task synchronization from task-graph.md to collab state.
 */

import type { TaskBatch, BatchTask } from './types.js';

/** Task from task-graph.md YAML */
export interface TaskGraphTask {
  id: string;
  files: string[];
  tests?: string[];
  description: string;
  parallel?: boolean;
  'depends-on'?: string[];
}

/** Parsed task graph */
export interface TaskGraph {
  tasks: TaskGraphTask[];
}

/**
 * Parse task-graph.md document and extract YAML
 */
export function parseTaskGraph(documentContent: string): TaskGraph {
  // Find the YAML block
  const yamlMatch = documentContent.match(/```yaml\s*([\s\S]*?)```/);
  if (!yamlMatch) {
    throw new Error('No YAML block found in task-graph.md');
  }

  const yamlContent = yamlMatch[1];

  // Simple YAML parser for our specific format
  const tasks: TaskGraphTask[] = [];
  let currentTask: Partial<TaskGraphTask> | null = null;

  for (const line of yamlContent.split('\n')) {
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    // New task entry
    if (trimmed.startsWith('- id:')) {
      if (currentTask && currentTask.id) {
        tasks.push(currentTask as TaskGraphTask);
      }
      currentTask = {
        id: trimmed.replace('- id:', '').trim(),
        files: [],
        description: '',
      };
      continue;
    }

    if (!currentTask) continue;

    // Parse task fields
    if (trimmed.startsWith('files:')) {
      const filesMatch = trimmed.match(/\[(.*)\]/);
      if (filesMatch) {
        currentTask.files = filesMatch[1].split(',').map((f) => f.trim());
      }
    } else if (trimmed.startsWith('tests:')) {
      const testsMatch = trimmed.match(/\[(.*)\]/);
      if (testsMatch) {
        currentTask.tests = testsMatch[1].split(',').map((t) => t.trim());
      }
    } else if (trimmed.startsWith('description:')) {
      currentTask.description = trimmed.replace('description:', '').trim();
    } else if (trimmed.startsWith('parallel:')) {
      currentTask.parallel = trimmed.includes('true');
    } else if (trimmed.startsWith('depends-on:')) {
      const depsMatch = trimmed.match(/\[(.*)\]/);
      if (depsMatch) {
        currentTask['depends-on'] = depsMatch[1].split(',').map((d) => d.trim());
      }
    }
  }

  // Don't forget last task
  if (currentTask && currentTask.id) {
    tasks.push(currentTask as TaskGraphTask);
  }

  return { tasks };
}

/**
 * Build execution batches from task graph using topological sort
 */
export function buildBatches(tasks: TaskGraphTask[]): TaskBatch[] {
  // Check for cycles first
  const cycle = detectCycles(tasks);
  if (cycle) {
    throw new Error(`Circular dependency detected: ${cycle.join(' -> ')}`);
  }

  // Topological sort into waves
  const waves = topologicalSort(tasks);

  // Convert to TaskBatch array
  return waves.map((wave, index) => ({
    id: `batch-${index + 1}`,
    tasks: wave.map((task) => ({
      id: task.id,
      status: 'pending' as const,
      dependsOn: task['depends-on'] || [],
    })),
    status: 'pending' as const,
  }));
}

/**
 * Topological sort of tasks by dependencies
 */
export function topologicalSort(tasks: TaskGraphTask[]): TaskGraphTask[][] {
  const taskMap = new Map<string, TaskGraphTask>();
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  // Initialize
  for (const task of tasks) {
    taskMap.set(task.id, task);
    inDegree.set(task.id, 0);
    adjacency.set(task.id, []);
  }

  // Build adjacency list and count in-degrees
  for (const task of tasks) {
    const deps = task['depends-on'] || [];
    inDegree.set(task.id, deps.length);
    for (const dep of deps) {
      const adj = adjacency.get(dep);
      if (adj) {
        adj.push(task.id);
      }
    }
  }

  const waves: TaskGraphTask[][] = [];
  const remaining = new Set(tasks.map((t) => t.id));

  while (remaining.size > 0) {
    // Find all tasks with no remaining dependencies
    const wave: TaskGraphTask[] = [];

    for (const taskId of remaining) {
      if (inDegree.get(taskId) === 0) {
        const task = taskMap.get(taskId);
        if (task) {
          wave.push(task);
        }
      }
    }

    if (wave.length === 0) {
      // This shouldn't happen if cycle detection works
      throw new Error('Unable to make progress - possible cycle');
    }

    // Remove completed tasks and update in-degrees
    for (const task of wave) {
      remaining.delete(task.id);
      const dependents = adjacency.get(task.id) || [];
      for (const dep of dependents) {
        inDegree.set(dep, (inDegree.get(dep) || 1) - 1);
      }
    }

    waves.push(wave);
  }

  return waves;
}

/**
 * Detect circular dependencies using DFS
 */
export function detectCycles(tasks: TaskGraphTask[]): string[] | null {
  const taskSet = new Set(tasks.map((t) => t.id));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const path: string[] = [];

  function dfs(taskId: string): string[] | null {
    if (visiting.has(taskId)) {
      // Found a cycle
      const cycleStart = path.indexOf(taskId);
      return [...path.slice(cycleStart), taskId];
    }

    if (visited.has(taskId)) {
      return null;
    }

    visiting.add(taskId);
    path.push(taskId);

    const task = tasks.find((t) => t.id === taskId);
    const deps = task?.['depends-on'] || [];

    for (const dep of deps) {
      if (taskSet.has(dep)) {
        const cycle = dfs(dep);
        if (cycle) {
          return cycle;
        }
      }
    }

    visiting.delete(taskId);
    path.pop();
    visited.add(taskId);

    return null;
  }

  for (const task of tasks) {
    const cycle = dfs(task.id);
    if (cycle) {
      return cycle;
    }
  }

  return null;
}

/**
 * Sync tasks from task-graph.md to collab-state.json
 */
export async function syncTasksFromTaskGraph(
  project: string,
  session: string,
  apiBaseUrl = 'http://localhost:3737'
): Promise<TaskBatch[]> {
  // Read task-graph document
  const docResponse = await fetch(
    `${apiBaseUrl}/api/projects/${encodeURIComponent(project)}/sessions/${encodeURIComponent(session)}/documents/task-graph`
  );

  if (!docResponse.ok) {
    throw new Error(`Failed to read task-graph document: ${docResponse.statusText}`);
  }

  const doc = (await docResponse.json()) as { content: string };

  // Parse and build batches
  const taskGraph = parseTaskGraph(doc.content);
  const batches = buildBatches(taskGraph.tasks);

  // Update session state with batches
  const stateResponse = await fetch(
    `${apiBaseUrl}/api/projects/${encodeURIComponent(project)}/sessions/${encodeURIComponent(session)}/state`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        batches,
        currentBatch: 0,
        pendingTasks: taskGraph.tasks.map((t) => t.id),
        completedTasks: [],
      }),
    }
  );

  if (!stateResponse.ok) {
    throw new Error(`Failed to update session state: ${stateResponse.statusText}`);
  }

  return batches;
}
