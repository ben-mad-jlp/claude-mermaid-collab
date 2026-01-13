/**
 * Styles for wireframe diagrams
 */

const getStyles = () => `
  .wireframe-container {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  }

  .wireframe-container rect {
    shape-rendering: crispEdges;
  }

  .wireframe-container text {
    user-select: none;
    -webkit-user-select: none;
  }
`;

export default getStyles;
