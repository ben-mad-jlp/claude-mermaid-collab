# Pseudocode: Item 12 - Auto-Accept Option for Rough-Draft

## Session State Extension

```json
// collab-state.json
{
  "phase": "rough-draft/interface",
  "lastActivity": "...",
  "autoAcceptRoughDraft": false  // NEW field
}
```

## rough-draft Skill Update: Prompt at Start

```
# At the beginning of rough-draft skill:

FUNCTION promptAutoAccept():
  CALL mcp__mermaid__render_ui({
    project: getCurrentProject(),
    session: getCurrentSession(),
    ui: {
      type: 'Card',
      props: { title: 'Rough Draft Mode' },
      children: [
        {
          type: 'Markdown',
          props: { content: 'Auto-accept all rough-draft changes?' }
        },
        {
          type: 'Dropdown',
          props: {
            name: 'autoAccept',
            options: [
              { value: 'yes', label: 'Yes - Skip approval prompts' },
              { value: 'no', label: 'No - Review each phase' }
            ]
          }
        }
      ],
      actions: [{ id: 'confirm', label: 'Continue', primary: true }]
    },
    blocking: true
  })
  
  IF response.data.autoAccept === 'yes':
    CALL mcp__mermaid__update_session_state({
      project: getCurrentProject(),
      session: getCurrentSession(),
      autoAcceptRoughDraft: true
    })
    RETURN true
  ELSE:
    RETURN false
```

## Modified Approval Flow

```
FUNCTION requestApproval(artifact, phase):
  # Check if auto-accept is enabled
  state = CALL mcp__mermaid__get_session_state(...)
  
  IF state.autoAcceptRoughDraft:
    # Skip approval, just show the artifact
    CALL mcp__mermaid__render_ui({
      ui: {
        type: 'Card',
        props: { title: `${phase} Complete` },
        children: [
          { type: 'Markdown', props: { content: `Created ${artifact}` } }
        ]
      },
      blocking: false  # Non-blocking, just informational
    })
    RETURN 'approved'  # Auto-approve
  ELSE:
    # Normal approval flow with [PROPOSED] tag
    RETURN await promptForApproval(artifact, phase)
```

## Phase Sub-skill Updates

```
# In rough-draft-interface, rough-draft-pseudocode, rough-draft-skeleton:

FUNCTION runPhase():
  # Generate artifact
  artifact = generateArtifact()
  
  # Write with [PROPOSED] marker (always, for tracking)
  writeToDesignDoc(artifact, marker='[PROPOSED]')
  
  # Request approval (may auto-approve)
  result = requestApproval(artifact, currentPhase)
  
  IF result === 'approved':
    # Remove [PROPOSED] marker
    removeMarker()
    # Continue to next phase
  ELSE:
    # Handle rejection
    handleRejection()
```

## Verification Gates

```
# Verification still runs, but auto-passes if no errors

FUNCTION runVerification():
  issues = checkForIssues()
  
  IF issues.length === 0:
    IF state.autoAcceptRoughDraft:
      # Auto-pass, just log
      log('Verification passed (auto-accept mode)')
      RETURN 'pass'
    ELSE:
      # Normal confirmation
      RETURN await confirmVerification()
  ELSE:
    # Issues found - always require attention
    RETURN await handleVerificationIssues(issues)
```
