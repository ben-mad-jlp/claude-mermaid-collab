# Pseudocode: Item 5 - Update collab to recommend AI-UI

## APPROVED

## Files to Update

```
FILES:
  - skills/brainstorming/SKILL.md
  - skills/brainstorming/clarifying.md
  - skills/brainstorming/designing.md
  - skills/gather-session-goals/SKILL.md
```

## Update Process for Each File

```
FOR each file in FILES:
  1. LOCATE existing "Browser-Based Questions" section
     IF not found, ADD section before "Integration" section
  
  2. UPDATE/ADD content:
     
     ## Browser-Based Questions
     
     When a collab session is active, prefer render_ui for user interactions.
     
     ### Component Selection by Question Type
     
     | Question Type | Component | Example |
     |--------------|-----------|---------|
     | Yes/No | Card with action buttons | Confirm proceed? |
     | Choose 1 of 2-5 | RadioGroup | Select approach |
     | Choose 1 of 6+ | MultipleChoice | Select from list |
     | Choose multiple | Checkbox | Select features |
     | Free text | TextInput | Enter name |
     | Long text | TextArea | Describe problem |
     
     ### Pattern: Yes/No Question
     Card → Markdown (question) → actions [yes, no]
     
     ### Pattern: Multiple Choice
     Card → RadioGroup (options) → actions [submit]
     
     ### Pattern: Text Input
     Card → TextInput (name) → actions [submit]
  
  3. VERIFY section is within skill file (not at end)
```

## Verification

```
FUNCTION verifySkillUpdates():
  FOR each file in FILES:
    content = readFile(file)
    
    ASSERT "Browser-Based Questions" in content
    ASSERT "render_ui" in content
    ASSERT "RadioGroup" in content (new component reference)
    ASSERT "Card" in content (wrapper pattern)
```
