# Research: Embedding Storybook Stories in mermaid-collab UI

## 1. How the Collab UI Works

The collab UI runs at **http://localhost:3737** and is a React-based application served by the mermaid-collab plugin.

### Artifact Types
- **Documents** — Markdown with `{{diagram:id}}` and `{{design:id}}` embed syntax
- **Diagrams** — Mermaid syntax rendered visually
- **Designs** — Scene-graph-based UI designs with a visual editor
- **Snippets** — Code blocks with syntax highlighting
- **Spreadsheets** — Tabular data with CSV export

### Dynamic UI (render_ui)
32 component types. **No iframe or WebView component exists currently.** Closest: Image, Link, Markdown.

## 2. Integration Approaches (Ranked)

### Approach A: Links (works today, zero effort)
Use render_ui's `Link` component to open Storybook URLs in a new tab. Not embedded but functional immediately.

### Approach B: IframeEmbed render_ui Component (Recommended)
Add a new `IframeEmbed` component type to render_ui. Single React component, reusable for any URL (Storybook, API docs, test reports). Moderate effort.

### Approach C: Markdown iframe
Embed `<iframe>` in documents. Likely blocked by markdown sanitizer — needs testing.

### Approach D: Full Artifact Type (Largest effort)
First-class sidebar integration with story discovery. Only worthwhile if Storybook becomes central to collab workflows.

## 3. CORS / Security
- No CORS issues (both localhost, iframes don't trigger CORS)
- Storybook's `iframe.html` is designed for embedding — no restrictive frame headers
- Use `sandbox="allow-scripts allow-same-origin"` for safety

## 4. Storybook iframe.html Reference
```
http://localhost:{port}/iframe.html?id={story-id}&viewMode=story

# Story ID = kebab-case of title + export name
# title: 'Home/HomeScreen' + export Default → home-homescreen--default
```

## 5. Recommendation
Start with **Approach B (IframeEmbed component)** — single React component addition, reusable, moderate effort. Can later wrap in a convenience MCP tool like `embed_storybook(storyId)`.