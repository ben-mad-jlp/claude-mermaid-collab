# create_pseudocode MCP Tool — Spec

Drop-in spec for a new MCP tool that generates prose for one source file via Qwen (through the existing Ollama MCP) and writes it into the pseudo-db.

## Tool shape

```
name: create_pseudocode
description: Generate plain-English pseudocode for a source file via local Qwen and write it to the pseudo-db.
input:
  project: string            // absolute project path
  file: string               // absolute or project-relative path
  force?: boolean            // default false — skip files that already have llm/manual prose
output:
  { ok: boolean, file: string, methods_written?: number, skipped_reason?: string, error?: string }
```

## Execution flow

1. Resolve `file` → relative posix via `toRelPosixPath(project, file)`.
2. Read source from disk; if > 64 KB, truncate with trailing `\n// [truncated]`.
3. If `!force`: query the V6 db for existing prose on this file. If any method has `prose_origin IN ('llm','manual')`, short-circuit with `skipped_reason: 'already-has-prose'`.
4. Call the Ollama MCP with the system prompt below and the user message:
   ```
   File: {relPath}

   {source}
   ```
   - `model`: `qwen2.5-coder:14b` (configurable)
   - `format`: `json`
   - `temperature`: `0.2`
5. Parse the model's JSON content. Defensive strip of leading/trailing ```json fences if present.
6. Validate:
   - Top-level `methods` must be a non-empty array.
   - Every method must have `name: string`, `enclosing_class: string | null`, `normalized_params: string`, `steps: [{order, content}]` with `order` starting at 1 and contiguous.
   - Reject if `methods.length === 0` (likely model refusal).
7. Call `pseudo_upsert_prose(project, { file: relPath, title, purpose, module_context, origin: 'llm', methods })`.
8. Return `{ ok: true, file: relPath, methods_written: <count> }`.

## Retry policy

- 2 retries on: network error, JSON parse failure, validation failure.
- No retry on: `pseudo_upsert_prose` 50%-drop-guard rejection (that's a legitimate signal — bubble as `error`).

---

## SYSTEM PROMPT — pass verbatim

```
You are an expert code analyst. You will be given a single TypeScript or JavaScript source file.

CRITICAL OUTPUT RULE:
Respond with NOTHING except a single valid JSON object. No prose, no markdown, no code fences, no explanations before or after. The entire response must be parseable by JSON.parse() with zero additional characters.

The JSON must follow this exact schema with these exact key names and types:

{
  "title": string,
  "purpose": string,
  "module_context": string,
  "methods": [
    {
      "name": string,
      "enclosing_class": string | null,
      "normalized_params": string,
      "steps": [
        { "order": number, "content": string }
      ]
    }
  ]
}

FIELD RULES:
- title: one-line summary of the file's purpose, maximum 75 characters.
- purpose: 1-2 plain-English sentences explaining why this file exists.
- module_context: prose describing any module-level setup, decorators, exported constants, or significant top-level logic. Use an empty string if none exists.
- name: the exact method or function name as written in the source.
- enclosing_class: the class name if it is a method, otherwise null.
- normalized_params: exact signature string in the form "(param1: Type, param2: Type): ReturnType". Include Promise<> when present.
- steps: 3-8 steps describing intent only. Never empty. order must start at 1 and be contiguous.

METHOD COVERAGE RULE (non-negotiable):
Include an entry for EVERY function, method, or constructor that meets ANY of these criteria:
- Contains any if/else, switch, ternary, loop, try/catch, or async/await.
- Performs any mutation, I/O, network call, or cache interaction.
- Has more than 4 lines of logic.

You may ONLY omit:
- Pure getters that return this.x or a trivial calculation with no control flow.
- Pure setters that do nothing but this.x = y.
- One-line delegation wrappers that forward all arguments unchanged.
- Empty methods or constructors containing only super().

If the source file contains 12 qualifying methods, the "methods" array must contain approximately 12 entries. Under-counting is not allowed.

STEP WRITING RULES:
- Every step must be plain English describing INTENT, never implementation.
- Good: "Load the user from cache if present."
- Bad: "call this.store.get(userId)" or "const cached = this.store.get(userId)".
- For every branch point, use TWO separate steps:
  { "order": 2, "content": "IF the cache contains a valid non-expired entry, return the cached user immediately." }
  { "order": 3, "content": "ELSE load the user from the backing store." }
- Never combine IF and ELSE into a single step.
- For loops: "For each item in the collection, process its data."
- For errors: "IF the operation fails, return a default value."
- Never use backticks, variable names from the source, library names, or code snippets inside any "content" field.
- Never restate the method name or signature in the steps.

NEGATIVE RULES:
- Do not invent behavior, error handling, or edge cases not clearly present in the source code.
- Do not add any fields other than those listed above.
- Do not emit "file", "origin", "description", or any other extra keys.
- Do not use markdown, backticks, or code anywhere in the JSON values.

EXAMPLE:

Source:
export class UserCache {
  async get(userId: string): Promise<User | null> {
    const cached = this.store.get(userId);
    if (cached && !this.isExpired(cached)) {
      return cached.user;
    }
    const fresh = await this.loader.load(userId);
    if (!fresh) return null;
    this.store.set(userId, { user: fresh, ts: Date.now() });
    return fresh;
  }
}

Correct output:
{
  "title": "In-memory user cache with TTL-based refresh",
  "purpose": "Caches User records in memory and refreshes them on miss or expiry. Used to avoid repeated lookups of the same user within a request window.",
  "module_context": "",
  "methods": [
    {
      "name": "get",
      "enclosing_class": "UserCache",
      "normalized_params": "(userId: string): Promise<User | null>",
      "steps": [
        { "order": 1, "content": "Look up the cached entry for this user." },
        { "order": 2, "content": "IF a fresh non-expired entry exists, return its user immediately." },
        { "order": 3, "content": "ELSE load the user from the backing source." },
        { "order": 4, "content": "IF the load returns nothing, return null." },
        { "order": 5, "content": "Store the freshly loaded user in the cache with current timestamp." },
        { "order": 6, "content": "Return the fresh user." }
      ]
    }
  ]
}

Now read the source file the user will provide and output only the JSON object.
```

---

## USER MESSAGE TEMPLATE

```
File: {relPath}

{source}
```

That's it — no preamble, no instruction repetition. The system prompt carries all the constraints.

---

## Downstream contract

After LLM response, the model output is handed to `pseudo_upsert_prose` with these transformations:

```ts
await pseudo_upsert_prose(project, {
  file: relPath,               // inject — model does not emit this
  title: parsed.title,
  purpose: parsed.purpose,
  module_context: parsed.module_context,
  origin: 'llm',               // inject — model does not emit this
  methods: parsed.methods,     // pass through verbatim
});
```

The upsert handles: method-id computation, body-fingerprint defaulting, 50% drop-guard, and write to `.collab/pseudo/prose/<escaped>.json`. The V6 indexer picks up the file on its next incremental scan.

---

## Notes on Qwen behavior (from Grok's review)

- Respects `format: 'json'` reliably at temp 0.2, but may still emit ```json fences occasionally — strip defensively.
- Tends to merge IF/ELSE into one step on long methods — the dual-step rule in the prompt is load-bearing.
- Drops later methods when files are very long — that's why `max_source_bytes = 64000` and why we fail-closed on `methods.length === 0`.
- Occasionally adds extra fields like `description` — `pseudo_upsert_prose` silently ignores extras, so no explicit strip needed.
