# Design: IframeEmbed Component for render_ui

## Overview

Add an `IframeEmbed` component to the AI-UI component system, enabling Claude to embed external URLs (e.g., Storybook stories, documentation, web apps) as iframes in the collab browser UI via the `render_ui` MCP tool.

This component belongs in the **Mermaid** category alongside `DiagramEmbed` and `WireframeEmbed`, but is more general-purpose -- it embeds arbitrary external URLs rather than internal artifact IDs.

---

## Architecture Summary

### Rendering Pipeline (existing)

```
Claude calls render_ui MCP tool
  -> src/mcp/tools/render-ui.ts validates UI structure
  -> Generates unique uiId
  -> Broadcasts via WebSocket (type: 'ui_render')
  -> Browser receives message
  -> ui/src/components/ai-ui/registry.ts looks up component by type
  -> React component renders with provided props
  -> User interaction triggers ui_response back to Claude
```

### Component Registry Pattern

Components are registered in `ui/src/components/ai-ui/registry.ts` using a `Map<string, ComponentMetadata>` where:

```typescript
interface ComponentMetadata {
  name: string;
  category: 'display' | 'layout' | 'interactive' | 'inputs' | 'mermaid';
  description: string;
  component: React.ComponentType<any>;
}
```

Components are looked up by type string: `ComponentRegistry.get('IframeEmbed')`.

### Tool Schema (existing)

The `render_ui` tool in `src/mcp/setup.ts` defines available components in the tool description. The `ui` parameter accepts `{ type: string, ...props }` JSON objects.

---

## Files to Create

### 1. `ui/src/components/ai-ui/mermaid/IframeEmbed.tsx`

The React component implementation.

---

## Files to Modify

### 2. `ui/src/components/ai-ui/registry.ts`

Add `IframeEmbed` to the component registry map:

```typescript
import { IframeEmbed } from './mermaid/IframeEmbed';

// In the registry map:
registry.set('IframeEmbed', {
  name: 'IframeEmbed',
  category: 'mermaid',  // or could introduce 'embed' category
  description: 'Embed an external URL in an iframe',
  component: IframeEmbed,
});
```

### 3. `src/mcp/setup.ts`

Update the `render_ui` tool description to document the new component. Add to the Mermaid section (or rename it to "Embed"):

```
### Mermaid/Embed (3)
- DiagramEmbed: { diagramId }
- WireframeEmbed: { wireframeId }
- IframeEmbed: { src, title?, width?, height?, sandbox?, allow?, loading? }
```

### 4. `src/ai-ui.ts` (type definitions)

Add the `IframeEmbed` type to the UI component type union:

```typescript
interface IframeEmbedProps {
  src: string;
  title?: string;
  width?: string | number;
  height?: string | number;
  sandbox?: string;
  allow?: string;
  loading?: 'eager' | 'lazy';
}
```

---

## Component Props

| Prop | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `src` | `string` | Yes | -- | URL to embed. Must be a valid http/https URL. |
| `title` | `string` | No | `"Embedded content"` | Accessible title for the iframe element. |
| `width` | `string \| number` | No | `"100%"` | Width of the iframe. String for CSS units, number for pixels. |
| `height` | `string \| number` | No | `600` | Height in pixels or CSS string. |
| `sandbox` | `string` | No | `"allow-scripts allow-same-origin"` | Iframe sandbox attribute. Restricts capabilities. |
| `allow` | `string` | No | `""` | Iframe allow attribute (permissions policy). |
| `loading` | `"eager" \| "lazy"` | No | `"lazy"` | Browser loading strategy. |

---

## Component Implementation

Following the existing pattern from DiagramEmbed/WireframeEmbed (React functional component with Tailwind CSS):

```tsx
import React, { useState, useCallback, useMemo } from 'react';

interface IframeEmbedProps {
  src: string;
  title?: string;
  width?: string | number;
  height?: string | number;
  sandbox?: string;
  allow?: string;
  loading?: 'eager' | 'lazy';
}

// Allowlist of URL schemes
const ALLOWED_SCHEMES = ['http:', 'https:'];

function isValidUrl(src: string): boolean {
  try {
    const url = new URL(src);
    return ALLOWED_SCHEMES.includes(url.protocol);
  } catch {
    return false;
  }
}

export function IframeEmbed({
  src,
  title = 'Embedded content',
  width = '100%',
  height = 600,
  sandbox = 'allow-scripts allow-same-origin',
  allow = '',
  loading = 'lazy',
}: IframeEmbedProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  const handleLoad = useCallback(() => {
    setIsLoading(false);
  }, []);

  const handleError = useCallback(() => {
    setIsLoading(false);
    setHasError(true);
  }, []);

  const isValid = useMemo(() => isValidUrl(src), [src]);

  const style = useMemo(() => ({
    width: typeof width === 'number' ? `${width}px` : width,
    height: typeof height === 'number' ? `${height}px` : height,
  }), [width, height]);

  if (!isValid) {
    return (
      <div className="rounded-lg border border-red-300 bg-red-50 dark:border-red-700 dark:bg-red-900/20 p-4">
        <p className="text-red-600 dark:text-red-400 text-sm">
          Invalid URL: only http:// and https:// URLs are allowed.
        </p>
      </div>
    );
  }

  if (hasError) {
    return (
      <div className="rounded-lg border border-yellow-300 bg-yellow-50 dark:border-yellow-700 dark:bg-yellow-900/20 p-4">
        <p className="text-yellow-700 dark:text-yellow-400 text-sm">
          Failed to load: <code className="text-xs">{src}</code>
        </p>
        <button
          onClick={() => { setHasError(false); setIsLoading(true); }}
          className="mt-2 text-xs text-blue-600 dark:text-blue-400 hover:underline"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="relative rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700" style={style}>
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-50 dark:bg-gray-800">
          <div className="flex flex-col items-center gap-2">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-blue-500" />
            <span className="text-xs text-gray-500 dark:text-gray-400">Loading...</span>
          </div>
        </div>
      )}
      <iframe
        src={src}
        title={title}
        sandbox={sandbox}
        allow={allow}
        loading={loading}
        onLoad={handleLoad}
        onError={handleError}
        className="w-full h-full border-0"
        style={{ display: isLoading ? 'none' : 'block' }}
      />
    </div>
  );
}
```

---

## Usage via render_ui MCP Tool

### Basic Storybook Story Embed

```json
{
  "type": "IframeEmbed",
  "src": "http://localhost:6006/?path=/story/features-picking--default",
  "title": "Picking Screen - Storybook",
  "height": 700
}
```

### Storybook with Specific Viewport

```json
{
  "type": "Card",
  "title": "Mobile Picking Screen Preview",
  "children": [
    {
      "type": "IframeEmbed",
      "src": "http://localhost:6006/iframe.html?id=features-picking--default&viewMode=story",
      "title": "Picking Screen",
      "width": 375,
      "height": 667
    }
  ]
}
```

### Documentation Embed

```json
{
  "type": "IframeEmbed",
  "src": "https://mermaid.js.org/intro/",
  "title": "Mermaid Documentation",
  "height": 500,
  "sandbox": "allow-scripts allow-same-origin allow-popups"
}
```

### Side-by-Side Comparison with Columns

```json
{
  "type": "Columns",
  "columns": 2,
  "children": [
    {
      "type": "IframeEmbed",
      "src": "http://localhost:6006/iframe.html?id=features-picking--default",
      "title": "Current",
      "height": 500
    },
    {
      "type": "IframeEmbed",
      "src": "http://localhost:6006/iframe.html?id=features-picking--redesign",
      "title": "Redesign",
      "height": 500
    }
  ]
}
```

---

## Security Considerations

### Sandbox Attribute

The default sandbox value `"allow-scripts allow-same-origin"` is intentionally restrictive:

| Permission | Included | Why |
|------------|----------|-----|
| `allow-scripts` | Yes | Storybook/web apps need JS |
| `allow-same-origin` | Yes | Required for same-origin Storybook |
| `allow-popups` | No | Prevent unwanted popups |
| `allow-forms` | No | Prevent form submission to external targets |
| `allow-top-navigation` | No | Prevent iframe from navigating parent |

Callers can override sandbox to add permissions as needed, e.g. `"allow-scripts allow-same-origin allow-forms"`.

### URL Validation

- Only `http://` and `https://` schemes are allowed
- `javascript:`, `data:`, and `file:` URLs are rejected
- Validation happens client-side before rendering the iframe

### Content Security Policy

The mermaid-collab server may need a CSP update to allow `frame-src` for the domains being embedded. For localhost Storybook this is typically not an issue, but for external domains:

```
frame-src 'self' http://localhost:* https://*.example.com;
```

---

## Loading and Error States

1. **Loading**: Spinner overlay displayed until iframe fires `onLoad`
2. **Error**: Yellow warning box with the failed URL and a retry button
3. **Invalid URL**: Red error box displayed immediately (no iframe rendered)
4. **Lazy loading**: Default `loading="lazy"` defers off-screen iframes

---

## Resize Behavior

- `width: "100%"` (default) makes the iframe fill its container
- Fixed pixel widths (e.g., `375` for mobile preview) create a fixed-width embed
- The container has `overflow: hidden` and `border-radius` for clean edges
- The iframe itself has no border (`border-0` class)

---

## Implementation Checklist

1. [ ] Create `ui/src/components/ai-ui/mermaid/IframeEmbed.tsx` with the component
2. [ ] Register in `ui/src/components/ai-ui/registry.ts`
3. [ ] Add type definition to `src/ai-ui.ts`
4. [ ] Update tool description in `src/mcp/setup.ts` to document IframeEmbed
5. [ ] Add validation in `src/mcp/tools/render-ui.ts` for the `src` prop (optional, client validates too)
6. [ ] Test with local Storybook URL
7. [ ] Test error/loading states
8. [ ] Verify sandbox restrictions work correctly

---

## Relationship to Existing Embeds

| Component | Source | Renders |
|-----------|--------|---------|
| `DiagramEmbed` | `diagramId` (internal) | Mermaid diagram from session |
| `WireframeEmbed` | `wireframeId` (internal) | Wireframe design from session |
| `IframeEmbed` | `src` (external URL) | Any web content via iframe |

DiagramEmbed and WireframeEmbed resolve internal artifact IDs to rendered content. IframeEmbed is fundamentally different -- it takes an external URL and renders it directly. This is why it needs security controls (sandbox, URL validation) that the other embeds do not.
