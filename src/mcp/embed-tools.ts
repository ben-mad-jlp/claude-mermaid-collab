// Embed MCP tool surface — extracted verbatim from setup.ts.
//
// Owns the cohesive EMBED tool group (iframe + Storybook embeds): the ListTools
// declarations (EMBED_TOOL_DEFS) and the CallTool handlers (handleEmbedTool).
// Behavior is identical to the original inline setup.ts implementation — pure move.
import {
  createEmbedSchema, listEmbedsSchema, deleteEmbedSchema,
  createStorybookEmbedSchema, listStorybookStoriesSchema,
  handleCreateEmbed, handleListEmbeds, handleDeleteEmbed,
  handleCreateStorybookEmbed, handleListStorybookStories,
} from './tools/embed.js';

/**
 * ListTools declarations for the embed tool group. Spread into the ListTools
 * array in setup.ts via `...EMBED_TOOL_DEFS`.
 */
export const EMBED_TOOL_DEFS = [
      { name: 'create_embed', description: 'Create a new embed (iframe) artifact for displaying external URLs in the collab UI.', inputSchema: createEmbedSchema },
      { name: 'list_embeds', description: 'List all embeds in a session.', inputSchema: listEmbedsSchema },
      { name: 'delete_embed', description: 'Delete an embed by ID.', inputSchema: deleteEmbedSchema },
      { name: 'create_storybook_embed', description: 'Create a Storybook embed from a story ID. Constructs the iframe URL and creates an embed artifact with storybook metadata.', inputSchema: createStorybookEmbedSchema },
      { name: 'list_storybook_stories', description: 'List available Storybook stories by fetching index.json from the running Storybook dev server.', inputSchema: listStorybookStoriesSchema },
];

/**
 * Handle an embed-group CallTool invocation. Returns the JSON string result
 * (identical to the original inline setup.ts handler), or `null` if `name` is
 * not an embed tool — in which case the caller falls through to its own switch.
 */
export async function handleEmbedTool(name: string, args: any): Promise<string | null> {
  switch (name) {
    case 'create_embed': {
      const { project, session, name, url, subtype, width, height, storybook } = args as any;
      if (!project || !session) throw new Error('Missing required: project, session');
      if (!name || !url) throw new Error('Missing required: name, url');
      const result = await handleCreateEmbed(project, session, name, url, subtype, width, height, storybook);
      return JSON.stringify(result, null, 2);
    }
    case 'list_embeds': {
      const { project, session } = args as any;
      if (!project || !session) throw new Error('Missing required: project, session');
      const result = await handleListEmbeds(project, session);
      return JSON.stringify(result, null, 2);
    }
    case 'delete_embed': {
      const { project, session, id } = args as any;
      if (!project || !session || !id) throw new Error('Missing required: project, session, id');
      const result = await handleDeleteEmbed(project, session, id);
      return JSON.stringify(result, null, 2);
    }
    case 'create_storybook_embed': {
      const { project, session, name, storyId, port, host } = args as any;
      if (!project || !session) throw new Error('Missing required: project, session');
      if (!name || !storyId) throw new Error('Missing required: name, storyId');
      const result = await handleCreateStorybookEmbed(project, session, name, storyId, port, host);
      return JSON.stringify(result, null, 2);
    }
    case 'list_storybook_stories': {
      const { port, host } = args as any;
      const result = await handleListStorybookStories(port, host);
      return JSON.stringify(result, null, 2);
    }
    default:
      return null;
  }
}
