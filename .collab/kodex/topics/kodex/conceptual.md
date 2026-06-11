# Kodex Knowledge Base System

Kodex is the project knowledge management system that stores documentation about the codebase. It uses SQLite for metadata/analytics and Markdown files for topic content.

## Core Concepts

- **Topics**: Knowledge units with conceptual, technical, files, and related sections
- **Drafts**: AI-generated content awaiting human approval
- **Flags**: Issues marked for review (outdated, incorrect, incomplete, missing)
- **Verification**: Human-verified topics with confidence levels

## Workflow

1. `/kodex-init` - Bootstrap topics from codebase analysis
2. Topics created as drafts (low confidence)
3. Flags mark topics needing attention
4. `/kodex-fix` routes to fix skills
5. Human approves drafts in UI
6. Verified topics become trusted knowledge