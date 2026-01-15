/**
 * SMACH State Machine to Mermaid Transpiler
 * Converts YAML state machine definitions to Mermaid flowchart syntax
 * Version: 4.1 - Each container has its own outcome nodes with proper chaining
 */
console.log('SMACH Transpiler v4.1 loaded');

import jsYaml from 'https://esm.sh/js-yaml@4';

// Shape mapping for different state types
const STATE_SHAPES = {
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

// Store for properties (for click-to-view popup)
let stateProperties = {};

// Generate node ID from state name (sanitize for Mermaid)
function toNodeId(name, prefix) {
  prefix = prefix || '';
  const sanitized = name.replace(/[^a-zA-Z0-9_]/g, '_');
  return prefix ? prefix + '_' + sanitized : sanitized;
}

// Generate Mermaid node declaration based on shape
function nodeDeclaration(id, label, type) {
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
 *
 * @param {object} states - State definitions
 * @param {string[]} lines - Output lines for structure
 * @param {Array} externalLinks - Collected external links
 * @param {string} prefix - Node ID prefix for this level
 * @param {string} initialState - Initial state name
 * @param {string} indent - Current indentation
 * @param {string[]} parentOutcomes - Parent container's outcome names
 * @param {string} parentOutcomePrefix - Prefix for parent's outcome nodes (e.g., '' for root, 'main_workflow' for nested)
 */
function processStates(states, lines, externalLinks, prefix, initialState, indent, parentOutcomes, parentOutcomePrefix) {
  indent = indent || '  ';
  parentOutcomes = parentOutcomes || [];

  for (const [stateName, stateConfig] of Object.entries(states)) {
    const nodeId = toNodeId(stateName, prefix);
    const stateType = stateConfig.type || 'CallbackState';
    const shape = STATE_SHAPES[stateType];

    // Store properties for popup
    stateProperties[nodeId] = {
      name: stateName,
      type: stateType,
      ...stateConfig
    };

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
          let targetNodeId;

          // Check if target is one of the parent's outcomes
          if (parentOutcomes.includes(target)) {
            // Target is parent container's outcome node
            targetNodeId = toNodeId(target, parentOutcomePrefix + '_OUT');
          } else {
            // Target is a sibling state at the same level
            targetNodeId = toNodeId(target, prefix);
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
          let targetId;

          // Check if target is one of the parent container's outcomes
          if (parentOutcomes.includes(target)) {
            // Target is this container's outcome node
            targetId = toNodeId(target, parentOutcomePrefix + '_OUT');
          } else {
            // Target is a sibling state
            targetId = toNodeId(target, prefix);
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
export function transpile(yamlText) {
  stateProperties = {};

  const parsed = jsYaml.load(yamlText);

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
  const externalLinks = [];

  // Store root machine properties
  stateProperties[rootName] = {
    name: rootName,
    type: rootMachine.type || 'StateMachine',
    ...rootMachine
  };

  // Add start node pointing to the root machine's initial state
  if (rootMachine.initial_state) {
    lines.push('  START(( ))');
    lines.push('  START --> ' + toNodeId(rootMachine.initial_state));
  }

  // Process states inside the root machine
  // Root states connect to root outcome nodes (prefix '' means _OUT_succeeded, _OUT_aborted)
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

  const mermaidCode = lines.join('\n');
  console.log('=== SMACH TRANSPILER OUTPUT ===');
  console.log(mermaidCode);
  console.log('=== END TRANSPILER OUTPUT ===');
  return {
    mermaid: mermaidCode,
    properties: stateProperties
  };
}

/**
 * Get properties for a state by node ID
 */
export function getStateProperties(nodeId) {
  return stateProperties[nodeId] || null;
}

/**
 * Get all state properties
 */
export function getAllProperties() {
  return { ...stateProperties };
}

/**
 * Detect if text is SMACH YAML
 */
export function isSmachYaml(text) {
  return /^\s*smach_diagram\s*:/m.test(text);
}
