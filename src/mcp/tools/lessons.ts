/**
 * Session Lessons Tools
 *
 * MCP tools for recording lessons learned during collab sessions.
 * Lessons are stored in LESSONS.md within the session's documents folder.
 */

import { readFile, writeFile, mkdir, access, appendFile } from 'fs/promises';
import { join } from 'path';

// ============= Type Definitions =============

export type LessonCategory = 'universal' | 'codebase' | 'workflow' | 'gotcha';

export interface Lesson {
  timestamp: string;
  category: LessonCategory;
  content: string;
}

export interface AddLessonResult {
  success: boolean;
  lessonCount: number;
  message: string;
}

export interface ListLessonsResult {
  lessons: Lesson[];
  count: number;
}

// ============= Schemas =============

export const addLessonSchema = {
  type: 'object',
  properties: {
    project: { type: 'string', description: 'Absolute path to project root' },
    session: { type: 'string', description: 'Session name' },
    lesson: { type: 'string', description: 'The lesson content' },
    category: {
      type: 'string',
      enum: ['universal', 'codebase', 'workflow', 'gotcha'],
      description: 'Type of lesson (default: universal)',
    },
  },
  required: ['project', 'session', 'lesson'],
};

export const listLessonsSchema = {
  type: 'object',
  properties: {
    project: { type: 'string', description: 'Absolute path to project root' },
    session: { type: 'string', description: 'Session name' },
  },
  required: ['project', 'session'],
};

// ============= Helper Functions =============

function getLessonsPath(project: string, session: string): string {
  return join(project, '.collab', 'sessions', session, 'documents', 'LESSONS.md');
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function formatTimestamp(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

const LESSONS_HEADER = `# Session Lessons

Learnings captured during this collab session.
`;

// ============= Tool Functions =============

/**
 * Add a lesson to the session's LESSONS.md file.
 * Creates the file if it doesn't exist.
 */
export async function addLesson(
  project: string,
  session: string,
  lesson: string,
  category: LessonCategory = 'universal'
): Promise<AddLessonResult> {
  const lessonsPath = getLessonsPath(project, session);
  const documentsDir = join(project, '.collab', 'sessions', session, 'documents');

  // Ensure documents directory exists
  await mkdir(documentsDir, { recursive: true });

  // Create file with header if it doesn't exist
  if (!(await fileExists(lessonsPath))) {
    await writeFile(lessonsPath, LESSONS_HEADER, 'utf-8');
  }

  // Append new lesson with timestamp and category
  const timestamp = formatTimestamp();
  const entry = `\n---\n\n## ${timestamp} [${category}]\n${lesson}\n`;
  await appendFile(lessonsPath, entry, 'utf-8');

  // Count lessons
  const content = await readFile(lessonsPath, 'utf-8');
  const lessonCount = (content.match(/^## \d{4}-\d{2}-\d{2}/gm) || []).length;

  return {
    success: true,
    lessonCount,
    message: `Lesson recorded. Total lessons: ${lessonCount}`,
  };
}

/**
 * List all lessons from a session.
 */
export async function listLessons(
  project: string,
  session: string
): Promise<ListLessonsResult> {
  const lessonsPath = getLessonsPath(project, session);

  if (!(await fileExists(lessonsPath))) {
    return { lessons: [], count: 0 };
  }

  const content = await readFile(lessonsPath, 'utf-8');

  // Parse lessons from markdown
  const lessonPattern = /^## (\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) \[(\w+)\]\n([\s\S]*?)(?=\n---|\n## |$)/gm;
  const lessons: Lesson[] = [];
  let match;

  while ((match = lessonPattern.exec(content)) !== null) {
    lessons.push({
      timestamp: match[1],
      category: match[2] as LessonCategory,
      content: match[3].trim(),
    });
  }

  return {
    lessons,
    count: lessons.length,
  };
}
