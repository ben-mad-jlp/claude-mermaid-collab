import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';

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
  // Browser build (excludes Node.js modules)
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
      resolve({ browser: true }),
      commonjs()
    ],
    external: ['d3', 'mermaid', 'fs', 'path']
  }
];
