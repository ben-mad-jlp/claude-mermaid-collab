#!/usr/bin/env bun
import { Renderer } from './src/services/renderer.ts';

const testDiagram = `wireframe mobile
  col
    AppBar "My App"
    col padding=24
      Title "Welcome"
      Text "Sign in to continue"
      Input "Email"
      Input "Password"
      Button "Sign In" primary
`;

const renderer = new Renderer();

console.log('Testing wireframe plugin integration...\n');

try {
  const svg = await renderer.renderSVG(testDiagram);

  if (svg.includes('<svg') && svg.includes('viewBox="0 0 375 600"')) {
    console.log('✅ Wireframe plugin registered successfully!');
    console.log('✅ SVG rendered with correct mobile viewport (375px)');
    console.log(`✅ SVG length: ${svg.length} characters\n`);
    console.log('Sample output (first 500 chars):');
    console.log(svg.substring(0, 500) + '...\n');
  } else {
    console.log('❌ SVG rendered but may not be wireframe format');
    console.log(svg.substring(0, 200));
  }
} catch (error) {
  console.error('❌ Error rendering wireframe:', error);
  process.exit(1);
}
