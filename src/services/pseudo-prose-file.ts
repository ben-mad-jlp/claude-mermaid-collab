/**
 * Pseudo Prose File — ProseFileV3 schema + atomic IO with fsync durability.
 * Hand-rolled validation (no ajv).
 */

import { openSync, writeSync, fsyncSync, closeSync, renameSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { toRelPosixPath } from './pseudo-path-escape.js';

export interface ProseStep {
  order: number;
  content: string;
}

export interface ProseMethodTags {
  deprecated: boolean;
  since?: string;
}

export interface ProseMethod {
  id: string;
  name: string;
  enclosing_class: string | null;
  normalized_params: string;
  body_fingerprint: string;
  prose_origin: 'manual' | 'llm';
  steps: ProseStep[];
  tags: ProseMethodTags;
}

export interface ProseFileV3 {
  schema_version: 3;
  file: string;
  title: string;
  purpose: string;
  module_context: string;
  methods: ProseMethod[];
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function fail(field: string, reason: string): never {
  throw new Error(`ProseFileV3 validation failed at ${field}: ${reason}`);
}

function assertString(v: unknown, field: string): string {
  if (typeof v !== 'string') fail(field, `expected string, got ${typeof v}`);
  return v as string;
}

function assertBoolean(v: unknown, field: string): boolean {
  if (typeof v !== 'boolean') fail(field, `expected boolean, got ${typeof v}`);
  return v as boolean;
}

function assertNumber(v: unknown, field: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(field, `expected finite number, got ${typeof v}`);
  return v as number;
}

function validateStep(raw: unknown, field: string): ProseStep {
  if (!isObject(raw)) fail(field, 'expected object');
  const order = assertNumber((raw as any).order, `${field}.order`);
  if (!Number.isInteger(order) || order < 0) fail(`${field}.order`, 'expected non-negative integer');
  const content = assertString((raw as any).content, `${field}.content`);
  return { order, content };
}

function validateTags(raw: unknown, field: string): ProseMethodTags {
  if (!isObject(raw)) fail(field, 'expected object');
  const deprecated = assertBoolean((raw as any).deprecated, `${field}.deprecated`);
  const sinceRaw = (raw as any).since;
  const tags: ProseMethodTags = { deprecated };
  if (sinceRaw !== undefined) tags.since = assertString(sinceRaw, `${field}.since`);
  return tags;
}

function validateMethod(raw: unknown, field: string): ProseMethod {
  if (!isObject(raw)) fail(field, 'expected object');
  const id = assertString((raw as any).id, `${field}.id`);
  const name = assertString((raw as any).name, `${field}.name`);
  const enclosingRaw = (raw as any).enclosing_class;
  let enclosing_class: string | null;
  if (enclosingRaw === null) {
    enclosing_class = null;
  } else if (typeof enclosingRaw === 'string') {
    enclosing_class = enclosingRaw;
  } else {
    fail(`${field}.enclosing_class`, 'expected string or null');
  }
  const normalized_params = assertString((raw as any).normalized_params, `${field}.normalized_params`);
  const body_fingerprint = assertString((raw as any).body_fingerprint, `${field}.body_fingerprint`);
  const proseOriginRaw = (raw as any).prose_origin;
  if (proseOriginRaw !== 'manual' && proseOriginRaw !== 'llm') {
    fail(`${field}.prose_origin`, `expected 'manual' | 'llm', got ${JSON.stringify(proseOriginRaw)}`);
  }
  const stepsRaw = (raw as any).steps;
  if (!Array.isArray(stepsRaw)) fail(`${field}.steps`, 'expected array');
  const steps = stepsRaw.map((s, i) => validateStep(s, `${field}.steps[${i}]`));
  const tags = validateTags((raw as any).tags, `${field}.tags`);
  return {
    id,
    name,
    enclosing_class: enclosing_class!,
    normalized_params,
    body_fingerprint,
    prose_origin: proseOriginRaw,
    steps,
    tags,
  };
}

export function validateProseSchema(raw: unknown): ProseFileV3 {
  if (!isObject(raw)) fail('<root>', 'expected object');
  const sv = (raw as any).schema_version;
  if (sv !== 3) fail('schema_version', `expected 3, got ${JSON.stringify(sv)}`);
  const file = assertString((raw as any).file, 'file');
  const title = assertString((raw as any).title, 'title');
  const purpose = assertString((raw as any).purpose, 'purpose');
  const module_context = assertString((raw as any).module_context, 'module_context');
  const methodsRaw = (raw as any).methods;
  if (!Array.isArray(methodsRaw)) fail('methods', 'expected array');
  const methods = methodsRaw.map((m, i) => validateMethod(m, `methods[${i}]`));
  return { schema_version: 3, file, title, purpose, module_context, methods };
}

export async function readProseFile(path: string, project?: string): Promise<ProseFileV3 | null> {
  if (!existsSync(path)) return null;
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    throw new Error(`Failed to read prose file at ${path}: ${(err as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`Malformed JSON in prose file ${path}: ${(err as Error).message}`);
  }
  const proseFile = validateProseSchema(parsed);
  if (project !== undefined) {
    try {
      proseFile.file = toRelPosixPath(project, proseFile.file);
    } catch {
      // Cross-machine / escapes-root paths left untouched so
      // migrateProseFilesToRelative can bucket them into _orphan/.
    }
  }
  return proseFile;
}

export async function writeProseFile(path: string, content: ProseFileV3): Promise<void> {
  const validated = validateProseSchema(content);
  mkdirSync(dirname(path), { recursive: true });
  const tmpPath = path + '.tmp';
  const fd = openSync(tmpPath, 'w');
  try {
    const json = JSON.stringify(validated, null, 2);
    writeSync(fd, json);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmpPath, path);
}
