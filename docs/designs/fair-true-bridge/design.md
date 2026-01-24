# Session: fair-true-bridge

## Session Context
**Project:** claude-mermaid-collab
**Goal:** Expand AI-UI component library and integrate with collab workflow
**Out of Scope:** Backend changes beyond MCP updates
**Shared Decisions:** (cross-cutting choices)

---

## Work Items

### Item 1: Build 10 new AI-UI components
**Type:** code
**Status:** documented
**Problem/Goal:** Add RadioGroup, Toggle, Image, Spinner, Badge, NumberInput, Slider, Divider, Link, FileUpload components

**Approach:**
Create each component following existing patterns in `ui/src/components/ai-ui/`:

| Component | Category | File | Key Props |
|-----------|----------|------|-----------|
| RadioGroup | inputs | `inputs/RadioGroup.tsx` | options, value, name, onChange, disabled |
| Toggle | inputs | `inputs/Toggle.tsx` | checked, name, label, onChange, disabled |
| Image | display | `display/Image.tsx` | src, alt, width, height, caption |
| Spinner | display | `display/Spinner.tsx` | size, label |
| Badge | display | `display/Badge.tsx` | text, variant (info/success/warning/error), size |
| NumberInput | inputs | `inputs/NumberInput.tsx` | value, min, max, step, name, onChange, disabled |
| Slider | inputs | `inputs/Slider.tsx` | value, min, max, step, name, onChange, disabled |
| Divider | layout | `layout/Divider.tsx` | orientation (horizontal/vertical), label |
| Link | interactive | `interactive/Link.tsx` | href, label, onClick, variant |
| FileUpload | inputs | `inputs/FileUpload.tsx` | accept, multiple, name, onChange, disabled |

**Success Criteria:**
- All 10 components created with TypeScript interfaces
- Each supports `disabled` prop for form integration
- Input components support `name` prop for form data collection
- Components follow existing styling patterns (Tailwind, dark mode)
- Components are accessible (aria labels, keyboard navigation)

**Decisions:**
- Follow existing component patterns for consistency
- All input components work in uncontrolled mode (internal state) for render_ui compatibility

---

### Item 2: Register components in registry
**Type:** code
**Status:** documented
**Problem/Goal:** Add all 10 new components to the ai-ui registry

**Approach:**
Update `ui/src/components/ai-ui/registry.ts`:
1. Import all 10 new components
2. Add entries to componentRegistry Map with metadata
3. Update component count in comments (22 → 32)

**Success Criteria:**
- All 10 components importable via `getComponent(name)`
- Category stats updated correctly
- No TypeScript errors

**Decisions:**
- Categories: inputs (RadioGroup, Toggle, NumberInput, Slider, FileUpload), display (Image, Spinner, Badge), layout (Divider), interactive (Link)

---

### Item 3: Update MCP render_ui documentation
**Type:** code
**Status:** documented
**Problem/Goal:** Update MCP to document all available components and their props

**Approach:**
Update `src/mcp/tools/render-ui.ts` (or equivalent):
1. Add component reference documentation
2. Document all 32 components with their props
3. Include usage examples for common patterns

**Success Criteria:**
- MCP tool description includes component reference
- Props documented for each component
- Examples show form collection pattern

**Decisions:**
- Keep documentation concise but complete

---

### Item 4: Create AI-UI usage skill
**Type:** code
**Status:** documented
**Problem/Goal:** Create a skill that teaches Claude how to use the AI-UI components effectively

**Approach:**
Create `skills/using-ai-ui/SKILL.md`:
1. Overview of render_ui tool and blocking mode
2. Component reference by category
3. Best practices for component selection
4. Form data collection patterns
5. Example UI compositions

**Success Criteria:**
- Skill invocable via /using-ai-ui
- Covers all 32 components
- Includes decision tree for component selection
- Shows form collection examples

**Decisions:**
- Focus on practical guidance, not exhaustive API docs

---

### Item 5: Update collab to recommend AI-UI
**Type:** code
**Status:** documented
**Problem/Goal:** Update collab workflow to recommend using AI-UI components for user interactions

**Approach:**
Update relevant skills to prefer render_ui over terminal prompts:
1. `skills/brainstorming/` - Use render_ui for multiple choice questions
2. `skills/ready-to-implement/` - Already has render_ui examples, ensure consistent
3. `skills/gather-session-goals/` - Use render_ui for work item confirmation
4. Add "Browser-Based Questions" section to skills that need it

**Success Criteria:**
- Collab skills prefer render_ui when session is active
- Consistent pattern across all skills
- Falls back to terminal when no session

**Decisions:**
- Only use render_ui within active collab sessions
- Keep terminal fallback for standalone usage

---

## Diagrams
(auto-synced)