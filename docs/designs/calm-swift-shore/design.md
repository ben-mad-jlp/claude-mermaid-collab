# Session: calm-swift-shore

## Session Context
**Out of Scope:** (session-wide boundaries)
**Shared Decisions:** (cross-cutting choices)

---

## Work Items

### Item 1: Simplify session panel cards - replace broken previews with type label, timestamp, and name
**Type:** code
**Status:** documented
**Problem/Goal:**
The session panel cards currently try to show thumbnail previews that don't work - diagram SVGs fail to load and document content is undefined. Replace the broken thumbnail area with a simpler, reliable layout showing: type label, relative timestamp, and name.

**Approach:**
1. Remove thumbnail logic from `renderItems()` in session-panel.js
2. Replace card structure with:
   - Type badge/label ("Document" or "Diagram")
   - Relative timestamp ("2 min ago", "1 hour ago", etc.)
   - Item name (existing)
3. Add `formatRelativeTime(timestamp)` helper function
4. Update CSS to style the new card layout

**Success Criteria:**
- Cards display type, relative time, and name
- No broken images or empty preview areas
- Timestamps update appropriately (or show reasonable static value)

**Decisions:**
- Use relative time format (e.g., "2 min ago") per user preference

---

## Interface Definition

### Files
- `public/js/session-panel.js` - Update renderItems(), add formatRelativeTime()
- `public/css/session-panel.css` - Add card header styles

### Function Signatures
```javascript
formatRelativeTime(timestamp: number): string
renderItems(): void  // modified
```

### CSS Classes
- `.session-panel-card-header` - NEW
- `.session-panel-card-type` - NEW
- `.session-panel-card-time` - NEW

---

## Pseudocode

### formatRelativeTime(timestamp)
```
1. diff = (now - timestamp) / 1000  // seconds
2. if diff < 60: return "just now"
3. if diff < 3600: return "{minutes} min ago"
4. if diff < 86400: return "{hours} hour(s) ago"
5. if diff < 604800: return "{days} day(s) ago"
6. else: return formatted date "Jan 21"
```

### renderItems() card structure
```
For each item:
  card = div.session-panel-card
  header = div.session-panel-card-header
    - span.session-panel-card-type = "Document" | "Diagram"
    - span.session-panel-card-time = formatRelativeTime(lastModified)
  name = div.session-panel-card-name
  card <- header, name
```

---

## Task Dependency Graph

```yaml
tasks:
  - id: card-styles
    files: [public/css/session-panel.css]
    description: Add CSS for card header, type badge, timestamp
    parallel: true

  - id: card-js
    files: [public/js/session-panel.js]
    description: Add formatRelativeTime() and update renderItems()
    depends-on: [card-styles]
```

---

## Diagrams
(auto-synced)
