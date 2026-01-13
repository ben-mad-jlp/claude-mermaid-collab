/**
 * Detector for wireframe diagrams
 */

export const id = 'wireframe';

export const detector = (text) => {
  return /^\s*wireframe(\s+(mobile|tablet|desktop))?/i.test(text);
};

export const loader = async () => {
  const { diagram } = await import('./wireframeDiagram.js');
  return { id, diagram };
};
