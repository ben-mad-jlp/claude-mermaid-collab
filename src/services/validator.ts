import * as wireframe from 'mermaid-wireframe';

export interface ValidationResult {
  valid: boolean;
  error?: string;
  line?: number;
}

export class Validator {
  private wireframeRegistered: boolean = false;

  async validate(content: string): Promise<ValidationResult> {
    if (!content.trim()) {
      return { valid: false, error: 'Diagram cannot be empty' };
    }

    try {
      // Import mermaid dynamically
      const mermaid = await import('mermaid');

      // Register wireframe plugin once
      if (!this.wireframeRegistered) {
        await mermaid.default.registerExternalDiagrams([wireframe]);
        this.wireframeRegistered = true;
      }

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
