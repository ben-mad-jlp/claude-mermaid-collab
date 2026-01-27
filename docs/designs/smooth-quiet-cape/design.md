# Session: smooth-quiet-cape

## Session Context
**Out of Scope:** (session-wide boundaries)
**Shared Decisions:** (cross-cutting choices)

---

## Work Items

### Item 1: Create Kodex initialization skill
**Type:** code
**Status:** documented
**Problem/Goal:**
Create a skill that helps bootstrap a Kodex knowledge base by analyzing a codebase and creating topics. The skill guides an agent to explore the codebase structure, identify logical topic boundaries, and create stub topics via MCP.

**Approach:**

**Step 1: Explore codebase structure**
- Walk directory tree (excluding node_modules, vendor, build, .git)
- Identify feature folders, service boundaries, subsystems
- Check config files (Dockerfile, CI, package.json) for infrastructure hints
- Detect framework patterns (React: src/components; Flutter: lib/screens; etc.)

**Step 2: Build topic list**
- Map significant directories to topic candidates
- Apply standard topics when indicators present (deployment, testing, api, etc.)
- Merge small related folders into single topics
- Split large complex areas into multiple topics
- Target 10-30 topics total

**Step 3: Present topics for user approval**
- Display proposed topic list with source files
- Allow user to add, remove, or modify topics
- Confirm before proceeding

**Step 4: Create topics via MCP**
- For each approved topic, call `kodex_create_topic`
- Use stub format for conceptual document
- Leave technical, files, related empty
- Report summary when complete

**Success Criteria:**
- Skill creates 10-30 meaningful topics based on codebase structure
- Topics use stub format (minimal conceptual doc with source files listed)
- Excludes node_modules, vendor, build output
- Standard topics (deployment, testing, api, etc.) created when relevant

**Decisions:**
- Location: `skills/kodex-init/SKILL.md`
- User-invocable: yes (via `/kodex-init`)
- MCP tool: `mcp__plugin_mermaid-collab_mermaid__kodex_create_topic`

---

## Diagrams
(auto-synced)