# Pseudocode: Item 3
## Refactor skills that reference md files into separate skills

[APPROVED]

---

### Main Process: Create 13 New Skills

```
FOR each skill in SOURCE_MAPPING:
  1. Read source markdown file
     - path = skills/{parent}/{source-file}.md
     - IF file not found: ERROR and skip
  
  2. Extract description from first paragraph
     - description = first non-empty line after any heading
  
  3. Create skill folder
     - mkdir skills/{new-skill-name}/
  
  4. Create skill.yaml
     WRITE to skills/{new-skill-name}/skill.yaml:
       name: {new-skill-name}
       description: {extracted-description}
       user-invocable: false
       allowed-tools:
         - Read
         - Glob
         - Grep
         - Bash
         - AskUserQuestion
         - mcp__plugin_mermaid-collab_mermaid__*
  
  5. Create SKILL.md
     - content = source file content
     - ADD header: "Base directory for this skill: ..."
     - WRITE to skills/{new-skill-name}/SKILL.md
  
  6. Log success: "Created skill: {new-skill-name}"
```

### SOURCE_MAPPING

```
[
  { parent: "collab", source: "session-mgmt", newName: "collab-session-mgmt" },
  { parent: "collab", source: "work-item-loop", newName: "collab-work-item-loop" },
  { parent: "brainstorming", source: "exploring", newName: "brainstorming-exploring" },
  { parent: "brainstorming", source: "clarifying", newName: "brainstorming-clarifying" },
  { parent: "brainstorming", source: "designing", newName: "brainstorming-designing" },
  { parent: "brainstorming", source: "validating", newName: "brainstorming-validating" },
  { parent: "brainstorming", source: "transition", newName: "brainstorming-transition" },
  { parent: "rough-draft", source: "interface", newName: "rough-draft-interface" },
  { parent: "rough-draft", source: "pseudocode", newName: "rough-draft-pseudocode" },
  { parent: "rough-draft", source: "skeleton", newName: "rough-draft-skeleton" },
  { parent: "rough-draft", source: "handoff", newName: "rough-draft-handoff" },
  { parent: "executing-plans", source: "execution", newName: "executing-plans-execution" },
  { parent: "executing-plans", source: "review", newName: "executing-plans-review" }
]
```

---

### Update Parent Skills

```
FOR each parent in [collab, brainstorming, rough-draft, executing-plans]:
  1. Read parent SKILL.md
     - path = skills/{parent}/SKILL.md
  
  2. Find all references to child md files
     - PATTERN: "For detailed instructions, see [{name}]({file}.md)"
     - PATTERN: "For detailed instructions, see [{name} Phase]({file}.md)"
  
  3. Replace each reference with skill invocation
     - OLD: "**For detailed instructions, see [session-mgmt.md](session-mgmt.md).**"
     - NEW: "**Invoke skill:** collab-session-mgmt"
  
  4. Write updated SKILL.md
  
  5. Log: "Updated parent: {parent}"
```

---

### Cleanup (After Verification)

```
AFTER all new skills verified working:
  FOR each source file in SOURCE_MAPPING:
    - DELETE skills/{parent}/{source}.md
    - Log: "Deleted old file: {source}.md"
```

---

### Error Handling

- Source file not found: Log error, continue with other skills
- Skill folder already exists: Log warning, skip (idempotent)
- Parent SKILL.md not found: Critical error, stop
- Write permission denied: Critical error, stop

### Edge Cases

- Source file is empty: Create skill with minimal content
- Multiple reference patterns: Handle both with and without "Phase" suffix
- Circular references: Not possible in this structure (parent → child only)

### Dependencies

- File system access (Read, Write tools)
- skills/ directory exists
- No other process modifying skill files during execution
