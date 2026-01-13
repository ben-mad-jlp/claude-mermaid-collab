import { describe, it, expect } from 'vitest';

describe('Wireframe Parser', () => {
  it('should parse simple wireframe with default viewport', async () => {
    const input = `wireframe
  col
    Text "Hello"`;

    // This will fail - parser doesn't exist yet
    const { parser } = await import('../src/parser/wireframeParser.js');
    const result = parser.parse(input);

    expect(result.viewport).toBe('default');
    expect(result.nodes).toHaveLength(2);
    expect(result.nodes[0].type).toBe('col');
    expect(result.nodes[0].indent).toBe(2);
    expect(result.nodes[1].type).toBe('Text');
    expect(result.nodes[1].label).toBe('Hello');
    expect(result.nodes[1].indent).toBe(4);
  });

  it('should parse various widget types', async () => {
    const input = `wireframe
  col
    Title "My App"
    Button "Save"
    Input "Email"
    AppBar "Header"`;

    const { parser } = await import('../src/parser/wireframeParser.js');
    const result = parser.parse(input);

    expect(result.nodes[1].type).toBe('Title');
    expect(result.nodes[2].type).toBe('Button');
    expect(result.nodes[3].type).toBe('Input');
    expect(result.nodes[4].type).toBe('AppBar');
  });

  it('should parse modifiers on widgets and containers', async () => {
    const input = `wireframe
  row flex
  Button "Save" primary
  Button "Cancel" secondary`;

    const { parser } = await import('../src/parser/wireframeParser.js');
    const result = parser.parse(input);

    expect(result.nodes[0].modifiers.flex).toBe(true);
    expect(result.nodes[1].modifiers.variant).toBe('primary');
    expect(result.nodes[2].modifiers.variant).toBe('secondary');
  });

  it('should parse Grid with header and rows', async () => {
    const input = `wireframe
  Grid
    header "Name | Email"
    row "John | john@example.com"
    row "Jane | jane@example.com"`;

    const { parser } = await import('../src/parser/wireframeParser.js');
    const db = await import('../src/wireframeDb.js');

    db.clear();
    const result = parser.parse(input);
    db.addNodes(result);

    const { tree } = db.getData();
    const grid = tree[0];
    expect(grid.type).toBe('Grid');
    expect(grid.children).toHaveLength(3);
    expect(grid.children[0].type).toBe('grid-header');
    expect(grid.children[1].type).toBe('grid-row');
    expect(grid.children[2].type).toBe('grid-row');
  });
});
