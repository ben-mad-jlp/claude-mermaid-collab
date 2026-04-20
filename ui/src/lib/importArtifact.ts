/**
 * Import a file as an artifact by detecting type from extension
 * and calling the appropriate create API endpoint.
 */

import { api } from './api';

export type ArtifactType = 'diagram' | 'document' | 'design' | 'snippet' | 'spreadsheet' | 'image';
export type ForcedType = ArtifactType | 'code-file';

const IMAGE_EXTS = new Set(['png','jpg','jpeg','gif','webp','svg','bmp','tif','tiff']);

interface ImportResult {
  type: ArtifactType;
  id: string;
  warning?: string;
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
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  if (IMAGE_EXTS.has(ext)) {
    return { type: 'image', name: filename };
  }
  // Everything else becomes a snippet; keep the full filename so the extension is visible
  return { type: 'snippet', name: filename };
}

/**
 * Strip known extensions from a filename for display name.
 */
function stripKnownExt(filename: string): string {
  if (filename.endsWith('.design.json')) return filename.replace(/\.design\.json$/, '');
  if (filename.endsWith('.spreadsheet.json')) return filename.replace(/\.spreadsheet\.json$/, '');
  if (filename.endsWith('.mmd')) return filename.replace(/\.mmd$/, '');
  if (filename.endsWith('.md')) return filename.replace(/\.md$/, '');
  return filename;
}

/**
 * Get the file extension (lowercased, without the leading dot).
 */
function getExt(filename: string): string {
  return filename.split('.').pop()?.toLowerCase() ?? '';
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
  opts?: { forcedType?: ForcedType },
): Promise<ImportResult> {
  if (opts?.forcedType) {
    const forced = opts.forcedType;
    const ext = getExt(file.name);

    if (forced === 'image') {
      if (!IMAGE_EXTS.has(ext)) {
        throw new Error('WrongDropTarget: Can only drop images into the Images section');
      }
      const formData = new FormData();
      formData.append('file', file);
      formData.append('name', file.name);
      const imageParams = new URLSearchParams({ project, session });
      const imageResponse = await fetch(`/api/image?${imageParams}`, {
        method: 'POST',
        body: formData,
      });
      if (!imageResponse.ok) {
        const errorBody = await imageResponse.text().catch(() => imageResponse.statusText);
        throw new Error(`Failed to import image "${file.name}": ${errorBody}`);
      }
      const imageData = await imageResponse.json();
      return { type: 'image', id: imageData.id };
    }

    if (forced === 'design') {
      if (ext !== 'json') {
        throw new Error('WrongDropTarget: Can only drop .json files into the Designs section');
      }
      const name = stripKnownExt(file.name).replace(/\.json$/, '');
      const text = await file.text();
      let content: string | object = text;
      try { content = JSON.parse(text); } catch { /* fall back to raw */ }
      const params = new URLSearchParams({ project, session });
      const response = await fetch(`/api/design?${params}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, content }),
      });
      if (!response.ok) {
        const errorBody = await response.text().catch(() => response.statusText);
        throw new Error(`Failed to import design "${name}": ${errorBody}`);
      }
      const data = await response.json();
      return { type: 'design', id: data.id };
    }

    if (forced === 'spreadsheet') {
      if (ext !== 'json') {
        throw new Error('WrongDropTarget: Can only drop .json files into the Spreadsheets section');
      }
      const name = stripKnownExt(file.name).replace(/\.json$/, '');
      const text = await file.text();
      let content: string | object = text;
      try { content = JSON.parse(text); } catch { /* fall back to raw */ }
      const params = new URLSearchParams({ project, session });
      const response = await fetch(`/api/spreadsheet?${params}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, content }),
      });
      if (!response.ok) {
        const errorBody = await response.text().catch(() => response.statusText);
        throw new Error(`Failed to import spreadsheet "${name}": ${errorBody}`);
      }
      const data = await response.json();
      return { type: 'spreadsheet', id: data.id };
    }

    if (forced === 'diagram' || forced === 'document' || forced === 'snippet') {
      const name = stripKnownExt(file.name);
      const text = await file.text();
      const params = new URLSearchParams({ project, session });
      const response = await fetch(`/api/${forced}?${params}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, content: text }),
      });
      if (!response.ok) {
        const errorBody = await response.text().catch(() => response.statusText);
        throw new Error(`Failed to import ${forced} "${name}": ${errorBody}`);
      }
      const data = await response.json();
      return { type: forced, id: data.id };
    }

    if (forced === 'code-file') {
      const name = file.name;
      const text = await file.text();
      const params = new URLSearchParams({ project, session });
      // Try linked snippet first
      try {
        const response = await fetch(`/api/snippet?${params}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, content: text, linked: true }),
        });
        if (!response.ok) {
          const errorBody = await response.text().catch(() => response.statusText);
          throw new Error(`Failed to import linked snippet "${name}": ${errorBody}`);
        }
        const data = await response.json();
        try {
          await api.syncCodeFromDisk(project, session, data.id);
        } catch (syncErr) {
          return {
            type: 'snippet',
            id: data.id,
            warning: `Linked snippet created but sync failed: ${(syncErr as Error).message}`,
          };
        }
        return { type: 'snippet', id: data.id };
      } catch (linkedErr) {
        // Fall back to regular (non-linked) snippet
        const fallbackResponse = await fetch(`/api/snippet?${params}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, content: text }),
        });
        if (!fallbackResponse.ok) {
          const errorBody = await fallbackResponse.text().catch(() => fallbackResponse.statusText);
          throw new Error(`Failed to import snippet "${name}": ${errorBody}`);
        }
        const data = await fallbackResponse.json();
        return {
          type: 'snippet',
          id: data.id,
          warning: `Could not create linked code-file; fell back to regular snippet: ${(linkedErr as Error).message}`,
        };
      }
    }
  }

  const { type, name } = detectType(file.name);

  if (type === 'image') {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('name', name);
    const imageParams = new URLSearchParams({ project, session });
    const imageResponse = await fetch(`/api/image?${imageParams}`, {
      method: 'POST',
      body: formData,
    });
    if (!imageResponse.ok) {
      const errorBody = await imageResponse.text().catch(() => imageResponse.statusText);
      throw new Error(`Failed to import image "${name}": ${errorBody}`);
    }
    const imageData = await imageResponse.json();
    return { type, id: imageData.id };
  }

  const text = await file.text();

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
