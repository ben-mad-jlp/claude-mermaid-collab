/**
 * Design Component Library - File I/O for saved components
 *
 * Handles saving/loading COMPONENT subtrees to/from the component library
 * stored at .collab/sessions/{session}/components/{name}.component.json
 */

import { readFile, writeFile, readdir, mkdir } from 'fs/promises'
import { join } from 'path'

interface ComponentFile {
  name: string
  savedAt: string
  nodes: any[]  // SerializedNode subtree
}

function getComponentsDir(project: string, session: string): string {
  return join(project, '.collab', 'sessions', session, 'components')
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase()
}

export async function saveComponentToLibrary(
  project: string,
  session: string,
  name: string,
  nodes: any[]
): Promise<{ success: boolean; path: string }> {
  const dir = getComponentsDir(project, session)
  await mkdir(dir, { recursive: true })

  const filename = sanitizeFilename(name) + '.component.json'
  const filePath = join(dir, filename)

  const data: ComponentFile = {
    name,
    savedAt: new Date().toISOString(),
    nodes,
  }

  await writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8')
  return { success: true, path: filePath }
}

export async function loadComponentFromLibrary(
  project: string,
  session: string,
  name: string
): Promise<{ name: string; nodes: any[] }> {
  const dir = getComponentsDir(project, session)
  const filename = sanitizeFilename(name) + '.component.json'
  const filePath = join(dir, filename)

  let raw: string
  try {
    raw = await readFile(filePath, 'utf-8')
  } catch (err: any) {
    if (err?.code === 'ENOENT') {
      throw new Error(`Component "${name}" not found in library. Use list_library_components to see available components.`)
    }
    throw err
  }

  let data: ComponentFile
  try {
    data = JSON.parse(raw)
  } catch {
    throw new Error(`Component "${name}" has corrupted data and cannot be loaded.`)
  }

  if (!data.nodes || !Array.isArray(data.nodes)) {
    throw new Error(`Component "${name}" has invalid format: missing nodes array.`)
  }

  return { name: data.name, nodes: data.nodes }
}

export async function listLibraryComponents(
  project: string,
  session: string
): Promise<Array<{ name: string; filename: string; savedAt: string }>> {
  const dir = getComponentsDir(project, session)

  let files: string[]
  try {
    files = await readdir(dir)
  } catch {
    return []  // Directory doesn't exist yet
  }

  const components: Array<{ name: string; filename: string; savedAt: string }> = []

  for (const file of files) {
    if (!file.endsWith('.component.json')) continue
    try {
      const raw = await readFile(join(dir, file), 'utf-8')
      const data: ComponentFile = JSON.parse(raw)
      components.push({ name: data.name, filename: file, savedAt: data.savedAt })
    } catch {
      // Skip invalid files
    }
  }

  return components
}
