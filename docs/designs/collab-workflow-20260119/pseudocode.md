# Collab Workflow Pseudocode

## Phase: PSEUDOCODE

This document describes the logic flow for each component.

---

## 1. server-check.sh

```pseudocode
FUNCTION server_check():
    PORT = ENV.MERMAID_PORT or 3737
    MAX_WAIT = 10 seconds
    POLL_INTERVAL = 0.5 seconds
    
    # Get project root from script location
    SCRIPT_DIR = dirname(this_script)
    PROJECT_ROOT = dirname(SCRIPT_DIR)
    
    # Check if server is already running
    IF curl_succeeds("http://localhost:{PORT}"):
        EXIT 0  # Server running, proceed
    
    # Server not running, start it
    PRINT to stderr: "Starting mermaid-collab server..."
    
    # Start server in background
    cd PROJECT_ROOT
    RUN "bun run src/server.ts" in background
    
    # Poll until ready or timeout
    elapsed = 0
    WHILE elapsed < MAX_WAIT:
        IF curl_succeeds("http://localhost:{PORT}"):
            PRINT to stderr: "Server ready on port {PORT}"
            EXIT 0
        SLEEP POLL_INTERVAL
        elapsed += POLL_INTERVAL
    
    # Timeout
    PRINT to stderr: "ERROR: Server failed to start within {MAX_WAIT}s"
    EXIT 1
```

---

## 2. brainstorming-enforce.sh

```pseudocode
FUNCTION brainstorming_enforce():
    # Get inputs
    TOOL_INPUT = parse_json(ENV.TOOL_INPUT)
    file_path = TOOL_INPUT.file_path
    
    # Find session path
    SESSION_PATH = find_session_path()
    IF SESSION_PATH is null:
        EXIT 0  # No active collab session, allow all
    
    # Read state file
    state = read_json("{SESSION_PATH}/collab-state.json")
    
    # If implementation phase, allow everything
    IF state.phase == "implementation":
        EXIT 0
    
    # Brainstorming phase - check if file is in .collab/
    collab_dir = dirname(SESSION_PATH)  # .collab/
    
    IF file_path starts_with collab_dir:
        EXIT 0  # File is in .collab/, allow
    
    # Block edit outside .collab/
    OUTPUT json: {
        "result": "block",
        "reason": "Cannot edit files outside .collab/ during brainstorming phase",
        "suggestion": "Use /ready-to-implement to transition to implementation phase"
    }
    EXIT 1

FUNCTION find_session_path():
    # Primary: environment variable
    IF ENV.COLLAB_SESSION_PATH exists:
        RETURN ENV.COLLAB_SESSION_PATH
    
    # Fallback: scan for .collab/
    current = getcwd()
    WHILE current != "/":
        IF exists("{current}/.collab/"):
            sessions = list_directories("{current}/.collab/")
            IF sessions.length == 1:
                RETURN "{current}/.collab/{sessions[0]}"
            ELSE IF sessions.length > 1:
                # Return most recently modified
                RETURN most_recent_by_mtime(sessions)
        current = dirname(current)
    
    RETURN null
```

---

## 3. verify-phase (skill)

```pseudocode
SKILL verify_phase(current_phase, phase_output):
    # Read design doc from collab session
    SESSION_PATH = ENV.COLLAB_SESSION_PATH
    design_doc = mcp__mermaid__get_document(session, "design")
    
    # Use LLM to evaluate alignment
    prompt = """
    Compare the following {current_phase} output against the design document.
    
    Design Document:
    {design_doc.content}
    
    {current_phase} Output:
    {phase_output}
    
    Questions:
    1. Does this align with the design decisions?
    2. Are there any additions not in the original design?
    3. Are there any omissions from the design?
    
    If aligned, respond: ALIGNED
    If drift detected, respond with:
    DRIFT DETECTED
    What changed: [list]
    Pros: [list]
    Cons: [list]
    Suggestion: [recommendation]
    """
    
    llm_response = evaluate(prompt)
    
    IF llm_response starts_with "ALIGNED":
        OUTPUT "✓ {current_phase} phase aligned with design"
        RETURN { aligned: true }
    
    # Parse drift details
    drift = parse_drift_response(llm_response)
    
    OUTPUT """
    ⚠️ Drift detected in {current_phase} phase
    
    **What changed:**
    {drift.what_changed as bullet list}
    
    **Pros of accepting:**
    {drift.pros as bullet list}
    
    **Cons of accepting:**
    {drift.cons as bullet list}
    
    **Suggestion:** {drift.suggestion}
    """
    
    # Ask user
    choice = ASK_USER "Accept drift?", options: [
        "Accept - return to brainstorming to update design",
        "Reject - redo this phase",
        "Partial - specify what to keep"
    ]
    
    IF choice == "Accept":
        # Update state to brainstorming
        state = read_state(SESSION_PATH)
        state.phase = "brainstorming"
        state.lastAction = { type: "drift_accepted", details: drift.what_changed }
        write_state(SESSION_PATH, state)
        RETURN { aligned: false, userChoice: "accept" }
    
    ELSE IF choice == "Reject":
        RETURN { aligned: false, userChoice: "reject" }
    
    ELSE:
        partial_spec = ASK_USER "What to keep/discard?"
        RETURN { aligned: false, userChoice: "partial", spec: partial_spec }
```

---

## 4. post-task-complete.sh

```pseudocode
FUNCTION post_task_complete():
    # Get inputs
    TASK_ID = ENV.COMPLETED_TASK_ID
    SESSION_PATH = find_session_path()
    
    IF SESSION_PATH is null:
        EXIT 0  # No session, nothing to do
    
    # Read state
    state = read_json("{SESSION_PATH}/collab-state.json")
    
    # Find the task
    task = find_in(state.tasks, where: id == TASK_ID)
    IF task is null:
        EXIT 0  # Task not tracked
    
    # Update completion log
    state.completionLog.append({
        task: TASK_ID,
        completedAt: now_iso8601(),
        notes: task.notes
    })
    
    # Update lastAction
    state.lastAction = {
        type: "task_complete",
        details: "Completed task: {task.name}",
        timestamp: now_iso8601()
    }
    state.lastUpdated = now_iso8601()
    
    # Write state
    write_json("{SESSION_PATH}/collab-state.json", state)
    
    # Update task graph diagram
    update_task_graph(SESSION_PATH, state.tasks)
    
    # Output notification
    complete_count = count(state.tasks, where: status == "complete")
    total_count = state.tasks.length
    PRINT "✅ Task {TASK_ID} ({task.name}) complete. {complete_count}/{total_count} tasks done."
    
    EXIT 0

FUNCTION update_task_graph(session_path, tasks):
    # Generate mermaid diagram
    diagram = "flowchart LR\n"
    
    done_tasks = filter(tasks, status == "complete")
    in_progress_tasks = filter(tasks, status == "in_progress")
    pending_tasks = filter(tasks, status == "pending")
    
    diagram += "    subgraph Done\n"
    FOR task in done_tasks:
        diagram += "        {task.id}[{task.name}]:::done\n"
    diagram += "    end\n"
    
    diagram += "    subgraph In Progress\n"
    FOR task in in_progress_tasks:
        diagram += "        {task.id}[{task.name}]:::inprogress\n"
    diagram += "    end\n"
    
    diagram += "    subgraph Pending\n"
    FOR task in pending_tasks:
        diagram += "        {task.id}[{task.name}]:::pending\n"
    diagram += "    end\n"
    
    # Add dependency arrows
    FOR task in tasks:
        IF task.dependsOn:
            FOR dep in task.dependsOn:
                diagram += "    {dep} --> {task.id}\n"
    
    # Add styling
    diagram += """
    classDef done fill:#c8e6c9,stroke:#2e7d32
    classDef inprogress fill:#fff3e0,stroke:#f57c00
    classDef pending fill:#e0e0e0,stroke:#757575
    """
    
    # Update via MCP (need to call claude tool somehow, or write directly)
    # For now, write to file directly
    write_file("{session_path}/diagrams/task-graph.mmd", diagram)
```

---

## 5. sync-diagram-to-doc.sh

```pseudocode
FUNCTION sync_diagram_to_doc():
    # Parse tool output
    TOOL_OUTPUT = parse_json(ENV.TOOL_OUTPUT)
    diagram_id = TOOL_OUTPUT.id
    
    # Get session path
    SESSION_PATH = find_session_path()
    IF SESSION_PATH is null:
        EXIT 0  # No session
    
    # Read diagram content
    diagram_content = read_file("{SESSION_PATH}/diagrams/{diagram_id}.mmd")
    
    # Read design doc
    design_doc_path = "{SESSION_PATH}/documents/design.md"
    IF not exists(design_doc_path):
        # Create minimal doc
        design_doc = "# Design\n\n## Diagrams\n"
    ELSE:
        design_doc = read_file(design_doc_path)
    
    # Find or create Diagrams section
    IF "## Diagrams" not in design_doc:
        design_doc += "\n\n## Diagrams\n"
    
    # Find existing diagram entry or create new
    diagram_header = "### {diagram_id}"
    
    IF diagram_header in design_doc:
        # Replace existing
        design_doc = replace_section(
            design_doc,
            start: diagram_header,
            end: next_header_or_eof,
            replacement: """
### {diagram_id}
```mermaid
{diagram_content}
```
"""
        )
    ELSE:
        # Append to Diagrams section
        diagrams_section_end = find_next_h2_or_eof(design_doc, after: "## Diagrams")
        design_doc = insert_before(
            design_doc,
            position: diagrams_section_end,
            content: """
### {diagram_id}
```mermaid
{diagram_content}
```

"""
        )
    
    # Write updated doc
    write_file(design_doc_path, design_doc)
    
    EXIT 0
```

---

## 6. ready-to-implement (skill)

```pseudocode
SKILL ready_to_implement():
    # Find session
    SESSION_PATH = ENV.COLLAB_SESSION_PATH
    IF SESSION_PATH is null:
        SESSION_PATH = find_session_path()
    
    IF SESSION_PATH is null:
        OUTPUT "No active collab session. Use /collab first."
        RETURN
    
    # Read state
    state = read_json("{SESSION_PATH}/collab-state.json")
    
    # Already in implementation?
    IF state.phase == "implementation":
        OUTPUT "Already in implementation phase."
        RETURN
    
    # Read design doc
    design_doc = mcp__mermaid__get_document(session, "design")
    
    # Check for undecided items
    # Look for items in "Items to Discuss" that don't have ✅
    undecided = find_undecided_items(design_doc.content)
    
    IF undecided.length > 0:
        OUTPUT """
        ❌ Cannot transition to implementation. Undecided items:
        
        {undecided as bullet list}
        
        Please complete design decisions before implementing.
        """
        RETURN { ready: false, missingDecisions: undecided }
    
    # All decided, ask for confirmation
    confirmed = ASK_USER "Design complete. Ready to implement?", options: [
        "Yes, begin implementation",
        "No, continue brainstorming"
    ]
    
    IF confirmed == "Yes":
        # Update state
        state.phase = "implementation"
        state.subphase = "INTERFACE"
        state.lastAction = {
            type: "phase_change",
            details: "Transitioned to implementation",
            timestamp: now_iso8601()
        }
        state.checkpoints.append({
            phase: "brainstorming",
            subphase: "VALIDATING",
            at: now_iso8601()
        })
        state.lastUpdated = now_iso8601()
        write_json("{SESSION_PATH}/collab-state.json", state)
        
        OUTPUT "✅ Transitioned to implementation phase. Write/Edit tools now enabled."
        RETURN { ready: true, confirmed: true }
    ELSE:
        OUTPUT "Continuing brainstorming phase."
        RETURN { ready: true, confirmed: false }

FUNCTION find_undecided_items(doc_content):
    # Find "Items to Discuss" or "Items Still To Discuss" section
    items_section = extract_section(doc_content, "Items.*To Discuss")
    
    undecided = []
    FOR line in items_section.lines:
        # Look for numbered items without ~~strikethrough~~ or ✅
        IF line matches /^\d+\.\s+\*\*/ AND not contains "~~" AND not contains "✅":
            item_name = extract_item_name(line)
            undecided.append(item_name)
    
    RETURN undecided
```

---

## 7. collab (enhanced for context-recovery)

```pseudocode
SKILL collab():
    # Existing: list sessions, offer resume/new
    sessions = mcp__mermaid__list_sessions()
    
    IF sessions.length == 0:
        # Create new session
        session_name = generate_session_name()
        create_session(session_name)
        RETURN
    
    # Show sessions, ask resume or new
    choice = ASK_USER "Sessions found:", options: [
        FOR session in sessions: "Resume: {session.name}",
        "Create new session"
    ]
    
    IF choice == "Create new session":
        session_name = generate_session_name()
        create_session(session_name)
        RETURN
    
    # Resume existing session
    session_name = parse_session_name(choice)
    SESSION_PATH = "{project}/.collab/{session_name}"
    
    # Set environment for hooks
    ENV.COLLAB_SESSION_PATH = SESSION_PATH
    
    # Load state
    state = read_json("{SESSION_PATH}/collab-state.json")
    
    # Read design doc
    design_doc = mcp__mermaid__get_document(session_name, "design")
    
    # Count decisions and open items
    decisions_count = count_decided_items(design_doc.content)
    open_count = count_open_items(design_doc.content)
    
    # Count tasks
    tasks_complete = count(state.tasks, status == "complete")
    tasks_total = state.tasks.length
    
    # Format last activity
    IF state.completionLog.length > 0:
        last = state.completionLog[-1]
        last_activity = "Task {last.task} completed at {last.completedAt}"
    ELSE:
        last_activity = state.lastAction.details
    
    # Output context recovery summary
    OUTPUT """
    ## Session Resumed: {session_name}
    
    **Phase:** {state.phase} ({state.subphase})
    
    **Design Decisions:** {decisions_count} made, {open_count} open
    
    **Task Progress:** {tasks_complete}/{tasks_total} complete
    
    **Last Activity:** {last_activity}
    
    ---
    Continue from {state.subphase} phase?
    """
    
    # Confirm
    confirmed = ASK_USER "Continue?", options: ["Yes", "Start fresh"]
    
    IF confirmed == "Yes":
        # Proceed with current state
        RETURN
    ELSE:
        # Reset? Or just continue but let user direct?
        RETURN
```

---

## 8. State Save Integration

```pseudocode
# This is integrated into each hook that modifies state

FUNCTION save_state(session_path, state):
    # Update timestamp
    state.lastUpdated = now_iso8601()
    
    # Write atomically (write to temp, then rename)
    temp_path = "{session_path}/collab-state.json.tmp"
    final_path = "{session_path}/collab-state.json"
    
    write_json(temp_path, state)
    rename(temp_path, final_path)
    
    # Blocking - caller waits for completion
    RETURN true
```

---

**Phase Status:** PSEUDOCODE ✅ complete. Ready for SKELETON.
