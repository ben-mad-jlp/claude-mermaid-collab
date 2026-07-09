# Claude Code Instructions for mermaid-collab

## Versioning

**Always use npm version for version updates:**

```bash
npm version patch   # 5.19.0 → 5.19.1 (bug fixes)
npm version minor   # 5.19.0 → 5.20.0 (new features)
npm version major   # 5.19.0 → 6.0.0 (breaking changes)
```

This automatically:
1. Updates `package.json`
2. Syncs version to `.claude-plugin/plugin.json` (via version hook)
3. Syncs version to `.claude-plugin/marketplace.json` (via version hook)
4. Syncs version to `src/mcp/server.ts` SERVER_VERSION const (via version hook)
5. Creates a git commit and tag

After running `npm version`, push with:
```bash
git push && git push --tags
```

**Never manually edit version numbers** in package.json, plugin.json, marketplace.json, or server.ts.

## Testing

Use `test:ci` for non-interactive test runs (exits after completion):
```bash
npm run test:ci           # Run all UI tests
npm run test:ci -- path   # Run specific test file
```

Use `test` for interactive watch mode during development.

## Project Structure

- `src/` - Backend server and MCP
- `ui/` - React frontend
- `bin/` - CLI entrypoint (server start/stop/status)
- `skills/` - Claude Code skill definitions
- `.claude-plugin/` - Plugin configuration

## Lessons → shipped surfaces

A lesson that lives only in a conductor's memory dir has **not shipped**. Memory is
per-user and per-project; it reaches no other collab user. When you learn a rule, put it
where it travels:

- **`src/`** — anything that can be *enforced*. This is the strongest surface: enforced, not
asked. If code can check it, code must (a prohibition in a prompt is not a constraint).
- **`src/services/leaf-executor.ts` node prompts** (`buildNodePrompt` / `buildReviewPrompt` /
`buildVerifyPrompt`) — shipped strings every leaf on every project reads.
- **`skills/*/SKILL.md`** — ships with the plugin. The durable home for **judgment** that
cannot be enforced in code: what to check, what counts as a finding, when to hold.
- **`CLAUDE.md`, `.collab/*.db`, memory files** — this repo / this machine only. Do not treat
any of them as a delivery mechanism.

Distil the **rule**, never the incident log.
