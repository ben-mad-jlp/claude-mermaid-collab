// Image/audio MCP tool surface — extracted verbatim from setup.ts.
//
// Owns the cohesive IMAGE tool group (image artifacts + Grok Imagine generation +
// audio listing): the ListTools declarations (IMAGE_TOOL_DEFS) and the CallTool
// handlers (handleImageTool). Identical behavior to the inline setup.ts version.
//
// NOTE: `set_node_image` is deliberately NOT here — it's a design/node tool, not an
// image-artifact tool, and stays with the design group in setup.ts.
import {
  createImageSchema, listImagesSchema, getImageSchema, deleteImageSchema,
  generateImageSchema, listAudioSchema,
  handleCreateImage, handleListImages, handleGetImage, handleDeleteImage,
  handleGenerateImage, handleListAudio,
} from './tools/image.js';

/**
 * ListTools declarations for the image tool group. Spread into the ListTools
 * array in setup.ts via `...IMAGE_TOOL_DEFS`.
 */
export const IMAGE_TOOL_DEFS = [
      { name: 'create_image', description: 'Create an image artifact from a file path, URL, or base64 data URI.', inputSchema: createImageSchema },
      { name: 'generate_image', description: 'Generate an image from a text prompt via Grok Imagine (xAI) and save it as a session image artifact. Returns the saved image id(s) + cost.', inputSchema: generateImageSchema },
      { name: 'list_audio', description: 'List audio artifacts in the session.', inputSchema: listAudioSchema },
      { name: 'list_images', description: 'List all image artifacts in a session.', inputSchema: listImagesSchema },
      { name: 'get_image', description: 'Get image artifact metadata by ID. Returns an absolute disk path; use the Read tool on that path to view the image.', inputSchema: getImageSchema },
      { name: 'delete_image', description: 'Delete an image artifact by ID.', inputSchema: deleteImageSchema },
];

/**
 * Handle an image-group CallTool invocation. Returns the JSON string result
 * (identical to the original inline setup.ts handler), or `null` if `name` is
 * not an image tool — in which case the caller falls through to its own switch.
 */
export async function handleImageTool(name: string, args: any): Promise<string | null> {
  switch (name) {
    case 'create_image': {
      const { project, session, name, source } = args as any;
      if (!project || !session || !name || !source) throw new Error('Missing required: project, session, name, source');
      const result = await handleCreateImage(project, session, name, source);
      return JSON.stringify(result, null, 2);
    }
    case 'generate_image': {
      const { project, session, prompt, name, task, model, n, aspectRatio, resolution } = args as any;
      if (!project || !session || !prompt) throw new Error('Missing required: project, session, prompt');
      const result = await handleGenerateImage(project, session, { prompt, name, task, model, n, aspectRatio, resolution });
      return JSON.stringify(result, null, 2);
    }
    case 'list_audio': {
      const { project, session } = args as any;
      if (!project || !session) throw new Error('Missing required: project, session');
      return JSON.stringify(await handleListAudio(project, session), null, 2);
    }
    case 'list_images': {
      const { project, session } = args as any;
      if (!project || !session) throw new Error('Missing required: project, session');
      const result = await handleListImages(project, session);
      return JSON.stringify(result, null, 2);
    }
    case 'get_image': {
      const { project, session, id } = args as any;
      if (!project || !session || !id) throw new Error('Missing required: project, session, id');
      const result = await handleGetImage(project, session, id);
      return JSON.stringify(result, null, 2);
    }
    case 'delete_image': {
      const { project, session, id } = args as any;
      if (!project || !session || !id) throw new Error('Missing required: project, session, id');
      const result = await handleDeleteImage(project, session, id);
      return JSON.stringify(result, null, 2);
    }
    default:
      return null;
  }
}
