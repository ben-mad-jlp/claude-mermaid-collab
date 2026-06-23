# ollama-coding-mcp — `format` nested-in-options bug: leftover call sites

## Background

Ollama's `/api/generate` (and `/api/chat`) endpoint expects the `format` field at the **top level** of the request body, next to `model`, `prompt`, `system`, `stream`, `options`. When `format` is placed **inside** `options`, Ollama silently ignores it — no error, no warning, just an unconstrained generation.

Symptoms we hit in this project while bootstrapping pseudocode:
- `format: "json"` nested in options → Qwen emitted markdown prose with code fences, failing `JSON.parse`.
- Even after moving `format: "json"` to top level, Qwen still improvised its own schema (`{name, content, summary}`, `{name, description, features}`, etc.) because plain `"json"` only enforces parseability, not structure.
- The real fix was `format: zodToJsonSchema(ResponseSchema)` at top level — Ollama then enforced the exact schema, and 3/3 test files passed on first attempt (41s vs 191s previously).

## What was fixed

Repo: `/srv/codebase/ai/ollama-coding-mcp`

- `src/lib/ollama.ts` — added `format?: "json" | object` to `GenerateReq` at the top level. Kept the old `format` in `OllamaOptions` marked `@deprecated` so existing callers still type-check while they're broken.
- `src/tools/create_pseudocode.ts` — moved `format` out of `options` and switched from `"json"` to `zodToJsonSchema(ResponseSchema)`.

## Leftover call sites (still broken)

Each of these has `format: <schema>` nested inside `options`, meaning Ollama is silently ignoring the structured-output constraint. The code limps along because:
- The tools have their own retry-with-stricter-prompt logic (`json_retry.ts`) that sometimes recovers.
- Smaller outputs happen to parse despite the drift.

But in the steady state each tool is running with **no schema enforcement**, paying latency for retries that shouldn't be necessary.

### 1. `src/lib/json_retry.ts:105-108`

```ts
options: {
  ...(req.options ?? {}),
  format: zodToJsonSchema(schema) as object,   // ← wrong location
},
```

Fix:
```ts
options: { ...(req.options ?? {}) },
format: zodToJsonSchema(schema) as object,
```

This is the highest-leverage fix — `runWithSchemaRetry` is the shared helper other tools wrap.

### 2. `src/tools/generate_unit_tests.ts:195-201` and `:239-245`

Both streaming and retry paths have the same shape:
```ts
options: {
  temperature: 0.4,
  format: formatSchema,   // ← wrong location
},
stream: true,
```

Fix: lift `format: formatSchema` out of `options` to a sibling field in the `GenerateReq` literal.

### 3. `src/tools/stub_implementation.ts:123-129` and `:167-173`

Identical pattern to `generate_unit_tests.ts`. Same fix.

## Suggested cleanup sequence

1. Fix `json_retry.ts` (one-line move).
2. Fix `generate_unit_tests.ts` (two one-line moves).
3. Fix `stub_implementation.ts` (two one-line moves).
4. Delete the `@deprecated format?` field from `OllamaOptions` in `src/lib/ollama.ts` — once no callers reference it, the deprecated hatch can close and TypeScript will catch any future regression.
5. Rebuild: `cd /srv/codebase/ai/ollama-coding-mcp && npm run build`.
6. Run the package's own test suite: `npm test`.

## Verification approach

For each fixed tool, log Qwen's first-attempt raw response with and without the fix (keep source file identical). A correct fix should:
- Eliminate any `json_parse_failure` retries caused by markdown/prose leakage.
- Eliminate any `validation_failure` retries caused by fabricated schemas (model emitting `{description, functions}` etc.).
- Cut per-call latency by roughly the cost of one retry (~1 LLM round-trip).

## Upstream note

Worth adding a comment on `OllamaOptions` pointing to the Ollama API docs (or a linked issue) so future maintainers don't re-introduce the bug. The runtime silence is the trap — `tsc` happily accepts both locations.
