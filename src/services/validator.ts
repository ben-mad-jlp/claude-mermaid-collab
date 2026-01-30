import * as yaml from 'js-yaml';

export interface ValidationResult {
  valid: boolean;
  error?: string;
  line?: number;
}

// Check if content is SMACH YAML
function isSmachYaml(content: string): boolean {
  return /^\s*smach_diagram\s*:/m.test(content);
}

// Validate SMACH YAML structure
function validateSmachYaml(content: string): ValidationResult {
  try {
    const parsed = yaml.load(content) as any;

    if (!parsed || !parsed.smach_diagram) {
      return { valid: false, error: 'Missing smach_diagram root' };
    }

    const diagram = parsed.smach_diagram;

    // smach_diagram should contain exactly one root StateMachine
    const rootKeys = Object.keys(diagram);
    if (rootKeys.length === 0) {
      return { valid: false, error: 'smach_diagram must contain a root StateMachine' };
    }

    if (rootKeys.length > 1) {
      return { valid: false, error: 'smach_diagram must contain exactly one root StateMachine, found: ' + rootKeys.join(', ') };
    }

    const rootName = rootKeys[0];
    const rootMachine = diagram[rootName];

    if (!rootMachine || typeof rootMachine !== 'object') {
      return { valid: false, error: 'Root StateMachine "' + rootName + '" must be an object' };
    }

    // Root must be a StateMachine type (or default to StateMachine)
    const rootType = rootMachine.type || 'StateMachine';
    if (rootType !== 'StateMachine') {
      return { valid: false, error: 'Root element must be type StateMachine, got: ' + rootType };
    }

    if (!rootMachine.states || Object.keys(rootMachine.states).length === 0) {
      return { valid: false, error: 'Root StateMachine must have at least one state' };
    }

    if (!rootMachine.initial_state) {
      return { valid: false, error: 'Root StateMachine must have an initial_state' };
    }

    if (!rootMachine.outcomes || rootMachine.outcomes.length === 0) {
      return { valid: false, error: 'Root StateMachine must have outcomes' };
    }

    return { valid: true };
  } catch (error: any) {
    return {
      valid: false,
      error: 'YAML parse error: ' + (error.message || 'Invalid YAML syntax'),
    };
  }
}

export class Validator {
  async validate(content: string): Promise<ValidationResult> {
    if (!content.trim()) {
      return { valid: false, error: 'Diagram cannot be empty' };
    }

    // Check for SMACH YAML first
    if (isSmachYaml(content)) {
      return validateSmachYaml(content);
    }

    try {
      // Import mermaid dynamically
      const mermaid = await import('mermaid');

      // Try to parse the diagram
      await mermaid.default.parse(content);

      return { valid: true };
    } catch (error: any) {
      // Extract line number from error message if available
      const lineMatch = error.message?.match(/line (\d+)/i);
      const line = lineMatch ? parseInt(lineMatch[1]) : undefined;

      return {
        valid: false,
        error: error.message || 'Invalid mermaid syntax',
        line,
      };
    }
  }
}
