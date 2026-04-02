---
name: consult-grok
description: Consult Grok (xAI) for a second opinion, cross-check reasoning, or explore an idea with a different AI model
user-invocable: true
allowed-tools: mcp__plugin_mermaid-collab_mermaid__consult_grok, mcp__plugin_mermaid-collab_mermaid__create_document
---

# Consult Grok

Send a question or prompt to Grok (xAI) and return the response. Useful for a second opinion, cross-checking your own reasoning, or exploring how a different model approaches a problem.

## When to use

- You want a second perspective on a design decision
- Cross-checking a plan or approach before committing
- Exploring how Grok reasons about a specific problem
- The user explicitly asks to consult Grok

## Steps

### Step 1 — Identify the prompt

If the skill was invoked with an argument (e.g. `/consult-grok how should I structure this auth flow`), use that as the prompt.

If invoked with no argument, ask: **"What would you like to ask Grok?"**

### Step 2 — Optionally set context

If the question benefits from project context (e.g. discussing a specific codebase pattern), prepend a brief system prompt describing the project. Otherwise omit.

### Step 3 — Consult Grok

```
Tool: mcp__plugin_mermaid-collab_mermaid__consult_grok
Args: {
  "prompt": "<the question>",
  "system": "<optional context>",
  "model": "grok-3"
}
```

### Step 4 — Present the response

**If the response is short (≤ 10 lines):** Display it directly in the console.

**If the response is long:** Save it as a document in the active session (if one exists):

```
Tool: mcp__plugin_mermaid-collab_mermaid__create_document
Args: { "project": "<cwd>", "session": "<session>", "name": "grok-[topic]", "content": "# Grok: [topic]\n\n<response>" }
```

Then respond: `"Grok's response saved to 'grok-[topic]'."`

**If no active session:** Display the response directly regardless of length.
