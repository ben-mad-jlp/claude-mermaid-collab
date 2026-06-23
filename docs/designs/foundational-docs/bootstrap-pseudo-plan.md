# Pseudo Bootstrap Plan

Script: `bin/bootstrap-pseudo.ts`. Thin driver — all LLM + schema + persistence logic lives in `ollama-coding-mcp`'s `create_pseudocode` handler, which we import directly (not over MCP).

## Architecture

```
bin/bootstrap-pseudo.ts
    │
    ├── initPseudoDbV6(project)              ← read-only target list query
    │       └── SQL: files ⋈ method_calls ⋈ prose_methods
    │
    └── createCreatePseudocodeTool({        ← factory from ollama-coding-mcp
          client: new OllamaClient(),        ← hits OLLAMA_URL
          sandbox: new PathSandbox([project]),
          collab: createCollabClient({       ← HTTP → mermaid-collab server
            baseUrl: COLLAB_API_URL,
          }),
        })
          └── .handler({ project, file, force })
                ├── loads prompts/create_pseudocode.txt
                ├── reads source (truncates to 64KB)
                ├── calls Ollama with format:json, temp 0.2
                ├── validates via zod
                └── POSTs to collab /api/pseudo/upsert
```

The script itself no longer owns the prompt, the LLM call, the JSON parsing, or the persistence — those are one `dist/` import away.

## Prerequisites

- `ollama-coding-mcp` built (`cd /srv/codebase/ai/ollama-coding-mcp && npm run build`)
- Ollama running with the configured model pulled (default `qwen3-coder:30b`)
- mermaid-collab server running (bootstrap writes via HTTP, not in-process)

## Env

- `OLLAMA_URL` — default `http://localhost:11434`
- `OLLAMA_MCP_CHAT_MODEL` — default `qwen3-coder:30b`
- `COLLAB_API_URL` — default `http://localhost:9002`
- `BOOTSTRAP_CONCURRENCY` — default 4
- `BOOTSTRAP_LIMIT` — optional cap (for smoke tests)

## Target selection (SQL)

```sql
SELECT f.file_path, COUNT(mc.id) AS inbound
FROM files f
LEFT JOIN methods m ON m.file_path = f.file_path
LEFT JOIN method_calls mc ON mc.callee_method_id = m.id
LEFT JOIN prose_methods pm
  ON pm.file_path = f.file_path AND pm.prose_origin IN ('llm','manual')
WHERE pm.id IS NULL AND f.stub = 0
GROUP BY f.file_path
ORDER BY inbound DESC, f.file_path ASC
```

Orders by inbound call count so hot/high-impact files are covered first.

The bootstrap's `initPseudoDbV6` is a separate in-process instance from the running server's — it cold-scans just to populate the target list, then disposes. Writes go through HTTP to the server instance, so there's no db-sync issue.

## Running

```bash
# Build the sibling package once (or after updating its prompt):
cd /srv/codebase/ai/ollama-coding-mcp && npm run build

# Smoke-test 5 files:
cd /srv/codebase/claude-mermaid-collab
BOOTSTRAP_LIMIT=5 bun run bin/bootstrap-pseudo.ts

# Full run:
bun run bin/bootstrap-pseudo.ts
```

## Handler output shape (per file)

```ts
{
  ok: boolean,
  file: string,
  methods_written?: number,
  skipped_reason?: string,   // e.g. 'has-existing-prose' when force=false
  error?: string,
  persisted?: boolean,
  persist_error?: string,
}
```

Script counts `ok` / `skip` / `fail` and logs progress every 5 files.

## Prompt ownership

The system prompt lives at `/srv/codebase/ai/ollama-coding-mcp/prompts/create_pseudocode.txt` — single source of truth. The session doc `bootstrap-pseudo-system-prompt` is a historical snapshot of the Grok-refined draft; the canonical prompt may have diverged. To update the prompt, edit the file in the sibling package and rebuild.
