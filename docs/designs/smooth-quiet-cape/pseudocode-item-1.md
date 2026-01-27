# Pseudocode: Item 1 - Kodex Init Skill

## Skill Flow Overview

The skill instructs the agent to follow these steps:

---

## Step 1: Explore Codebase Structure

```
1. Get project root directory (current working directory)

2. List top-level directories
   - Exclude: node_modules, vendor, .git, dist, build, out, coverage, __pycache__
   - Exclude: hidden directories (starting with .)

3. For each directory, recursively explore (max depth 3)
   - Record: directory path, file count, file types present
   - Note: significant files (index.*, main.*, app.*, etc.)

4. Check for framework indicators:
   - package.json → Node.js/React/Vue
   - pubspec.yaml → Flutter/Dart
   - Cargo.toml → Rust
   - go.mod → Go
   - *.csproj → .NET
   - requirements.txt/pyproject.toml → Python

5. Check for infrastructure files:
   - Dockerfile, docker-compose.yml → deployment topic
   - .github/workflows/, .gitlab-ci.yml → ci-cd topic
   - jest.config.*, vitest.config.*, pytest.ini → testing topic
   - .env, config/ → configuration topic
```

---

## Step 2: Build Topic List

```
1. Initialize empty topic_candidates list

2. Map directories to topics:
   FOR each significant directory:
     IF directory has 3+ files OR contains index/main file:
       topic_name = kebab-case(directory_name)
       source_files = list files in directory
       ADD { name: topic_name, title: Title Case(directory_name), files: source_files }

3. Apply standard topic detection:
   IF Dockerfile OR docker-compose exists:
     ADD { name: "deployment", title: "Deployment", files: [Dockerfile, docker-compose.yml, ...] }

   IF .github/workflows/ OR CI config exists:
     ADD { name: "ci-cd", title: "CI/CD", files: [workflow files] }

   IF test directory OR test config exists:
     ADD { name: "testing", title: "Testing", files: [test files, config] }

   IF .env OR config/ exists:
     ADD { name: "configuration", title: "Configuration", files: [env files, config files] }

   IF migrations/ OR database/ OR ORM config exists:
     ADD { name: "database", title: "Database", files: [migration files, schema files] }

   IF auth/ OR authentication files exist:
     ADD { name: "authentication", title: "Authentication", files: [auth files] }

   IF routes/ OR controllers/ OR api/ exists:
     ADD { name: "api", title: "API", files: [route files] }

4. Merge small related topics:
   IF two topics have similar names AND combined < 10 files:
     MERGE into single topic

5. Split large topics:
   IF topic has > 20 files:
     CONSIDER splitting by subdirectory or function

6. Validate topic count:
   IF count < 5: WARN "Very few topics - codebase may be small"
   IF count > 30: WARN "Many topics - consider merging related areas"
```

---

## Step 3: Present for Approval

```
1. Format topic list for display:
   FOR each topic in topic_candidates:
     DISPLAY: "- {name}: {title} ({file_count} files)"

2. Ask user: "Here are the proposed topics. What would you like to do?"
   OPTIONS:
     1. Approve all
     2. Add a topic
     3. Remove a topic
     4. Edit a topic

3. Handle user response:
   IF "Approve all": PROCEED to Step 4
   IF "Add a topic":
     ASK for topic name and source paths
     ADD to topic_candidates
     RETURN to step 1 (re-display)
   IF "Remove a topic":
     ASK which topic to remove
     REMOVE from topic_candidates
     RETURN to step 1 (re-display)
   IF "Edit a topic":
     ASK which topic and what to change
     UPDATE topic_candidates
     RETURN to step 1 (re-display)
```

---

## Step 4: Create Topics

```
1. FOR each topic in approved_topics:

   a. Build stub content:
      conceptual = """
      # {topic.title}

      Topic pending documentation.

      ## Source Files
      {for each file in topic.files: "- {file}"}
      """

   b. Call MCP tool:
      mcp__plugin_mermaid-collab_mermaid__kodex_create_topic({
        project: cwd,
        name: topic.name,
        title: topic.title,
        content: {
          conceptual: conceptual,
          technical: "",
          files: "",
          related: ""
        }
      })

   c. Handle result:
      IF success: INCREMENT created_count
      IF error: LOG error, INCREMENT failed_count

2. Display summary:
   "Created {created_count} topics as drafts."
   IF failed_count > 0:
     "Failed to create {failed_count} topics. See errors above."

3. Remind user:
   "Topics are created as drafts. Use kodex_approve_draft to make them live."
```

---

## Error Handling

| Error | Handling |
|-------|----------|
| Directory read fails | Log warning, skip directory, continue |
| No significant directories found | Display warning, ask user for guidance |
| MCP tool call fails | Log error, continue with remaining topics |
| User cancels | Exit gracefully with no changes |

## Edge Cases

| Case | Handling |
|------|----------|
| Empty codebase | Report "No source files found" and exit |
| Monorepo with packages/ | Treat each package as potential topic area |
| Very deep nesting | Limit exploration to depth 3, note limitation |
| Non-standard structure | Rely more on standard topic detection |
