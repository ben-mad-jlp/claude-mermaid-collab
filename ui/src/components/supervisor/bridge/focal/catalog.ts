/**
 * focal/catalog.ts — the CLOSED component catalog for the focal DecisionCard
 * (BR-4, design §4/§6/§8).
 *
 * This is the client mirror of the server-side escalation-ui-schema. The catalog
 * is a fixed discriminated union — there is no html / raw / passthrough element
 * and every prop is plain data, so a rendered spec can never execute arbitrary
 * content (CodeBlock / DiffView render as TEXT). Every interactive element
 * resolves to exactly ONE existing action:
 *   OptionButton → decideEscalation(optionId)
 *   SubmitButton / Form → resolveEscalation(payload)
 *
 * The server already validates on write; we re-validate on read (defence in
 * depth) so a spec that somehow arrives malformed is dropped, not rendered.
 */

import { z } from 'zod';

const MAX_ELEMENTS = 40;

const tone = z.enum(['info', 'success', 'warning', 'danger']);

export const HeadingSchema = z.object({ type: z.literal('Heading'), text: z.string(), level: z.number().int().min(1).max(4).optional() }).strict();
export const TextSchema = z.object({ type: z.literal('Text'), text: z.string() }).strict();
export const CalloutSchema = z.object({ type: z.literal('Callout'), tone, text: z.string() }).strict();
export const CodeBlockSchema = z.object({ type: z.literal('CodeBlock'), lang: z.string().optional(), code: z.string() }).strict();
export const DiffViewSchema = z.object({ type: z.literal('DiffView'), filename: z.string(), before: z.string(), after: z.string() }).strict();
export const CompareTableSchema = z.object({ type: z.literal('CompareTable'), columns: z.array(z.string()), rows: z.array(z.array(z.string())) }).strict();
export const KeyValueSchema = z.object({ type: z.literal('KeyValue'), pairs: z.array(z.object({ key: z.string(), value: z.string() }).strict()) }).strict();
export const OptionButtonSchema = z.object({ type: z.literal('OptionButton'), optionId: z.string(), label: z.string(), recommended: z.boolean().optional() }).strict();
export const FormFieldSchema = z.object({ name: z.string(), label: z.string(), kind: z.enum(['text', 'textarea']).optional() }).strict();
export const FormSchema = z.object({ type: z.literal('Form'), fields: z.array(FormFieldSchema), submitLabel: z.string().optional() }).strict();
export const SubmitButtonSchema = z.object({ type: z.literal('SubmitButton'), label: z.string(), payload: z.record(z.string(), z.string()).optional() }).strict();

export const ElementSchema = z.discriminatedUnion('type', [
  HeadingSchema,
  TextSchema,
  CalloutSchema,
  CodeBlockSchema,
  DiffViewSchema,
  CompareTableSchema,
  KeyValueSchema,
  OptionButtonSchema,
  FormSchema,
  SubmitButtonSchema,
]);

export const JsonRenderSpecSchema = z.object({ elements: z.array(ElementSchema).min(1).max(MAX_ELEMENTS) }).strict();

export type UiElement = z.infer<typeof ElementSchema>;
export type JsonRenderSpec = z.infer<typeof JsonRenderSpecSchema>;
export type FormField = z.infer<typeof FormFieldSchema>;

const TERMINAL_TYPES = new Set(['OptionButton', 'SubmitButton', 'Form']);

/** Re-validate a spec on read; returns it only if valid + has a terminal action. */
export function parseUiSpec(input: unknown): JsonRenderSpec | null {
  if (input == null) return null;
  const parsed = JsonRenderSpecSchema.safeParse(input);
  if (!parsed.success) return null;
  if (!parsed.data.elements.some((e) => TERMINAL_TYPES.has(e.type))) return null;
  return parsed.data;
}
