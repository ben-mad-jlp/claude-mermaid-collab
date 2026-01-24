# Pseudocode: Item 4 - Skill Transition Messages

## SkillTransition Component

```
FUNCTION SkillTransition({ transition }):
  RETURN (
    <div className="skill-transition">
      <div className="skill-icon">→</div>
      <div className="skill-info">
        <div className="skill-name">{transition.toSkill}</div>
        <div className="skill-description">{transition.description}</div>
      </div>
    </div>
  )
```

## ComponentRenderer Addition

```
FUNCTION ComponentRenderer({ ui }):
  SWITCH ui.type:
    CASE 'SkillTransition':
      RETURN <SkillTransition {...ui.props} />
    
    # ... existing cases ...
```

## Skill Usage Pattern

```
# In each skill that transitions, at the start:

FUNCTION invokeSkillWithTransition(skillName, description):
  # Send non-blocking render_ui
  CALL mcp__mermaid__render_ui({
    project: getCurrentProject(),
    session: getCurrentSession(),
    ui: {
      type: 'SkillTransition',
      props: {
        toSkill: skillName,
        description: description
      }
    },
    blocking: false
  })
  
  # Then proceed with skill logic
```

## Skill Descriptions

```
CONST SKILL_DESCRIPTIONS = {
  'brainstorming': 'Exploring requirements and design options',
  'rough-draft': 'Refining design through interface, pseudocode, skeleton phases',
  'rough-draft-interface': 'Defining structural contracts and type signatures',
  'rough-draft-pseudocode': 'Specifying logic flow and algorithms',
  'rough-draft-skeleton': 'Generating stub files and task dependencies',
  'executing-plans': 'Implementing the design with parallel task execution',
  'ready-to-implement': 'Validating all work items are documented',
  'collab-cleanup': 'Closing the collab session'
}
```

## Example Usage in rough-draft Skill

```
# At start of rough-draft skill:

render_ui({
  type: 'SkillTransition',
  props: {
    toSkill: 'rough-draft',
    description: SKILL_DESCRIPTIONS['rough-draft']
  }
}, blocking: false)

# Continue with interface phase...
```
