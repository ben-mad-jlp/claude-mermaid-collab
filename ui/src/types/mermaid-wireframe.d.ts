/**
 * Type declarations for mermaid-wireframe plugin
 */
declare module 'mermaid-wireframe' {
  import type { ExternalDiagramDefinition } from 'mermaid';

  export const id: string;
  export const detector: (text: string) => boolean;
  export const loader: ExternalDiagramDefinition['loader'];

  const wireframePlugin: ExternalDiagramDefinition;
  export default wireframePlugin;
}
