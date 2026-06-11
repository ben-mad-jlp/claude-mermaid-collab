# Coding Standards

This project follows consistent coding standards across backend (Bun/TypeScript) and frontend (React/TypeScript).

## TypeScript Configuration

- **Target**: ES2022 (backend), ES2020 (frontend)
- **Strict mode**: Enabled
- **Module resolution**: Bundler
- Path aliases configured in frontend (`@components/*`, `@hooks/*`, etc.)

## Key Conventions

- **Functional components** with hooks in React
- **Singleton services** for backend functionality
- **Async/await** throughout with proper try-catch
- **Zustand** for state management
- **JSDoc** for public APIs and interfaces
- **Tailwind CSS** for styling