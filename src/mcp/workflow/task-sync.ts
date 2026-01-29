/**
 * Task synchronization from task-graph.md to collab state.
 */

import type { TaskBatch, BatchTask } from './types.js';
import { getSessionState, updateSessionState } from '../tools/collab-state.js';
import { readFile, writeFile, readdir, access } from 'fs/promises';
import { join } from 'path';

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
    // Filter out empty strings and non-existent dependencies
    const deps = (task['depends-on'] || []).filter((d) => d && taskMap.has(d));
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
 * Generate YAML content for task graph
 */
function generateTaskGraphYaml(tasks: TaskGraphTask[]): string {
  const lines: string[] = ['tasks:'];

  for (const task of tasks) {
    lines.push(`  - id: ${task.id}`);
    lines.push(`    files: [${task.files.join(', ')}]`);
    if (task.tests && task.tests.length > 0) {
      lines.push(`    tests: [${task.tests.join(', ')}]`);
    }
    lines.push(`    description: ${task.description}`);
    if (task.parallel !== undefined) {
      lines.push(`    parallel: ${task.parallel}`);
    }
    if (task['depends-on'] && task['depends-on'].length > 0) {
      lines.push(`    depends-on: [${task['depends-on'].join(', ')}]`);
    }
  }

  return lines.join('\n');
}

/**
 * Generate Mermaid diagram for task dependencies
 */
function generateTaskGraphMermaid(tasks: TaskGraphTask[], batches: TaskBatch[]): string {
  const lines: string[] = ['graph TD'];

  // Add nodes
  for (const task of tasks) {
    const shortDesc = task.description.substring(0, 30) + (task.description.length > 30 ? '...' : '');
    lines.push(`    ${task.id}["${task.id}<br/>${shortDesc}"]`);
  }

  lines.push('');

  // Add edges based on dependencies
  for (const task of tasks) {
    const deps = task['depends-on'] || [];
    for (const dep of deps) {
      lines.push(`    ${dep} --> ${task.id}`);
    }
  }

  lines.push('');

  // Add styles based on wave
  const waveColors = ['#c8e6c9', '#bbdefb', '#fff3e0', '#f3e5f5', '#ffccbc'];
  batches.forEach((batch, waveIndex) => {
    const color = waveColors[waveIndex % waveColors.length];
    for (const task of batch.tasks) {
      lines.push(`    style ${task.id} fill:${color}`);
    }
  });

  return lines.join('\n');
}

/**
 * Get the documents directory path for a session
 */
function getDocumentsPath(project: string, session: string): string {
  return join(project, '.collab', 'sessions', session, 'documents');
}

/**
 * Check if a file exists
 */
async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Create consolidated task-graph document from tasks
 */
async function createConsolidatedTaskGraph(
  project: string,
  session: string,
  tasks: TaskGraphTask[]
): Promise<void> {
  const batches = buildBatches(tasks);
  const yamlContent = generateTaskGraphYaml(tasks);
  const mermaidContent = generateTaskGraphMermaid(tasks, batches);

  // Build wave summary
  const waveSummary = batches.map((batch, index) => {
    const taskIds = batch.tasks.map((t) => t.id).join(', ');
    return `**Wave ${index + 1}:** ${taskIds}`;
  }).join('\n');

  const content = `# Consolidated Task Graph

This document was auto-generated from blueprint documents.

## Summary

- **Total tasks:** ${tasks.length}
- **Total waves:** ${batches.length}
- **Max parallelism:** ${Math.max(...batches.map((b) => b.tasks.length))}

## Execution Waves

${waveSummary}

## Task Graph (YAML)

\`\`\`yaml
${yamlContent}
\`\`\`

## Dependency Visualization

\`\`\`mermaid
${mermaidContent}
\`\`\`

## Tasks by Wave

${batches.map((batch, index) => {
  const taskDetails = batch.tasks.map((t) => {
    const task = tasks.find((task) => task.id === t.id);
    return `- **${t.id}**: ${task?.description || 'No description'}`;
  }).join('\n');
  return `### Wave ${index + 1}\n\n${taskDetails}`;
}).join('\n\n')}
`;

  // Write the task-graph document
  const documentsPath = getDocumentsPath(project, session);
  const taskGraphPath = join(documentsPath, 'task-graph.md');
  await writeFile(taskGraphPath, content, 'utf-8');
}

/**
 * Sync tasks from task-graph.md or blueprint documents to collab-state.json
 * Preserves existing completedTasks and calculates pendingTasks as the difference
 */
export async function syncTasksFromTaskGraph(
  project: string,
  session: string
): Promise<TaskBatch[]> {
  let allTasks: TaskGraphTask[] = [];
  const documentsPath = getDocumentsPath(project, session);

  // First try to read task-graph document
  const taskGraphPath = join(documentsPath, 'task-graph.md');
  if (await fileExists(taskGraphPath)) {
    const content = await readFile(taskGraphPath, 'utf-8');
    const taskGraph = parseTaskGraph(content);
    allTasks = taskGraph.tasks;
  } else {
    // No task-graph document - try to consolidate from blueprint documents
    const files = await readdir(documentsPath);
    const blueprintFiles = files.filter((f) => f.startsWith('blueprint-item-') && f.endsWith('.md'));

    if (blueprintFiles.length === 0) {
      throw new Error('No task-graph or blueprint documents found');
    }

    // Read each blueprint and extract tasks
    for (const blueprintFile of blueprintFiles) {
      const blueprintPath = join(documentsPath, blueprintFile);
      try {
        const content = await readFile(blueprintPath, 'utf-8');
        const taskGraph = parseTaskGraph(content);
        // Add tasks, avoiding duplicates by id
        for (const task of taskGraph.tasks) {
          if (!allTasks.some((t) => t.id === task.id)) {
            allTasks.push(task);
          }
        }
      } catch {
        // Blueprint may not have a valid YAML block, skip it
      }
    }

    if (allTasks.length === 0) {
      throw new Error('No tasks found in blueprint documents');
    }

    // Create consolidated task-graph document from blueprints
    await createConsolidatedTaskGraph(project, session, allTasks);
  }

  // Build batches from all tasks
  const batches = buildBatches(allTasks);

  // Get current state to preserve completedTasks
  const currentState = await getSessionState(project, session);
  const existingCompleted = currentState.completedTasks || [];

  // Calculate pending = all tasks minus completed
  const allTaskIds = allTasks.map((t) => t.id);
  const completedSet = new Set(existingCompleted);
  const pendingTasks = allTaskIds.filter((id) => !completedSet.has(id));

  // Update session state with batches, preserving completed tasks
  await updateSessionState(project, session, {
    batches,
    currentBatch: 0,
    pendingTasks,
    completedTasks: existingCompleted,
  });

  return batches;
}
