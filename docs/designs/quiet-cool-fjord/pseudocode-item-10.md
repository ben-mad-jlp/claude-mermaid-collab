# Pseudocode: Item 10 - Add Padding Below Markdown

## [APPROVED]

## File: ui/src/components/ai-ui/display/Markdown.tsx

### Current Component Structure

```
FUNCTION Markdown({ content, className }):
  # Parse markdown to HTML
  html = parseMarkdown(content)
  
  # Current render (no bottom margin)
  RETURN (
    <div 
      className="prose dark:prose-invert {className}"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
```

### Updated Component

```
FUNCTION Markdown({ content, className }):
  html = parseMarkdown(content)
  
  # Add mb-4 for bottom margin
  RETURN (
    <div 
      className="prose dark:prose-invert mb-4 {className}"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
```

### Change Summary

```
# BEFORE
className="prose dark:prose-invert {className}"

# AFTER  
className="prose dark:prose-invert mb-4 {className}"
                                   ^^^^
                                   Added
```

### Why mb-4 (not padding)

```
RATIONALE:
  - Margin creates space BETWEEN components
  - Padding creates space INSIDE component
  - We want space between Markdown and next component (RadioGroup)
  - mb-4 = margin-bottom: 1rem (16px)
  
ALTERNATIVES CONSIDERED:
  - mb-2 (8px) - too tight
  - mb-6 (24px) - too much
  - mb-4 (16px) - matches typical paragraph spacing
```

### Visual Result

```
BEFORE:
┌─────────────────────────┐
│ Markdown content        │
│ Some text here...       │
│                         │
│ ○ Option 1              │  ← RadioGroup too close
│ ○ Option 2              │
└─────────────────────────┘

AFTER:
┌─────────────────────────┐
│ Markdown content        │
│ Some text here...       │
│                         │
│                         │  ← mb-4 spacing
│ ○ Option 1              │
│ ○ Option 2              │
└─────────────────────────┘
```

## Verification
- [ ] Markdown component has mb-4 class
- [ ] Visible spacing between Markdown and following components
- [ ] Spacing consistent across all render_ui cards
- [ ] No Divider needed for basic spacing
