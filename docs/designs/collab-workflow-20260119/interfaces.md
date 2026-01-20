# Collab Workflow Interfaces

## Phase: INTERFACE ✅

This document defines the public contracts for all components in the collab workflow implementation.

---

## 1. State File Interface

**Location:** `.collab/{session}/collab-state.json`

```typescript
interface CollabState {
  // Core phase tracking
  phase: 'brainstorming' | 'implementation';
  subphase: BrainstormingSubphase | ImplementationSubphase;
  
  // Last action for context recovery
  lastAction: {
    type: 'phase_change' | 'subphase_change' | 'task_complete' | 'decision_made' | 'drift_accepted' | 'drift_rejected';
    details: string;
    timestamp: string; // ISO 8601
  };
  
  // Task tracking (implementation phase)
  tasks: Task[];
  completionLog: CompletionEntry[];
  
  // Checkpoints for rollback
  checkpoints: Checkpoint[];
  
  // Metadata
  sessionName: string;
  projectPath: string;
  lastUpdated: string; // ISO 8601
}

type BrainstormingSubphase = 'EXPLORING' | 'CLARIFYING' | 'DESIGNING' | 'VALIDATING';
type ImplementationSubphase = 'INTERFACE' | 'PSEUDOCODE' | 'SKELETON' | 'IMPLEMENTING';

interface Task {
  id: string;
  name: string;
  status: 'pending' | 'in_progress' | 'complete';
  dependsOn?: string[];  // Task IDs
  notes?: string;
}

interface CompletionEntry {
  task: string;  // Task ID
  completedAt: string;  // ISO 8601
  notes?: string;
}

interface Checkpoint {
  phase: CollabState['phase'];
  subphase: CollabState['subphase'];
  at: string;  // ISO 8601
}
```

---

## 2. Hook Interfaces

### 2.1 server-check hook

**Type:** PreToolUse  
**Trigger:** `mcp__mermaid__*`  
**Location:** `hooks/server-check.sh`

```bash
# Input: None (environment only)
# Environment:
#   MERMAID_PORT (optional, default: 3737)
#   PROJECT_ROOT (set by hook from script location)

# Output:
#   Exit 0: Server running, proceed with tool
#   Exit 1: Server failed to start, block tool

# Stderr: Status messages for user
#   "Starting mermaid-collab server..."
#   "Server ready on port 3737"
#   "ERROR: Server failed to start within 10s"
```

### 2.2 brainstorming-enforce hook

**Type:** PreToolUse  
**Trigger:** `Write`, `Edit`  
**Location:** `hooks/brainstorming-enforce.sh`

```bash
# Input (via environment):
#   TOOL_NAME: "Write" or "Edit"
#   TOOL_INPUT: JSON with file_path
#   COLLAB_SESSION_PATH: Path to .collab/{session}/ (set by /collab skill)

# Output:
#   Exit 0: Tool allowed (implementation phase OR file in .collab/)
#   Exit 1: Tool blocked (brainstorming phase, file outside .collab/)

# Stdout (on block): JSON feedback
{
  "result": "block",
  "reason": "Cannot edit files outside .collab/ during brainstorming phase",
  "suggestion": "Use /ready-to-implement to transition to implementation phase"
}
```

### 2.3 verify-phase hook

**Type:** Skill (invoked by rough-draft skill after each phase)  
**Location:** `skills/verify-phase.md`

```typescript
// Input: Current rough-draft phase output + design doc
interface VerifyPhaseInput {
  currentPhase: 'INTERFACE' | 'PSEUDOCODE' | 'SKELETON';
  phaseOutput: string;  // Content produced in this phase
  designDoc: string;    // Full design document content
}

// Output: Drift assessment
interface VerifyPhaseOutput {
  aligned: boolean;
  driftDetails?: {
    whatChanged: string[];
    prosOfAccepting: string[];
    consOfAccepting: string[];
    suggestion: string;
  };
  userChoice?: 'accept' | 'reject' | 'partial';
}
```

### 2.4 post-task-complete hook

**Type:** PostToolUse (or state-triggered)  
**Trigger:** State file task status → "complete"  
**Location:** `hooks/post-task-complete.sh`

```bash
# Input (via environment):
#   COMPLETED_TASK_ID: ID of the completed task
#   COLLAB_SESSION_PATH: Path to .collab/{session}/

# Actions:
#   1. Update task-graph diagram via MCP
#   2. Append to completionLog in state file
#   3. Output notification

# Output:
#   Exit 0: Success
#   Stdout: "✅ Task {id} complete. {n}/{total} tasks done."
```

### 2.5 sync-diagram-to-doc hook

**Type:** PostToolUse  
**Trigger:** `mcp__mermaid__create_diagram`, `mcp__mermaid__update_diagram`  
**Location:** `hooks/sync-diagram-to-doc.sh`

```bash
# Input (via environment):
#   TOOL_NAME: "mcp__mermaid__create_diagram" or "mcp__mermaid__update_diagram"
#   TOOL_OUTPUT: JSON response from MCP tool
#   COLLAB_SESSION_PATH: Path to .collab/{session}/

# Actions:
#   1. Parse diagram ID and content from tool output
#   2. Read current design doc
#   3. Find/create Diagrams section
#   4. Update diagram code block
#   5. Save design doc via MCP

# Output:
#   Exit 0: Success (silent)
#   Exit 1: Error (logged to stderr)
```

---

## 3. Skill Interfaces

### 3.1 /ready-to-implement

**Purpose:** Validate design completion and transition to implementation phase

```typescript
// Invocation: User calls /ready-to-implement

// Behavior:
// 1. Read design doc
// 2. Check all items have ✅ decisions
// 3. If incomplete: list missing items, return
// 4. If complete: ask user confirmation
// 5. On confirm: update state.phase to "implementation"

interface ReadyToImplementOutput {
  ready: boolean;
  missingDecisions?: string[];  // Items without ✅
  confirmed?: boolean;
}
```

### 3.2 /collab (enhanced for context-recovery)

**Purpose:** Session management with context recovery on resume

```typescript
// Existing behavior: list sessions, create/resume

// Enhanced resume flow:
interface ContextRecoverySummary {
  sessionName: string;
  phase: string;
  subphase: string;
  decisionsCount: number;
  openQuestionsCount: number;
  tasksComplete: number;
  tasksTotal: number;
  lastActivity: string;
}

// On session resume, skill MUST:
// 1. Set environment variable: COLLAB_SESSION_PATH
// 2. Output context recovery summary
// 3. Confirm continuation point with user

// Output format (to user):
// "## Session Resumed: {name}
//  **Phase:** {phase} ({subphase})
//  **Decisions:** {n} made
//  **Tasks:** {complete}/{total}
//  **Last:** {lastActivity}
//  Continue from {subphase}?"
```

---

## 4. Decisions Made

### 4.1 State Management: Direct File Access ✅

- Hooks read/write `.collab/{session}/collab-state.json` directly
- No new MCP tools needed
- Simple JSON file operations
- Can add MCP tools later if needed

### 4.2 Session Path Discovery ✅

**Primary:** Environment variable set by `/collab` skill
- When `/collab` starts/resumes: `export COLLAB_SESSION_PATH=/path/to/.collab/session-name`
- Hooks read `$COLLAB_SESSION_PATH`

**Fallback:** Scan for `.collab/` directory
- Look for `.collab/` starting from `$PWD`
- If single session, use it
- If multiple, use most recently modified

### 4.3 Verify-Phase Invocation ✅

**Manual skill call from rough-draft**
- Rough-draft skill calls `/verify-phase` after each phase completes
- Explicit invocation pattern:
  ```
  INTERFACE → /verify-phase → PSEUDOCODE → /verify-phase → SKELETON → /verify-phase
  ```
- Rough-draft handles the response (continue, accept drift, reject)

---

## 5. MCP Tool Usage

| Tool | Used By | Purpose |
|------|---------|---------|
| `mcp__mermaid__list_sessions` | /collab | Find existing sessions |
| `mcp__mermaid__list_diagrams` | context-recovery | Get all diagrams |
| `mcp__mermaid__get_diagram` | sync-diagram-to-doc | Read diagram content |
| `mcp__mermaid__create_diagram` | (trigger) | Creates diagram |
| `mcp__mermaid__update_diagram` | post-task-complete, sync | Updates diagram |
| `mcp__mermaid__get_document` | context-recovery, verify-phase | Read design doc |
| `mcp__mermaid__update_document` | sync-diagram-to-doc | Update design doc |

---

## 6. File Structure

```
.collab/
└── {session-name}/
    ├── collab-state.json      # State file (see interface above)
    ├── diagrams/
    │   ├── *.mmd              # Mermaid diagrams
    │   └── task-graph.mmd     # Special: task progress diagram
    └── documents/
        └── design.md          # Design document

hooks/
├── server-check.sh            # PreToolUse: mcp__mermaid__*
├── brainstorming-enforce.sh   # PreToolUse: Write, Edit
├── post-task-complete.sh      # PostToolUse/state-triggered
└── sync-diagram-to-doc.sh     # PostToolUse: diagram tools

skills/
├── collab.md                  # Enhanced with context-recovery
├── ready-to-implement.md      # New: exit gate skill
└── verify-phase.md            # New: drift detection skill
```

---

## 7. Claude Code Settings Schema

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "mcp__mermaid__*",
        "hooks": [
          {
            "type": "command",
            "command": "./hooks/server-check.sh",
            "timeout": 15,
            "statusMessage": "Checking mermaid-collab server..."
          }
        ]
      },
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "./hooks/brainstorming-enforce.sh",
            "timeout": 5,
            "statusMessage": "Checking phase permissions..."
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "mcp__mermaid__create_diagram|mcp__mermaid__update_diagram",
        "hooks": [
          {
            "type": "command",
            "command": "./hooks/sync-diagram-to-doc.sh",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

---

**Phase Status:** INTERFACE ✅ complete. Ready for PSEUDOCODE.
