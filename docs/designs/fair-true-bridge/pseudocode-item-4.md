# Pseudocode: Item 4 - Create AI-UI usage skill

## APPROVED

## Skill File Structure

```
FILE: skills/using-ai-ui/SKILL.md

SECTION 1: Header
  # Using AI-UI Components
  Brief description of what this skill teaches

SECTION 2: Overview
  - What render_ui MCP tool does
  - Blocking vs non-blocking mode explanation
  - How form data is collected (name props → action payload)

SECTION 3: Component Selection Guide
  Decision tree:
    Need user to choose from options?
      - 2-5 visible options → RadioGroup
      - 6+ options → MultipleChoice (dropdown)
      - Boolean choice → Toggle or Checkbox
    Need text input?
      - Single line → TextInput
      - Multi-line → TextArea
      - Number with bounds → NumberInput or Slider
    Need file input? → FileUpload
    Display data?
      - Code → CodeBlock
      - JSON → JsonViewer  
      - Table data → Table
      - Rich text → Markdown
      - Image → Image
    Show status?
      - Loading → Spinner
      - Label/tag → Badge
      - Progress → ProgressBar

SECTION 4: Component Reference
  FOR each category:
    ### Category Name
    FOR each component:
      #### ComponentName
      Description
      Props table
      Example JSON

SECTION 5: Best Practices
  - Keep UIs focused (one primary action)
  - Use blocking mode for required decisions
  - Provide clear labels
  - Handle disabled states
  - Use appropriate component for data type

SECTION 6: Examples
  Example 1: Yes/No confirmation
  Example 2: Multiple choice selection
  Example 3: Form with validation
  Example 4: Progress indicator
  Example 5: Data display with actions
```
