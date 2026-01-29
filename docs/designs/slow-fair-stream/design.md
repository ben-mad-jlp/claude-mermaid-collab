# Session: slow-fair-stream

## Session Context
**Out of Scope:** (session-wide boundaries)
**Shared Decisions:** (cross-cutting choices)

---

## Work Items

### Item 1: Dark mode broken for task execution colors graph
**Type:** bugfix
**Status:** documented

**Problem/Goal:**
- Dark mode: All task nodes appear the same blue color regardless of status
- Light mode: Text lacks sufficient contrast for readability

**Root Cause:**
1. **Dark mode:** CSS in `ui/src/styles/diagram.css` (lines 22-31) uses `!important` to force all node fills to blue (`#2d5a8c`), overriding the `classDef` styles from `task-diagram.ts`
2. **Light mode:** The `color` property in Mermaid `classDef` may not override Mermaid's default theme text colors

**Approach:**
1. Modify `diagram.css` to either:
   - Remove `!important` from node fill/stroke rules (let classDef take precedence)
   - OR use `:not()` selector to exclude nodes with status classes
2. Add explicit CSS rules for light mode text colors on status nodes

**Success Criteria:**
- Dark mode shows correct status colors: pending=gray, in_progress=yellow, completed=green, failed=red
- Light mode text has WCAG AA contrast (4.5:1 minimum)
- Status colors update dynamically as tasks change state

**Files to Modify:**
- `ui/src/styles/diagram.css` - Remove/modify blanket `!important` node styling
- `src/mcp/workflow/task-diagram.ts` - (Optional) Adjust colors if needed

**Decisions:**

---

### Item 2: Core alias infrastructure for Kodex
**Type:** code
**Status:** documented

**Problem/Goal:**
Topics can only be found by exact name match. Querying "auth" won't find "authentication".

**Approach:**
1. Add `aliases TEXT` column to topics table (JSON array)
2. Update `getTopic()` to check aliases if exact name not found
3. Add MCP tools: `kodex_add_alias`, `kodex_remove_alias`
4. Return topic + hint when found via alias

**Success Criteria:**
- Query "auth" finds "authentication" topic
- Response indicates it was found via alias with canonical name
- Aliases manageable via MCP tools

**Decisions:**
- Storage: SQLite metadata column (JSON array)
- Query behavior: Return topic + hint (shows canonical name)

---

#### Design Section 1: Schema Changes

Add `aliases` column to the topics table in `kodex-manager.ts`:

```sql
ALTER TABLE topics ADD COLUMN aliases TEXT DEFAULT '[]';
```

The column stores a JSON array of strings. Example value: `["auth", "login", "signin"]`.

**Migration strategy:** SQLite's `ALTER TABLE ADD COLUMN` adds the column with default value to existing rows. No data migration needed.

**Type updates in `kodex-manager.ts`:**
```typescript
export interface TopicMetadata {
  // ... existing fields
  aliases: string[];  // Add this
}
```

**Row conversion:** Update `rowToTopicMetadata()` to parse the JSON:
```typescript
aliases: row.aliases ? JSON.parse(row.aliases) : []
```

---

#### Design Section 2: Query Logic

Update `getTopic()` in `kodex-manager.ts` to check aliases when exact name not found:

```typescript
async getTopic(name: string, includeContent = true): Promise<TopicWithMatch | null> {
  const db = this.ensureInitialized();
  
  // 1. Try exact match first
  let row = db.query('SELECT * FROM topics WHERE name = ?').get(name) as any;
  let matchedVia: 'name' | 'alias' = 'name';
  
  // 2. If not found, check aliases
  if (!row) {
    row = db.query(
      "SELECT * FROM topics WHERE aliases LIKE '%\"' || ? || '\"%'"
    ).get(name) as any;
    matchedVia = 'alias';
  }
  
  // 3. If still not found, log missing
  if (!row) {
    await this.logMissing(name, 'getTopic');
    return null;
  }
  
  // 4. Return with match info
  return {
    ...topic,
    matchedVia,
    queriedName: matchedVia === 'alias' ? name : undefined,
  };
}
```

**Response structure:** When found via alias, include hint fields so Claude learns the canonical name.

---

#### Design Section 3: MCP Tools

Add two new MCP tools in `setup.ts`:

**kodex_add_alias:**
```typescript
{
  name: 'kodex_add_alias',
  description: 'Add an alias to a Kodex topic',
  inputSchema: {
    type: 'object',
    properties: {
      project: { type: 'string', description: 'Absolute path to project root' },
      name: { type: 'string', description: 'Topic name (canonical)' },
      alias: { type: 'string', description: 'Alias to add' }
    },
    required: ['project', 'name', 'alias']
  }
}
```

**kodex_remove_alias:**
```typescript
{
  name: 'kodex_remove_alias',
  description: 'Remove an alias from a Kodex topic',
  inputSchema: {
    type: 'object',
    properties: {
      project: { type: 'string', description: 'Absolute path to project root' },
      name: { type: 'string', description: 'Topic name (canonical)' },
      alias: { type: 'string', description: 'Alias to remove' }
    },
    required: ['project', 'name', 'alias']
  }
}
```

**KodexManager methods:** Add `addAlias(name, alias)` and `removeAlias(name, alias)` that update the JSON array in the database.

---

### Item 2a: UI for Kodex alias management
**Type:** code
**Status:** documented

**Problem/Goal:**
Users need a UI to view and manage topic aliases in the Kodex dashboard.

**Approach:**
1. Display aliases in header area (near title/name)
2. Inline editing: click alias chip to remove, input field to add
3. Show alias indicator in topic list

**Success Criteria:**
- Aliases visible in topic detail header
- Can add/remove aliases inline
- Topic list shows alias count or indicator

**Decisions:**
- Placement: Header area (near title/name)
- Editing: Inline (click to remove, input to add)
- Part of existing Kodex dashboard (not separate page)

---

#### Design Section 1: UI Components

**AliasChip component** (`ui/src/components/kodex/AliasChip.tsx`):
```tsx
interface AliasChipProps {
  alias: string;
  onRemove?: () => void;  // If provided, shows × button
}
```
- Displays alias text with × button
- Click × calls `onRemove` callback
- Styled like existing badges (gray background, rounded)

**AliasEditor component** (`ui/src/components/kodex/AliasEditor.tsx`):
```tsx
interface AliasEditorProps {
  aliases: string[];
  onAdd: (alias: string) => Promise<void>;
  onRemove: (alias: string) => Promise<void>;
}
```
- Renders list of AliasChip components
- Shows "+ Add" button that expands to input field
- Input field: Enter to submit, Escape to cancel
- Handles loading/error states for add/remove operations

**Integration in TopicDetail.tsx:**
- Add AliasEditor below topic name in header
- Pass topic.aliases and handlers for add/remove
- Update API client with `addAlias` and `removeAlias` methods

---

### Item 2b: Alias generation skill
**Type:** code
**Status:** documented

**Problem/Goal:**
Manual alias creation is tedious. Need automated alias generation.

**Approach:**
1. Create `/kodex-generate-aliases` skill for manual invocation
2. Hook into `kodex_create_topic` for auto-generation on creation
3. Use four alias sources:
   - Topic title keywords
   - Common synonyms (hardcoded map)
   - Keywords from topic content
   - Abbreviations (auto-shorten)

**Success Criteria:**
- Aliases auto-generated on topic creation
- Manual skill generates aliases for existing topics
- Generated aliases are relevant and useful

**Decisions:**
- Trigger: Auto on creation + manual skill available
- Sources: All four (title, synonyms, content, abbreviations)

---

#### Design Section 1: Alias Generator Module

Create `src/services/alias-generator.ts` with the core generation logic:

```typescript
// Synonym map for common term variations
const SYNONYMS: Record<string, string[]> = {
  'auth': ['authentication', 'login', 'signin'],
  'ui': ['interface', 'frontend', 'gui'],
  'api': ['endpoints', 'routes', 'rest'],
  'db': ['database', 'storage', 'data'],
  'config': ['configuration', 'settings', 'options'],
};

// Abbreviation rules (long → short)
const ABBREVIATIONS: Record<string, string> = {
  'authentication': 'auth',
  'configuration': 'config',
  'development': 'dev',
  'application': 'app',
  'documentation': 'docs',
};

export function generateAliases(
  name: string,
  title: string,
  content?: TopicContent
): string[] {
  const aliases = new Set<string>();
  
  // 1. Title keywords (split on spaces, lowercase)
  title.toLowerCase().split(/\s+/).forEach(word => {
    if (word.length > 2) aliases.add(word);
  });
  
  // 2. Synonyms lookup
  for (const [key, synonyms] of Object.entries(SYNONYMS)) {
    if (aliases.has(key) || name.includes(key)) {
      synonyms.forEach(s => aliases.add(s));
    }
  }
  
  // 3. Abbreviations
  for (const [long, short] of Object.entries(ABBREVIATIONS)) {
    if (aliases.has(long)) aliases.add(short);
    if (aliases.has(short)) aliases.add(long);
  }
  
  // 4. Content keywords (optional, top 5 frequent terms)
  // ... extract from conceptual/technical sections
  
  // Remove the canonical name itself
  aliases.delete(name);
  
  return Array.from(aliases).slice(0, 10); // Max 10 aliases
}
```

---

### Item 3: Add graph visualization for Kodex topic connections
**Type:** code
**Status:** documented

**Problem/Goal:**
Topic relationships are stored as markdown text in the `related` field but there's no visual way to see the connection graph between topics. Users must click through topics one by one to understand the knowledge structure.

**Approach:**
Use Mermaid to render a force-directed graph showing topic connections:
1. Add new Graph page accessible from Kodex sidebar
2. Fetch all topics with content, parse `related` fields to extract edges
3. Generate Mermaid flowchart syntax from nodes/edges
4. Render with click-to-navigate to topic detail
5. Only show topics that have relationships (no orphan nodes)

**Success Criteria:**
- New "Graph" link in Kodex sidebar
- Graph shows topics as nodes, relationships as edges
- Clicking a node navigates to that topic's detail page
- Only topics with ≥1 relationship appear in graph

**Decisions:**
- Library: Mermaid (already in project, simpler than ReactFlow)
- Location: New page at /kodex/graph
- Scope: Connected topics only (no orphans)
- Interaction: Click node → navigate to topic detail

---

#### Design Section 1: Parsing Related Topics

The `related` field contains markdown like:
```markdown
## Related Topics
- `mcp-server` - MCP tools for Kodex operations
- `services` - KodexManager service
```

Create a utility function to extract topic names:

```typescript
// ui/src/lib/graph-utils.ts

export interface GraphEdge {
  source: string;  // topic name
  target: string;  // related topic name
}

export function parseRelatedTopics(related: string): string[] {
  // Match backtick-wrapped topic names: `topic-name`
  const matches = related.match(/`([a-z0-9-]+)`/g) || [];
  return matches.map(m => m.replace(/`/g, ''));
}

export function buildGraphEdges(
  topics: Array<{ name: string; related: string }>
): GraphEdge[] {
  const edges: GraphEdge[] = [];
  
  for (const topic of topics) {
    const relatedNames = parseRelatedTopics(topic.related);
    for (const target of relatedNames) {
      edges.push({ source: topic.name, target });
    }
  }
  
  return edges;
}
```

**Edge direction:** Source → Target (topic references another topic)

---

#### Design Section 2: Mermaid Graph Generation

Generate Mermaid flowchart syntax from the graph data:

```typescript
// ui/src/lib/graph-utils.ts (continued)

export function generateMermaidGraph(
  edges: GraphEdge[],
  topics: Map<string, { title: string; name: string }>
): string {
  // Collect unique nodes that have connections
  const connectedNodes = new Set<string>();
  for (const edge of edges) {
    connectedNodes.add(edge.source);
    connectedNodes.add(edge.target);
  }
  
  // Build Mermaid syntax
  const lines: string[] = ['graph LR'];
  
  // Define nodes with titles
  for (const name of connectedNodes) {
    const topic = topics.get(name);
    const label = topic?.title || name;
    lines.push(`    ${name}["${label}"]`);
  }
  
  // Define edges
  for (const edge of edges) {
    lines.push(`    ${edge.source} --> ${edge.target}`);
  }
  
  return lines.join('\n');
}
```

**Graph direction:** Left-to-right (`graph LR`) for better readability with topic names.

---

#### Design Section 3: Graph Page Component

Create `ui/src/pages/kodex/Graph.tsx`:

```typescript
export const Graph: React.FC = () => {
  const [mermaidSrc, setMermaidSrc] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const selectedProject = useKodexStore((s) => s.selectedProject);

  useEffect(() => {
    if (!selectedProject) return;
    
    const loadGraph = async () => {
      // 1. Fetch all topics with content
      const topics = await kodexApi.listTopicsWithContent(selectedProject);
      
      // 2. Build edges from related fields
      const topicData = topics.map(t => ({
        name: t.name,
        related: t.content?.related || ''
      }));
      const edges = buildGraphEdges(topicData);
      
      // 3. Generate Mermaid
      const topicMap = new Map(topics.map(t => [t.name, t]));
      const src = generateMermaidGraph(edges, topicMap);
      
      setMermaidSrc(src);
      setLoading(false);
    };
    
    loadGraph();
  }, [selectedProject]);

  // Handle node clicks
  const handleNodeClick = (nodeId: string) => {
    navigate(`/kodex/topics/${nodeId}`);
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Topic Graph</h1>
      {loading ? <Spinner /> : (
        <MermaidDiagram 
          content={mermaidSrc} 
          onNodeClick={handleNodeClick}
        />
      )}
    </div>
  );
};
```

**Key features:**
- Uses existing Mermaid rendering infrastructure
- Click handler navigates to topic detail
- Shows loading state while fetching

---

#### Design Section 4: Integration

**1. Sidebar update** (`ui/src/components/kodex/KodexSidebar.tsx`):

Add new nav item after "Flags":
```typescript
{
  path: '/kodex/graph',
  label: 'Graph',
  icon: (/* network/graph icon SVG */)
}
```

**2. Route update** (`ui/src/App.tsx`):

Add route inside Kodex layout:
```typescript
<Route path="graph" element={<Graph />} />
```

**3. API update** (`ui/src/lib/kodex-api.ts`):

Add method to fetch topics with content:
```typescript
async listTopicsWithContent(project: string): Promise<Topic[]> {
  const response = await fetch(
    buildUrl('/topics?includeContent=true', project)
  );
  if (!response.ok) throw new Error('Failed to list topics');
  return response.json();
}
```

**4. Backend update** (`src/routes/kodex-api.ts`):

Update `/topics` endpoint to accept `includeContent` query param and return full topic content when true.

---

### Item 4: Brainstorming questions not using render_ui
**Type:** bugfix
**Status:** documented

**Problem/Goal:**
During collab sessions, some brainstorming skills ask questions in the terminal instead of using render_ui to show them in the browser.

**Root Cause:**
Inconsistent `render_ui` documentation across brainstorming skills:
- `brainstorming-clarifying` and `brainstorming-validating` HAVE "Browser-Based Questions" sections
- `brainstorming-exploring` and `brainstorming-designing` are MISSING these sections

Without explicit render_ui instructions, Claude defaults to using `AskUserQuestion` in the terminal.

**Approach:**
Add "Browser-Based Questions" or "Browser-Based Validation" section to affected skills:
1. `skills/brainstorming-designing/SKILL.md` - Add section for Accept/Reject/Edit validation
2. `skills/brainstorming-exploring/SKILL.md` - Review if questions needed; if yes, add section

**Success Criteria:**
- All brainstorming skills with user interaction points have explicit render_ui documentation
- When a collab session is active, questions appear in browser UI (not terminal)
- Consistent pattern across all collab workflow skills

**Files to Modify:**
- `skills/brainstorming-designing/SKILL.md`
- `skills/brainstorming-exploring/SKILL.md` (if needed)

**Decisions:**
- Follow pattern from `brainstorming-clarifying` for render_ui documentation

---

### Item 5: rough-draft-confirm skill doesn't call complete_skill
**Type:** bugfix
**Status:** documented

**Problem/Goal:**
The rough-draft-confirm skill doesn't properly integrate with the collab workflow state machine because its complete_skill section is structured differently from other skills.

**Root Cause:**
1. **Section naming inconsistency**: Uses `## Step 4: Complete Skill` instead of standard `## Completion`
2. **Section positioning**: The complete_skill call is in the MIDDLE of the document (line 87), with Edge Cases and Notes sections after it
3. **Edge case ambiguity**: Edge Cases section says "Then complete the skill" without including actual tool call syntax

**Approach:**
1. Rename `## Step 4: Complete Skill` to `## Completion` for consistency
2. Move the Completion section to the END of the document (after Notes)
3. In Edge Cases section, add explicit `complete_skill` tool call syntax

**Success Criteria:**
- Skill has `## Completion` section (not `## Step 4: Complete Skill`)
- `## Completion` section is the last H2 section in the document
- Edge case handling includes explicit complete_skill tool call
- Workflow correctly transitions to next skill

**Files to Modify:**
- `skills/rough-draft-confirm/SKILL.md`

**Decisions:**
- Follow pattern from other skills (brainstorming-clarifying, brainstorming-validating)

---

## Diagrams
(auto-synced)