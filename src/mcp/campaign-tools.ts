// Campaign lifecycle MCP tool surface — forge/list/read campaigns and their probes.
//
// Owns the cohesive CAMPAIGN tool group: creating campaigns with validated probes,
// listing campaigns with probe counts, and reading campaign state with probe verdicts
// and front derivation. Extracted as a pure adapter over campaign-forge/store/front.
import { forgeCampaign, InvalidCampaignError } from '../services/campaign-forge.js';
import { listCampaigns, listProbes, listProbeVerdicts } from '../services/campaign-store.js';
import { campaignFront } from '../services/campaign-front.js';

export const CAMPAIGN_TOOL_DEFS = [
  {
    name: 'forge_campaign',
    description: 'Forge a new campaign with validated probes. Each probe is a deterministic check (kind="command") that can depend on other probes. Validates the entire campaign before writing any row — if any probe fails validation, all offenders are named and no rows are written. Returns the created campaign row.',
    inputSchema: {
      type: 'object',
      properties: {
        project: {
          type: 'string',
          description: 'Tracking project (where the campaign is created).',
        },
        title: {
          type: 'string',
          description: 'Campaign title.',
        },
        probes: {
          type: 'array',
          description: 'Array of probes to validate and create. Each probe is an object with: ref (string), kind ("command"), environment ("worktree"|"rig"), command (string), optional dependsOn (array of refs), declaredPaths (array of file paths), and optional asserts (for validation hints).',
          items: {
            type: 'object',
            properties: {
              ref: {
                type: 'string',
                description: 'Reference identifier for this probe (used in dependsOn; resolved to a uuid on creation).',
              },
              kind: {
                type: 'string',
                enum: ['command'],
                description: 'Probe kind (only "command" in v1).',
              },
              environment: {
                type: 'string',
                enum: ['worktree', 'rig'],
                description: 'Probe environment ("worktree" for normal execution, "rig" for rig-managed environments).',
              },
              command: {
                type: 'string',
                description: 'Shell command to execute.',
              },
              dependsOn: {
                type: 'array',
                items: { type: 'string' },
                description: 'Optional list of probe refs this probe depends on (must pass before this runs).',
              },
              declaredPaths: {
                type: 'array',
                items: { type: 'string' },
                description: 'Files this probe operates on (for scoping and tracking).',
              },
              asserts: {
                type: 'object',
                description: 'Optional validation hints (e.g., { exitCode: 0 }) — used during forge validation but not stored.',
              },
            },
            required: ['ref', 'kind', 'environment', 'command'],
          },
        },
      },
      required: ['project', 'title', 'probes'],
    },
  },
  {
    name: 'list_campaigns',
    description: 'List all campaigns in a project with their probe counts.',
    inputSchema: {
      type: 'object',
      properties: {
        project: {
          type: 'string',
          description: 'Tracking project.',
        },
      },
      required: ['project'],
    },
  },
  {
    name: 'get_campaign',
    description: 'Read a single campaign with all its probes, probe verdicts, and the front (probes ready to run).',
    inputSchema: {
      type: 'object',
      properties: {
        project: {
          type: 'string',
          description: 'Tracking project.',
        },
        campaignId: {
          type: 'string',
          description: 'Campaign id.',
        },
      },
      required: ['project', 'campaignId'],
    },
  },
];

export async function handleCampaignTool(name: string, args: any): Promise<string | null> {
  switch (name) {
    case 'forge_campaign': {
      const { project, title, probes } = args as { project?: string; title?: string; probes?: any[] };
      if (!project) throw new Error('Missing required: project');
      if (!title) throw new Error('Missing required: title');
      if (!probes) throw new Error('Missing required: probes');
      // forgeCampaign throws InvalidCampaignError if validation fails; let it propagate.
      // The setup.ts try/catch turns it into the tool error response.
      const result = forgeCampaign(project, { title, probes });
      return JSON.stringify(result, null, 2);
    }
    case 'list_campaigns': {
      const { project } = args as { project?: string };
      if (!project) throw new Error('Missing required: project');
      const campaigns = listCampaigns(project);
      // Enrich each campaign with its probe count
      const enriched = campaigns.map((row) => ({
        ...row,
        probeCount: listProbes(project, row.id).length,
      }));
      return JSON.stringify(enriched, null, 2);
    }
    case 'get_campaign': {
      const { project, campaignId } = args as { project?: string; campaignId?: string };
      if (!project) throw new Error('Missing required: project');
      if (!campaignId) throw new Error('Missing required: campaignId');
      const probes = listProbes(project, campaignId);
      const enriched = probes.map((p) => ({
        ...p,
        verdicts: listProbeVerdicts(project, p.id),
      }));
      const front = campaignFront(project, campaignId);
      return JSON.stringify({ campaignId, probes: enriched, front }, null, 2);
    }
    default:
      return null;
  }
}
