## Technical Stack

### Frontend
- **React 18**: Component framework
- **TypeScript**: Type safety
- **Vite**: Build tooling
- **Tailwind CSS**: Styling
- **Zustand**: State management
- **CodeMirror**: Code editing
- **xterm.js**: Terminal emulation

### Key Entry Points
```
ui/
├── index.html          # HTML entry
├── src/
│   ├── main.tsx        # React entry
│   ├── App.tsx         # Root component
│   └── components/     # UI components
```

### Build Commands
```bash
cd ui && bun run dev    # Development server
cd ui && bun run build  # Production build
```

### Static Assets
- `diagram.html`: Standalone diagram viewer
- `document.html`: Standalone document viewer