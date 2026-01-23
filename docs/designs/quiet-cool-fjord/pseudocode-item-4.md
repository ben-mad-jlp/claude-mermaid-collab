# Pseudocode: Item 4 - render_ui Default for User Interactions

## [APPROVED]

## Standard Pattern for All Skills

### Check for Active Session

```
FUNCTION hasActiveSession():
  # Check if collab session exists
  IF exists(".collab/") AND hasSubdirectories(".collab/"):
    RETURN true
  RETURN false
```

### Ask Yes/No Question

```
FUNCTION askYesNo(title, question):
  IF hasActiveSession():
    # Use render_ui
    session = getCurrentSession()
    cwd = getCurrentWorkingDirectory()
    
    response = mcp__mermaid__render_ui({
      project: cwd,
      session: session,
      ui: {
        type: "Card",
        props: { title: title },
        children: [{
          type: "Markdown",
          props: { content: question }
        }],
        actions: [
          { id: "yes", label: "Yes", primary: true },
          { id: "no", label: "No" }
        ]
      },
      blocking: true
    })
    
    RETURN response.action == "yes"
  
  ELSE:
    # Fall back to terminal
    PRINT "{title}"
    PRINT question
    PRINT ""
    PRINT "1. Yes"
    PRINT "2. No"
    
    input = readInput()
    RETURN input == "1"
```

### Ask Multiple Choice

```
FUNCTION askChoice(title, question, options):
  IF hasActiveSession():
    session = getCurrentSession()
    cwd = getCurrentWorkingDirectory()
    
    # Build options for RadioGroup
    radioOptions = []
    FOR i, opt IN enumerate(options):
      ADD { value: str(i+1), label: opt } TO radioOptions
    
    response = mcp__mermaid__render_ui({
      project: cwd,
      session: session,
      ui: {
        type: "Card",
        props: { title: title },
        children: [
          { type: "Markdown", props: { content: question } },
          { type: "RadioGroup", props: { name: "choice", options: radioOptions } }
        ],
        actions: [{ id: "submit", label: "Continue", primary: true }]
      },
      blocking: true
    })
    
    RETURN parseInt(response.data.choice)
  
  ELSE:
    # Fall back to terminal
    PRINT title
    PRINT question
    FOR i, opt IN enumerate(options):
      PRINT "{i+1}. {opt}"
    
    RETURN parseInt(readInput())
```

### Ask Free Text

```
FUNCTION askText(title, question, placeholder):
  IF hasActiveSession():
    session = getCurrentSession()
    cwd = getCurrentWorkingDirectory()
    
    response = mcp__mermaid__render_ui({
      project: cwd,
      session: session,
      ui: {
        type: "Card",
        props: { title: title },
        children: [
          { type: "Markdown", props: { content: question } },
          { type: "TextInput", props: { name: "answer", placeholder: placeholder } }
        ],
        actions: [{ id: "submit", label: "Submit", primary: true }]
      },
      blocking: true
    })
    
    RETURN response.data.answer
  
  ELSE:
    PRINT question
    RETURN readInput()
```

## Skills to Update

Each skill gets "Browser-Based Questions" section with:
1. Reference to these standard functions
2. Skill-specific examples

Files:
- rough-draft/interface.md
- rough-draft/pseudocode.md
- rough-draft/skeleton.md
- rough-draft/handoff.md
- executing-plans/SKILL.md
- ready-to-implement/SKILL.md
- task-planning/SKILL.md
- collab-cleanup/SKILL.md
- finishing-a-development-branch/SKILL.md

## Verification
- [ ] Standard askYesNo/askChoice/askText patterns defined
- [ ] All listed skills have Browser-Based Questions section
- [ ] Terminal fallback when no session active
