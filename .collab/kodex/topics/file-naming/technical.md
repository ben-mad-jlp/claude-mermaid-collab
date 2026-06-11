## Backend Files (`/src/`)

**kebab-case for all TypeScript files:**
- Services: `diagram-manager.ts`, `session-registry.ts`, `kodex-manager.ts`
- Routes: `api.ts`, `websocket.ts`, `kodex-api.ts`
- Utilities: `file-watcher.ts`, `http-handler.ts`
- Workflow: `state-machine.ts`, `complete-skill.ts`

## React Components (`/ui/src/`)

**PascalCase for component files:**
- Display: `CodeBlock.tsx`, `DiffView.tsx`, `JsonViewer.tsx`
- Layout: `Card.tsx`, `Section.tsx`, `Accordion.tsx`
- Interactive: `Tabs.tsx`, `Wizard.tsx`, `ProgressBar.tsx`
- Input: `TextInput.tsx`, `RadioGroup.tsx`, `Slider.tsx`

**kebab-case for directories:**
- `/ui/src/components/ai-ui/`
- `/ui/src/components/chat-drawer/`
- `/ui/src/components/question-panel/`

## Test Files

**Suffix patterns:**
- Unit tests: `CodeBlock.test.tsx`, `api.test.ts`
- Integration: `Dropdown.integration.test.tsx`
- Renderer: `Dropdown.renderer.test.tsx`

**Directory pattern:**
- `__tests__/` subdirectories for organized suites

## Skills

**kebab-case directories:**
- `/skills/test-driven-development/`
- `/skills/brainstorming-exploring/`
- `/skills/kodex-fix-outdated/`

**UPPERCASE skill files:**
- `SKILL.md` - Main definition
- `SKILL.test.ts` - Tests (where applicable)

## Config Files

- camelCase JSON: `package.json`, `tsconfig.json`
- Dotfiles: `.eslintrc.cjs`, `.mcp.json`
- UPPERCASE docs: `README.md`, `CLAUDE.md`