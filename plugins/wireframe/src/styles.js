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

  /* Dark mode support */
  .dark .wireframe-container,
  [data-theme="dark"] .wireframe-container {
    color-scheme: dark;
  }
`;

export default getStyles;
