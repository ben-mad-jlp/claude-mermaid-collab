# Debug: "Syntax error in text / mermaid version 10.9.5" blocks on scroll

## Summary

The on-screen error blocks are Mermaid.js's **own** error-render output (`errorRenderer.draw`),
injected directly into the DOM by `mermaid.render()` when the supplied content fails to parse/draw.
They are **orphaned** SVGs left under `document.body`, not the styled React error panels the
components render. They accumulate as invalid diagrams render while scrolling.

## Root cause (mermaid 10.9.5 internals — confirmed)

`ui/node_modules/mermaid/dist/mermaid.js`:

- Line **14657-14666**: when `mermaid.render(id, content)` is called **without** a third
  `svgContainingElement` argument (which is how the app calls it), Mermaid creates a temporary
  `<div id=...>` and appends it under `d3select("body")` (the document body).
- Line **14685-14690**: when `diag.renderer.draw()` throws (invalid syntax), Mermaid calls
  `errorRenderer.draw(text, id, version$1)` — this draws the "Syntax error in text" + "mermaid
  version 10.9.5" bomb SVG into that body-level temp div — **then rethrows**.
- The component's `catch` sets React `state.error`, but the **orphaned error SVG remains in
  `document.body`**, visible on screen. Repeated failing renders (during scroll) stack up multiple
  copies.

Verified: mermaid version is **10.9.5** (`ui/node_modules/mermaid/package.json`), matching the
on-screen string. The `suppressErrorRendering` option **does not exist in this bundled version**
(it appears in zero dist files) — so the v10.6+ suppress flag is NOT available here without a
mermaid upgrade. The fix must instead (a) avoid calling render with invalid content and
(b) contain/clean the error DOM.

## Render call sites (all client-side)

| File | Line | Call | Empty guard? |
|------|------|------|--------------|
| `ui/src/components/ai-ui/mermaid/DiagramEmbed.tsx` | **109** | `mermaid.render(mermaidId, content)` | Yes — `!content?.trim()` guard at line 95 |
| `ui/src/components/editors/MermaidPreview.tsx` | **419** | `mermaid.render(renderId, content)` | Yes — `!content?.trim()` guard at line 409 |
| `ui/src/components/editors/DiagramEditor.tsx` | **136** | `mermaid.parse(trimmedContent)` | Yes — empty guard at line 126 |

Server route `GET /api/render/:id` (`src/routes/api.ts:1462`) returns a JSON 400 on failure — it
does NOT emit the visual block, so it is not the source.

## Why it fires "on scroll"

Two list/scroll-driven paths render embeds lazily:

1. **Milkdown embeds** — `ui/src/components/editors/milkdown/plugins/diagramEmbedView.tsx` renders
   `<iframe loading="lazy">` per embed; not the direct cause (server route).
2. **Markdown inline embeds + diagram previews/thumbnails** — `DiagramEmbed`/`MermaidPreview` mount
   as items scroll into view. The empty-string guard (`!content?.trim()`) is present, so **truly
   empty** content is safe. The error fires when content is **non-empty but invalid/placeholder**:
   - content that is still a placeholder/loading sentinel string (non-blank, unparseable)
   - an unresolved literal like `{{diagram:id}}` reaching a renderer
   - partially-loaded / streamed content rendered before it is complete
   - a SMACH/transpile-only or design (JSON) artifact whose raw content is fed to `mermaid.render`
     instead of being transpiled first

In all of these, the existing `content?.trim()` guard passes (string is non-empty) so
`mermaid.render` runs, fails, and leaves the orphan error SVG in `document.body`.

## Missing guard

The guard only checks **emptiness** (`!content?.trim()`), not **validity** or **kind**. There is:
- no pre-validation (`mermaid.parse` before `mermaid.render`),
- no scoping of the render output to the component container (render is called WITHOUT the third
  `svgContainingElement` arg, so the temp div lands on `document.body`),
- no cleanup of the orphaned error element on failure,
- no `suppressErrorRendering` (and it isn't available in 10.9.5 anyway).

## Proposed fix

Apply to **both** `DiagramEmbed.tsx` (~line 94-143) and `MermaidPreview.tsx` (~line 408-434):

1. **Pre-validate before rendering** — call `await mermaid.parse(content)` first; if it throws,
   set React error state and `return` WITHOUT calling `mermaid.render`. `mermaid.parse` does NOT
   inject DOM, so no orphan block is produced. This is the primary fix.

   ```ts
   if (!content?.trim()) { setState({ isLoading: false, error: null }); return; }
   try {
     await mermaid.parse(content);            // no DOM side effects
   } catch (e) {
     setState({ isLoading: false, error: (e as Error).message });
     onError?.(e as Error);
     return;                                  // never reach mermaid.render
   }
   const { svg } = await mermaid.render(renderId, content);
   ```

2. **Defense-in-depth: clean up any orphan error element** in the `catch` of `render`, since a
   draw-time (non-parse) failure can still inject one. Mermaid uses the render `id` for the temp
   div, so remove it from the body:

   ```ts
   } catch (error) {
     document.getElementById(renderId)?.remove();
     // also covers the d{id} enclosing div mermaid creates
     document.querySelectorAll(`#d${renderId}`).forEach(el => el.remove());
     ...existing error-state handling...
   }
   ```

3. **Optional / on mermaid upgrade**: bump mermaid to >=10.6 where `suppressErrorRendering: true`
   exists, and add it to the config in `ui/src/lib/mermaidConfig.ts` `initializeMermaid()`
   (line 32-40 `config` object). NOTE: current 10.9.5 dist does not contain the flag, so setting it
   today is a silent no-op — do not rely on it without verifying the installed build honors it.

4. **Confirm kind routing**: ensure design (JSON) artifacts and SMACH/transpile-only diagrams are
   never passed raw to `mermaid.render` (route through transpile / the JSON rough.js renderer).
   `isDesignDiagram()` already exists in `mermaidConfig.ts:84` — gate the render path on it.

## Recommended primary change

Step 1 (parse-before-render guard) is the minimal, highest-leverage fix — it prevents the orphan
DOM injection at the source for the common invalid-content case. Add step 2 as belt-and-suspenders
for draw-time failures.
