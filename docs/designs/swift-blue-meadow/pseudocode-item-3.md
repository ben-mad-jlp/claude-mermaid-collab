# Pseudocode: Item 3 - Recreate README

## Process

```
1. AUDIT current codebase:
   a. List all skills (glob skills/**/SKILL.md)
   b. List all agents (glob agents/**/AGENT.md)
   c. List all MCP tools (read src/mcp/setup.ts)
   d. List all API endpoints (read src/routes/api.ts)

2. STRUCTURE new README:
   a. Title + one-line description
   b. Quick Start (3 steps: install, start server, use plugin)
   c. Core Workflow diagram
   d. Features overview
   e. MCP Tools reference table
   f. REST API reference
   g. Skills/Agents tables
   h. Architecture diagram
   i. Development section

3. WRITE each section:
   - Use current facts from codebase
   - Remove outdated references
   - Keep concise (aim for ~200 lines)

4. VERIFY:
   - All MCP tools documented
   - All endpoints documented
   - Installation steps work
   - No broken links
```

## N/A for Pseudocode

This is a documentation task - no function logic to describe.
The "pseudocode" above describes the writing process, not code logic.
