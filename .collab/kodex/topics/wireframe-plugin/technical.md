## Architecture

Follows Mermaid's external diagram plugin pattern:

```
plugins/wireframe/
├── src/
│   ├── index.js           # Plugin entry point
│   ├── wireframeDb.js     # Data store
│   ├── wireframeDetector.js # Diagram type detection
│   ├── wireframeDiagram.js  # Diagram definition
│   ├── wireframeRenderer.js # SVG rendering
│   ├── styles.js          # CSS styles
│   └── parser/
│       └── wireframe.jison # Grammar definition
└── tests/
    ├── parser.test.js
    ├── db.test.js
    ├── renderer.test.js
    └── integration.test.js
```

## Plugin Registration

```javascript
import mermaid from 'mermaid';
import * as wireframe from 'mermaid-wireframe';

await mermaid.registerExternalDiagrams([wireframe]);
mermaid.initialize({ startOnLoad: true });
```

## Components

**Layout**: `col`, `row`, `grid`
**Navigation**: `AppBar`, `Navbar`, `Tabs`
**Content**: `Title`, `Text`, `Card`, `Image`
**Form**: `Input`, `Button`, `Checkbox`, `Select`
**Data**: `Table`, `List`

## Build

```bash
cd plugins/wireframe
npm install
npm run build    # Rollup bundle
npm test         # Vitest
```