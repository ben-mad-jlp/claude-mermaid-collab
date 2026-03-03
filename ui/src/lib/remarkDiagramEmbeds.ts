/**
 * Custom remark plugin to convert {{diagram:id}} and {{design:id}} embeds
 * into image nodes that the resolveImageSrc handler can process.
 *
 * Usage in markdown: {{diagram:my-diagram-id}} or {{design:my-design-id}}
 * These get converted to image nodes with @diagram/id or @design/id URLs.
 */
export function remarkDiagramEmbeds() {
  return (tree: any) => {
    const visit = (node: any) => {
      if (node.children) {
        const newChildren: any[] = [];
        for (const child of node.children) {
          if (child.type === 'text' && /\{\{(diagram|design):[^}]+\}\}/.test(child.value)) {
            const parts = child.value.split(/(\{\{(?:diagram|design):[^}]+\}\})/);
            for (const part of parts) {
              const match = part.match(/^\{\{(diagram|design):([^}]+)\}\}$/);
              if (match) {
                newChildren.push({
                  type: 'image',
                  url: `@${match[1]}/${match[2]}`,
                  alt: `Embedded ${match[1]}: ${match[2]}`,
                });
              } else if (part) {
                newChildren.push({ type: 'text', value: part });
              }
            }
          } else {
            visit(child);
            newChildren.push(child);
          }
        }
        node.children = newChildren;
      }
    };
    visit(tree);
  };
}
