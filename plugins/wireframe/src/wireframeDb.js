/**
 * Database module for wireframe diagrams
 * Stores parsed data and builds tree structure
 */

let nodes = [];
let tree = null;
let viewport = 'default';
let direction = 'LR';

/**
 * Clear all stored data
 */
export const clear = () => {
  nodes = [];
  tree = null;
  viewport = 'default';
  direction = 'LR';
};

/**
 * Add parsed nodes and build tree
 * @param {Object} parsedData - Result from parser
 * @param {string} parsedData.viewport - Viewport size
 * @param {string} parsedData.direction - Layout direction (LR or TD)
 * @param {Array} parsedData.nodes - Flat list of nodes
 */
export const addNodes = (parsedData) => {
  // Deep clone to prevent external mutations
  nodes = JSON.parse(JSON.stringify(parsedData.nodes));
  viewport = parsedData.viewport;
  direction = parsedData.direction || 'LR';
  tree = buildTree(nodes);
};

/**
 * Get stored data
 * @returns {Object} Object with viewport, direction, and tree
 */
export const getData = () => ({
  viewport,
  direction,
  tree: JSON.parse(JSON.stringify(tree))
});

/**
 * Build tree structure from flat nodes using stack algorithm
 * @param {Array} flatNodes - Flat list of nodes with indent property
 * @returns {Array} Root level nodes with children populated
 */
function buildTree(flatNodes) {
  const root = { children: [], indent: -1, type: 'root' };
  const stack = [root];

  for (const node of flatNodes) {
    // Create a new object instead of mutating
    const clonedNode = { ...node, children: [] };

    // Pop stack until we find the parent (lower indent)
    while (stack.length > 1 && stack[stack.length - 1].indent >= clonedNode.indent) {
      stack.pop();
    }

    // Add as child of current stack top
    stack[stack.length - 1].children.push(clonedNode);

    // Push current node onto stack
    stack.push(clonedNode);
  }

  return root.children;
}
