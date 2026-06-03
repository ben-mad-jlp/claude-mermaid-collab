/**
 * escalation-ui-schema — SERVER-SIDE validation for an escalation's optional
 * `ui` JSON-render spec (BR-4, design §4/§6/§8).
 *
 * The catalog is CLOSED: a fixed discriminated union of presentational +
 * terminal-action components. There is deliberately no html / raw / passthrough
 * element and no function-valued prop — props are plain data only, so a spec can
 * never carry executable content. CodeBlock / DiffView render as TEXT downstream,
 * never executed.
 *
 * `validateUiSpec` is DEFENSIVE: an absent or malformed `ui` returns null rather
 * than throwing, so a bad spec never blocks escalation creation — the escalation
 * simply falls back to its options[] / legacy card (always answerable). When a
 * spec IS present and valid it must additionally contain a terminal action
 * (OptionButton / SubmitButton / Form) so the rendered card can actually answer.
 */

import { z } from 'zod';

const MAX_ELEMENTS = 40;

const tone = z.enum(['info', 'success', 'warning', 'danger']);

const Heading = z.object({ type: z.literal('Heading'), text: z.string(), level: z.number().int().min(1).max(4).optional() }).strict();
const Text = z.object({ type: z.literal('Text'), text: z.string() }).strict();
const Callout = z.object({ type: z.literal('Callout'), tone, text: z.string() }).strict();
const CodeBlock = z.object({ type: z.literal('CodeBlock'), lang: z.string().optional(), code: z.string() }).strict();
const DiffView = z.object({ type: z.literal('DiffView'), filename: z.string(), before: z.string(), after: z.string() }).strict();
const CompareTable = z
  .object({ type: z.literal('CompareTable'), columns: z.array(z.string()), rows: z.array(z.array(z.string())) })
  .strict();
const KeyValue = z
  .object({ type: z.literal('KeyValue'), pairs: z.array(z.object({ key: z.string(), value: z.string() }).strict()) })
  .strict();
const OptionButton = z
  .object({ type: z.literal('OptionButton'), optionId: z.string(), label: z.string(), recommended: z.boolean().optional() })
  .strict();
const FormField = z
  .object({ name: z.string(), label: z.string(), kind: z.enum(['text', 'textarea']).optional() })
  .strict();
const Form = z
  .object({ type: z.literal('Form'), fields: z.array(FormField), submitLabel: z.string().optional() })
  .strict();
const SubmitButton = z
  .object({ type: z.literal('SubmitButton'), label: z.string(), payload: z.record(z.string(), z.string()).optional() })
  .strict();

export const ElementSchema = z.discriminatedUnion('type', [
  Heading,
  Text,
  Callout,
  CodeBlock,
  DiffView,
  CompareTable,
  KeyValue,
  OptionButton,
  Form,
  SubmitButton,
]);

export const JsonRenderSpecSchema = z
  .object({ elements: z.array(ElementSchema).min(1).max(MAX_ELEMENTS) })
  .strict();

export type JsonRenderSpec = z.infer<typeof JsonRenderSpecSchema>;
export type UiElement = z.infer<typeof ElementSchema>;

const TERMINAL_TYPES = new Set(['OptionButton', 'SubmitButton', 'Form']);

/**
 * Validate an untrusted `ui` value. Returns the parsed spec when it is a valid,
 * closed-catalog, size-capped spec that contains at least one terminal action;
 * otherwise null (defensively dropped — never throws).
 */
export function validateUiSpec(input: unknown): JsonRenderSpec | null {
  if (input == null) return null;
  const parsed = JsonRenderSpecSchema.safeParse(input);
  if (!parsed.success) return null;
  const hasTerminal = parsed.data.elements.some((e) => TERMINAL_TYPES.has(e.type));
  if (!hasTerminal) return null;
  return parsed.data;
}
