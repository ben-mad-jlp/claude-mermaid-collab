/**
 * Server-side SMACH State Machine to Mermaid Transpiler
 * Converts YAML state machine definitions to Mermaid flowchart syntax
 */

import * as yaml from 'js-yaml';

// Shape mapping for different state types
const STATE_SHAPES: Record<string, string> = {
  // Container states - will become subgraphs
  StateMachine: 'subgraph',
  Concurrence: 'subgraph',
  SuperGenericConcurrence: 'subgraph',
  MonitorConcurrence: 'subgraph',
  GenericConcurrence: 'subgraph',
  OrdinaryNonDeadlyConcurrence: 'subgraph',
  RetryContainer: 'subgraph',

  // Action states - stadium/pill shape ([[ ]])
  SimpleActionState: 'stadium',
  ServoActionState: 'stadium',
  MachineClientState: 'stadium',

  // Monitor/Service states - hexagon ({{ }})
  MonitorState: 'hexagon',
  SimpleServiceState: 'hexagon',

  // Utility states - rounded rectangle (( ))
  CallbackState: 'rounded',
  DelayState: 'rounded',

  // Condition state - diamond { }
  ConditionState: 'diamond',

  // Background execution - parallelogram [/ /]
  ExecuteSupplementalState: 'parallelogram',
  JoinState: 'parallelogram',

  // Advanced states - trapezoid [\ \]
  FactoryState: 'trapezoid',
  BehaviorTreeState: 'trapezoid',
};

// Generate node ID from state name (sanitize for Mermaid)
function toNodeId(name: string, prefix?: string): string {
  prefix = prefix || '';
  const sanitized = name.replace(/[^a-zA-Z0-9_]/g, '_');
  return prefix ? prefix + '_' + sanitized : sanitized;
}

// Generate Mermaid node declaration based on shape
function nodeDeclaration(id: string, label: string, type: string): string {
  const shape = STATE_SHAPES[type] || 'rounded';

  switch (shape) {
    case 'stadium':
      return id + '([' + label + '])';
    case 'hexagon':
      return id + '{{' + label + '}}';
    case 'diamond':
      return id + '{' + label + '}';
    case 'parallelogram':
      return id + '[/' + label + '/]';
    case 'trapezoid':
      return id + '[\\' + label + '\\]';
    case 'rounded':
    default:
      return id + '(' + label + ')';
  }
}

/**
 * Process states recursively
 * Each container has its own outcome nodes inside it
 */
function processStates(
  states: Record<string, any>,
  lines: string[],
  externalLinks: string[],
  prefix: string,
  initialState: string,
  indent: string,
  parentOutcomes: string[],
  parentOutcomePrefix: string
): void {
  indent = indent || '  ';
  parentOutcomes = parentOutcomes || [];

  for (const [stateName, stateConfig] of Object.entries(states)) {
    const nodeId = toNodeId(stateName, prefix);
    const stateType = stateConfig.type || 'CallbackState';
    const shape = STATE_SHAPES[stateType];

    if (shape === 'subgraph') {
      // Container state - render as subgraph
      lines.push(indent + 'subgraph ' + nodeId + '[' + stateName + ']');

      // Add internal start if this container has initial_state
      if (stateConfig.initial_state && stateConfig.states) {
        const internalStart = toNodeId('_start', nodeId);
        lines.push(indent + '  ' + internalStart + '(( ))');
        lines.push(indent + '  ' + internalStart + ' --> ' + toNodeId(stateConfig.initial_state, nodeId));
      }

      // This container's outcomes
      const containerOutcomes = stateConfig.outcomes || ['succeeded', 'failed'];

      // Process child states - they will connect to THIS container's outcomes
      if (stateConfig.states) {
        processStates(stateConfig.states, lines, externalLinks, nodeId, stateConfig.initial_state, indent + '  ', containerOutcomes, nodeId);
      }

      // Add outcome nodes for this container (inside the subgraph)
      for (const outcome of containerOutcomes) {
        const outcomeNodeId = toNodeId(outcome, nodeId + '_OUT');
        lines.push(indent + '  ' + outcomeNodeId + '((' + outcome + '))');
      }

      lines.push(indent + 'end');

      // Add external links from this container's outcome nodes to targets
      if (stateConfig.transitions) {
        for (const [outcome, target] of Object.entries(stateConfig.transitions)) {
          const outcomeNodeId = toNodeId(outcome, nodeId + '_OUT');
          let targetNodeId: string;

          // Check if target is one of the parent's outcomes
          if (parentOutcomes.includes(target as string)) {
            // Target is parent container's outcome node
            targetNodeId = toNodeId(target as string, parentOutcomePrefix + '_OUT');
          } else {
            // Target is a sibling state at the same level
            targetNodeId = toNodeId(target as string, prefix);
          }
          externalLinks.push(indent + outcomeNodeId + ' --> ' + targetNodeId);
        }
      }
    } else {
      // Leaf state - render as node
      lines.push(indent + nodeDeclaration(nodeId, stateName, stateType));

      // Process transitions
      if (stateConfig.transitions) {
        for (const [outcome, target] of Object.entries(stateConfig.transitions)) {
          let targetId: string;

          // Check if target is one of the parent container's outcomes
          if (parentOutcomes.includes(target as string)) {
            // Target is this container's outcome node
            targetId = toNodeId(target as string, parentOutcomePrefix + '_OUT');
          } else {
            // Target is a sibling state
            targetId = toNodeId(target as string, prefix);
          }

          lines.push(indent + nodeId + ' -->|' + outcome + '| ' + targetId);
        }
      }
    }
  }
}

/**
 * Parse SMACH YAML and convert to Mermaid flowchart
 */
export function transpile(yamlText: string): { mermaid: string } {
  const parsed = yaml.load(yamlText) as any;

  if (!parsed || !parsed.smach_diagram) {
    throw new Error('Invalid SMACH YAML: missing smach_diagram root');
  }

  const diagram = parsed.smach_diagram;

  // Get the root StateMachine (should be the only key under smach_diagram)
  const rootKeys = Object.keys(diagram);
  if (rootKeys.length === 0) {
    throw new Error('Invalid SMACH YAML: smach_diagram must contain a root StateMachine');
  }

  const rootName = rootKeys[0];
  const rootMachine = diagram[rootName];

  if (!rootMachine || typeof rootMachine !== 'object') {
    throw new Error('Invalid SMACH YAML: root StateMachine must be an object');
  }

  const lines = ['flowchart TD'];
  const externalLinks: string[] = [];

  // Add start node pointing to the root machine's initial state
  if (rootMachine.initial_state) {
    lines.push('  START(( ))');
    lines.push('  START --> ' + toNodeId(rootMachine.initial_state));
  }

  // Process states inside the root machine
  const rootOutcomes = rootMachine.outcomes || ['succeeded', 'failed'];
  if (rootMachine.states) {
    processStates(rootMachine.states, lines, externalLinks, '', rootMachine.initial_state, '  ', rootOutcomes, '');
  }

  // Add root outcome nodes (the final outcomes of the entire state machine)
  for (const outcome of rootOutcomes) {
    const outcomeNodeId = toNodeId(outcome, '_OUT');
    lines.push('  ' + outcomeNodeId + '((' + outcome + '))');
  }

  // Add external links (container outcomes connecting to parent outcomes or siblings)
  if (externalLinks.length > 0) {
    lines.push('');
    lines.push('  %% Container outcome connections');
    for (const link of externalLinks) {
      lines.push(link);
    }
  }

  return {
    mermaid: lines.join('\n')
  };
}

/**
 * Detect if text is SMACH YAML
 */
export function isSmachYaml(text: string): boolean {
  return /^\s*smach_diagram\s*:/m.test(text);
}
