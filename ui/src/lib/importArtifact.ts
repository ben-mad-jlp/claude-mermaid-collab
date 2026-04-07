/**
 * Import a file as an artifact by detecting type from extension
 * and calling the appropriate create API endpoint.
 */

export type ArtifactType = 'diagram' | 'document' | 'design' | 'snippet' | 'spreadsheet';

interface ImportResult {
  type: ArtifactType;
  id: string;
}

/**
 * Detect artifact type and derive a display name from a filename.
 */
export function detectType(filename: string): { type: ArtifactType; name: string } {
  if (filename.endsWith('.design.json')) {
    return { type: 'design', name: filename.replace(/\.design\.json$/, '') };
  }
  if (filename.endsWith('.spreadsheet.json')) {
    return { type: 'spreadsheet', name: filename.replace(/\.spreadsheet\.json$/, '') };
  }
  if (filename.endsWith('.mmd')) {
    return { type: 'diagram', name: filename.replace(/\.mmd$/, '') };
  }
  if (filename.endsWith('.md')) {
    return { type: 'document', name: filename.replace(/\.md$/, '') };
  }
  // Everything else becomes a snippet; keep the full filename so the extension is visible
  return { type: 'snippet', name: filename };
}

/**
 * Import a File object as a session artifact.
 *
 * Reads the file contents, detects the artifact type from the extension,
 * and POSTs to the matching create endpoint.
 *
 * @returns The created artifact's type and server-assigned id.
 */
export async function importArtifact(
  project: string,
  session: string,
  file: File,
): Promise<ImportResult> {
  const text = await file.text();
  const { type, name } = detectType(file.name);

  // For design and spreadsheet JSON files, parse the content so it is sent as
  // an object rather than a string (the backend expects a JSON body with
  // `content` as the parsed design/spreadsheet object).
  let content: string | object = text;
  if (type === 'design' || type === 'spreadsheet') {
    try {
      content = JSON.parse(text);
    } catch {
      // If parsing fails, fall back to sending as a raw string and let the
      // backend decide how to handle it.
    }
  }

  const params = new URLSearchParams({ project, session });
  const url = `/api/${type}?${params}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, content }),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => response.statusText);
    throw new Error(`Failed to import ${type} "${name}": ${errorBody}`);
  }

  const data = await response.json();
  return { type, id: data.id };
}
