import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import virtual from '@rollup/plugin-virtual';
import replace from '@rollup/plugin-replace';

export default [
  // Node.js builds (for server-side use)
  {
    input: 'src/index.js',
    output: [
      {
        file: 'dist/mermaid-wireframe.mjs',
        format: 'es',
        inlineDynamicImports: true
      },
      {
        file: 'dist/mermaid-wireframe.cjs',
        format: 'cjs',
        inlineDynamicImports: true
      }
    ],
    plugins: [
      resolve(),
      commonjs()
    ],
    external: ['d3', 'mermaid']
  },
  // Browser build (excludes Node.js modules with empty stubs)
  {
    input: 'src/index.js',
    output: [
      {
        file: 'dist/mermaid-wireframe.browser.js',
        format: 'es',
        inlineDynamicImports: true
      },
      {
        file: '../../public/js/plugins/mermaid-wireframe.js',
        format: 'es',
        inlineDynamicImports: true
      }
    ],
    plugins: [
      // Provide empty stubs for Node.js modules not available in browser
      virtual({
        'fs': 'export default {}; export const readFileSync = () => ""; export const existsSync = () => false;',
        'path': 'export default {}; export const join = (...args) => args.join("/"); export const resolve = (...args) => args.join("/"); export const dirname = (p) => p;'
      }),
      // Replace Node.js-specific code patterns
      replace({
        preventAssignment: true,
        delimiters: ['', ''],
        values: {
          'if (require.main === module)': 'if (false)',
          'require.main': 'undefined'
        }
      }),
      resolve({ browser: true }),
      commonjs()
    ],
    external: ['d3', 'mermaid']
  }
];
