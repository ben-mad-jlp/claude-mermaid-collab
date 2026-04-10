/**
 * Diagram from Code Generator
 *
 * Parses source files using regex to generate Mermaid diagrams.
 * Supports: class diagrams, dependency graphs, and module maps.
 */

import { readFile } from 'fs/promises'
import { basename, dirname, relative, resolve } from 'path'

// ============= Types =============

interface FileContent {
  path: string
  content: string
}

interface ClassInfo {
  name: string
  extends?: string
  implements: string[]
  methods: string[]
  properties: string[]
  file: string
}

interface ImportInfo {
  from: string
  to: string
}

// ============= Schema =============

export const diagramFromCodeSchema = {
  type: 'object',
  properties: {
    project: { type: 'string', description: 'Absolute path to the project root directory' },
    session: { type: 'string', description: 'Session name' },
    filePaths: {
      type: 'array',
      items: { type: 'string' },
      description: 'Absolute paths to source files to analyze',
    },
    diagramType: {
      type: 'string',
      enum: ['class', 'dependency', 'module'],
      description: 'Type of diagram: class (class hierarchy), dependency (import graph), module (directory grouping)',
    },
    diagramName: { type: 'string', description: 'Name for the created diagram (default: auto-generated)' },
  },
  required: ['project', 'filePaths', 'diagramType'],
}

// ============= File Reading =============

async function readFiles(filePaths: string[]): Promise<FileContent[]> {
  const results: FileContent[] = []
  for (const fp of filePaths) {
    try {
      const content = await readFile(fp, 'utf-8')
      results.push({ path: fp, content })
    } catch {
      // Skip unreadable files
    }
  }
  return results
}

// ============= Class Diagram Generator =============

function extractClasses(files: FileContent[]): ClassInfo[] {
  const classes: ClassInfo[] = []

  for (const file of files) {
    // Match class/interface declarations (TS/JS)
    const classRegex = /(?:export\s+)?(?:default\s+)?(?:abstract\s+)?(?:class|interface)\s+(\w+)(?:<[^>]*>)?(?:\s+extends\s+(\w+)(?:<[^>]*>)?)?(?:\s+implements\s+([\w,\s<>]+))?/g
    let match: RegExpExecArray | null

    while ((match = classRegex.exec(file.content)) !== null) {
      const name = match[1]
      const ext = match[2]
      const impl = match[3] ? match[3].split(',').map(s => s.trim().replace(/<[^>]*>/g, '')).filter(Boolean) : []

      // Extract methods and properties from the class body
      const methods: string[] = []
      const properties: string[] = []

      // Find the class body - look for opening brace after declaration
      const afterDecl = file.content.slice(match.index + match[0].length)
      const braceIdx = afterDecl.indexOf('{')
      if (braceIdx !== -1) {
        // Extract a reasonable chunk of the body
        let depth = 1
        let i = braceIdx + 1
        const body = afterDecl
        while (i < body.length && depth > 0 && i < braceIdx + 5000) {
          if (body[i] === '{') depth++
          if (body[i] === '}') depth--
          i++
        }
        const classBody = body.slice(braceIdx + 1, i - 1)

        // Match method signatures
        const methodRegex = /(?:public|private|protected|static|async|abstract|readonly)?\s*(?:get |set )?(\w+)\s*(?:<[^>]*>)?\s*\(/gm
        let mMatch: RegExpExecArray | null
        while ((mMatch = methodRegex.exec(classBody)) !== null) {
          const mName = mMatch[1]
          if (mName && mName !== 'constructor' && mName !== 'if' && mName !== 'for' && mName !== 'while') {
            methods.push(mName + '()')
          }
        }

        // Match property declarations (with or without visibility modifiers)
        const propRegex = /^[ \t]*(?:(?:public|private|protected|static|readonly)\s+)*(\w+)\s*[?!]?\s*:/gm
        let pMatch: RegExpExecArray | null
        while ((pMatch = propRegex.exec(classBody)) !== null) {
          const pName = pMatch[1]
          // Skip false positives from control flow or type annotations
          if (pName && pName !== 'type' && pName !== 'return' && pName !== 'case' && pName !== 'default') {
            properties.push(pName)
          }
        }
      }

      classes.push({
        name,
        extends: ext,
        implements: impl,
        methods: methods.slice(0, 10), // Limit to 10
        properties: properties.slice(0, 10),
        file: file.path,
      })
    }
  }

  return classes
}

function generateClassDiagram(files: FileContent[]): string {
  const classes = extractClasses(files)
  if (classes.length === 0) {
    return 'classDiagram\n  class NoClassesFound'
  }

  const lines: string[] = ['classDiagram']

  for (const cls of classes) {
    lines.push(`  class ${cls.name} {`)
    for (const prop of cls.properties) {
      lines.push(`    ${prop}`)
    }
    for (const method of cls.methods) {
      lines.push(`    ${method}`)
    }
    lines.push('  }')

    if (cls.extends) {
      lines.push(`  ${cls.extends} <|-- ${cls.name}`)
    }
    for (const impl of cls.implements) {
      lines.push(`  ${impl} <|.. ${cls.name}`)
    }
  }

  return lines.join('\n')
}

// ============= Dependency Diagram Generator =============

function extractImports(files: FileContent[], projectRoot: string): ImportInfo[] {
  const imports: ImportInfo[] = []

  for (const file of files) {
    const relFrom = relative(projectRoot, file.path)
    // Match import statements
    const importRegex = /import\s+(?:(?:[\w*{}\s,]+)\s+from\s+)?['"]([^'"]+)['"]/g
    let match: RegExpExecArray | null

    while ((match = importRegex.exec(file.content)) !== null) {
      const importPath = match[1]
      // Only include relative imports (not node_modules)
      if (importPath.startsWith('.')) {
        const resolvedTo = relative(projectRoot, resolve(dirname(file.path), importPath))
        imports.push({ from: relFrom, to: resolvedTo })
      }
    }
  }

  return imports
}

function sanitizeMermaidId(str: string): string {
  let id = str.replace(/[^a-zA-Z0-9]/g, '_').replace(/^_+|_+$/g, '')
  if (!id) id = `file_${Math.random().toString(36).slice(2, 8)}`
  if (/^\d/.test(id)) id = `f${id}`
  return id
}

function generateDependencyDiagram(files: FileContent[], projectRoot: string): string {
  const imports = extractImports(files, projectRoot)
  if (imports.length === 0) {
    return 'graph LR\n  no_imports["No imports found"]'
  }

  const lines: string[] = ['graph LR']
  const seen = new Set<string>()

  // Collect all unique files
  const allFiles = new Set<string>()
  for (const imp of imports) {
    allFiles.add(imp.from)
    allFiles.add(imp.to)
  }

  // Add node definitions
  for (const f of allFiles) {
    const id = sanitizeMermaidId(f)
    if (!seen.has(id)) {
      lines.push(`  ${id}["${basename(f)}"]`)
      seen.add(id)
    }
  }

  // Add edges
  for (const imp of imports) {
    lines.push(`  ${sanitizeMermaidId(imp.from)} --> ${sanitizeMermaidId(imp.to)}`)
  }

  return lines.join('\n')
}

// ============= Module Diagram Generator =============

function generateModuleDiagram(files: FileContent[], projectRoot: string): string {
  const imports = extractImports(files, projectRoot)

  // Group files by directory
  const dirFiles = new Map<string, Set<string>>()
  const allFiles = new Set<string>()

  for (const file of files) {
    const rel = relative(projectRoot, file.path)
    const dir = dirname(rel) || '.'
    allFiles.add(rel)
    if (!dirFiles.has(dir)) dirFiles.set(dir, new Set())
    dirFiles.get(dir)!.add(rel)
  }

  if (dirFiles.size === 0) {
    return 'graph TD\n  no_modules["No modules found"]'
  }

  const lines: string[] = ['graph TD']

  // Add subgraphs for directories
  for (const [dir, dirFileSet] of dirFiles) {
    const dirId = sanitizeMermaidId(dir)
    lines.push(`  subgraph ${dirId}["${dir}"]`)
    for (const f of dirFileSet) {
      lines.push(`    ${sanitizeMermaidId(f)}["${basename(f)}"]`)
    }
    lines.push('  end')
  }

  // Add cross-directory edges
  for (const imp of imports) {
    const fromDir = dirname(imp.from) || '.'
    const toDir = dirname(imp.to) || '.'
    if (fromDir !== toDir) {
      lines.push(`  ${sanitizeMermaidId(imp.from)} --> ${sanitizeMermaidId(imp.to)}`)
    }
  }

  return lines.join('\n')
}

// ============= Main Handler =============

export async function handleDiagramFromCode(
  project: string,
  filePaths: string[],
  diagramType: 'class' | 'dependency' | 'module'
): Promise<{ success: boolean; mermaidSource: string }> {
  const files = await readFiles(filePaths)

  if (files.length === 0) {
    throw new Error('No files could be read from the provided paths')
  }

  let mermaidSource: string

  switch (diagramType) {
    case 'class':
      mermaidSource = generateClassDiagram(files)
      break
    case 'dependency':
      mermaidSource = generateDependencyDiagram(files, project)
      break
    case 'module':
      mermaidSource = generateModuleDiagram(files, project)
      break
    default:
      throw new Error(`Unknown diagram type: ${diagramType}`)
  }

  return { success: true, mermaidSource }
}
