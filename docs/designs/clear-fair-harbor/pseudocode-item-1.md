# Pseudocode: Item 1 - Kodex Fix Skills

## Parent Skill: kodex-fix

### Main Flow

```
1. List open flags
   - Call kodex_list_flags with status filter
   - If no open flags:
     - Display: "No open flags to fix."
     - EXIT

2. Present flags to user
   - For each flag, show:
     - Topic name
     - Flag type (outdated/incorrect/incomplete/missing)
     - Description
   - Ask user: "Which flag do you want to fix?"

3. Route to sub-skill based on flag type
   - If type == "outdated": Invoke kodex-fix-outdated
   - If type == "incorrect": Invoke kodex-fix-incorrect
   - If type == "incomplete": Invoke kodex-fix-incomplete
   - If type == "missing": Invoke kodex-fix-missing
   - Pass: topic name, flag ID, flag description

4. After sub-skill returns
   - Display: "Draft created for [topic]. Review in Kodex UI to approve."
   - Ask: "Fix another flag?"
   - If yes: Go to step 1
   - If no: EXIT
```

**Error Handling:**
- MCP tool failure: Display error message, suggest retry
- No flags found: Graceful exit with informative message

**Edge Cases:**
- Multiple flags for same topic: List all, user picks one at a time
- Flag resolved while viewing: Refresh list before routing

---

## Sub-Skill: kodex-fix-outdated

### Main Flow

```
1. Get existing topic
   - Call kodex_query_topic(topic_name)
   - Extract current content (conceptual, technical, files, related)
   - Extract file paths from 'files' section

2. Analyze codebase
   - For each file in files section:
     - If file exists: Read contents
     - If file missing: Note as potential issue
   - Use Grep to find references to topic's key concepts
   - Build understanding of current implementation

3. Compare old vs new
   - Identify what changed since topic was written
   - Note outdated terminology, moved files, changed APIs

4. Generate updated content
   - conceptual: Update overview based on current state
   - technical: Update implementation details
   - files: Update file list (add new, remove deleted)
   - related: Check if related topics still exist

5. Validate with user
   - Present each section:
     - "Here's the updated [section]. Does this look accurate?"
   - Allow corrections

6. Create draft
   - Call kodex_update_topic with new content
   - Return to parent skill
```

**Error Handling:**
- Topic not found: Report error, suggest using kodex-fix-missing instead
- Files not readable: Skip and note in content
- User rejects content: Ask for specific corrections, regenerate

**Edge Cases:**
- Topic has no files section: Use topic name to search codebase
- All referenced files deleted: Flag topic for potential deletion

---

## Sub-Skill: kodex-fix-incorrect

### Main Flow

```
1. Get existing topic
   - Call kodex_query_topic(topic_name)
   - Read flag description to understand what's wrong

2. Verify the inaccuracy
   - Read files mentioned in topic
   - Compare claimed behavior vs actual code
   - Identify specific incorrect statements

3. Research correct information
   - Use Grep to find actual implementations
   - Read relevant source files
   - Build accurate understanding

4. Generate corrected content
   - Focus on fixing the specific inaccuracies
   - Keep accurate parts unchanged
   - Update sections affected by the correction

5. Validate with user
   - Show diff of old vs new (conceptually)
   - "The flag said: [description]. I found: [actual]. Corrected?"

6. Create draft
   - Call kodex_update_topic with corrected content
   - Return to parent skill
```

**Error Handling:**
- Can't verify inaccuracy: Ask user for clarification
- Multiple inaccuracies found: Fix all, list each correction

**Edge Cases:**
- Inaccuracy is in related topic: Note but don't fix (flag separately)
- Topic is entirely wrong: Consider full rewrite vs targeted fix

---

## Sub-Skill: kodex-fix-incomplete

### Main Flow

```
1. Get existing topic
   - Call kodex_query_topic(topic_name)
   - Identify which sections are empty or sparse

2. Analyze what's missing
   - Empty conceptual: Need high-level overview
   - Empty technical: Need implementation details
   - Empty files: Need to identify related files
   - Empty related: Need to find related topics

3. Gather information for missing sections
   - For each empty section:
     - Research codebase to fill the gap
     - conceptual: Read README, comments, main entry points
     - technical: Analyze implementation patterns
     - files: Use Glob to find related files
     - related: Check kodex_list_topics for related names

4. Generate content for missing sections
   - Only fill empty/sparse sections
   - Preserve existing content

5. Validate with user
   - "I added content for [section]. Does this look right?"

6. Create draft
   - Call kodex_update_topic with completed content
   - Return to parent skill
```

**Error Handling:**
- Can't find info for section: Create minimal placeholder, note limitation
- User rejects: Ask what's missing, try again

**Edge Cases:**
- All sections empty: Similar to kodex-fix-missing flow
- Only 'related' empty: Can auto-generate from topic name keywords

---

## Sub-Skill: kodex-fix-missing

### Main Flow

```
1. Get topic name from flag
   - Topic doesn't exist yet
   - Flag description may have hints about what it should cover

2. Research the topic
   - Search codebase for files/concepts matching topic name
   - Use Glob: Find files with topic name in path
   - Use Grep: Find references to topic keywords
   - Read: Examine found files to understand the component

3. Identify topic scope
   - Which files belong to this topic?
   - What is the main purpose?
   - How does it relate to other components?

4. Generate all 4 sections
   - conceptual: High-level description of what this is
   - technical: Implementation details, patterns, gotchas
   - files: List of related source files
   - related: Links to other Kodex topics

5. Validate with user
   - Present full topic draft
   - "Here's the new topic. Does this accurately describe [name]?"

6. Create draft
   - Call kodex_create_topic (NOT update)
   - Return to parent skill
```

**Error Handling:**
- No matching files found: Ask user for guidance on what topic should cover
- Ambiguous scope: Present options, let user choose

**Edge Cases:**
- Topic name too generic: Ask user for clarification
- Topic overlaps existing: Suggest merging or splitting

---

## TypeScript: approveDraft() Modification

### Modified Logic

```
FUNCTION approveDraft(topicName):
  // Existing logic (lines 363-394)
  1. Get draft directory path
  2. Ensure live directory exists
  3. Move draft files to live
  4. Remove draft directory
  5. Update database: has_draft = 0

  // NEW: Auto-resolve flags
  6. Query open flags for this topic:
     SELECT id FROM flags
     WHERE topic_name = topicName AND status = 'open'

  7. For each open flag:
     Call updateFlagStatus(flag.id, 'resolved')

  8. Return topic (existing behavior)
```

**Error Handling:**
- Flag update fails: Log warning but don't fail the approval
- No flags to resolve: Normal case, continue silently

**Edge Cases:**
- Multiple open flags for same topic: Resolve all
- Flag was dismissed while draft pending: Don't change dismissed flags

---

## Verification Checklist

- [x] Every component has pseudocode (parent + 4 sub-skills + TS mod)
- [x] Error handling explicit for each function
- [x] Edge cases identified
- [x] External dependencies noted (MCP tools, codebase analysis)
