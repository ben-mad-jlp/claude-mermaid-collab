// Campaign lifecycle MCP tool surface — forge/list/read campaigns and their probes.
//
// Owns the cohesive CAMPAIGN tool group: creating campaigns with validated probes,
// listing campaigns with probe counts, and reading campaign state with probe verdicts
// and front derivation. Extracted as a pure adapter over campaign-forge/store/front.
import { forgeCampaignFromGoal, InvalidCampaignError } from '../services/campaign-forge.js';
import { listCampaigns, listProbes, listProbeVerdicts, getCampaign, latestCampaignCompletion, dropCampaign } from '../services/campaign-store.js';
import { campaignFront } from '../services/campaign-front.js';
import { deriveCampaignCompletion } from '../services/campaign-completion.js';
import { makeJudgmentLLM } from '../services/judgment-llm.js';
import { resolveTriageRoute } from '../services/config-service.js';

export const CAMPAIGN_TOOL_DEFS = [
  {
    name: 'forge_campaign',
    description: 'Forge a new campaign with validated probes and an optional goal. Each probe is a deterministic check (kind="command") that can depend on other probes. The goal is free-text and describes what the campaign is judged against. Probes may be omitted if a goal is given — the goal is then translated into concrete probes via LLM derivation. If the goal is ambiguous (leaves WHAT to measure unclear), returns {"kind":"questions","questions":[…]} and creates no campaign. If probes are provided, they are validated and used directly. Validates the entire campaign before writing any row — if any probe fails validation, all offenders are named and no rows are written. Returns the created campaign row or a list of clarifying questions.',
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
        goal: {
          type: 'string',
          description: 'Free-text campaign goal (what the campaign is judged against). No shape requirement. If probes are omitted, the goal is used to derive them.',
        },
        probes: {
          type: 'array',
          description: 'Array of probes to validate and create. Each probe is an object with: ref (string), kind ("command"), environment ("worktree"|"rig"), command (string), optional dependsOn (array of refs), declaredPaths (array of file paths), and optional asserts (for validation hints). May be omitted if goal is given.',
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
      required: ['project', 'title'],
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
    description: 'Read a single campaign with all its probes, probe verdicts, the front (probes ready to run), the goal, and the completion ruling. A campaign is open until a judge rules it done.',
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
  {
    name: 'drop_campaign',
    description: 'Drop a campaign so no further pass runs for it: it stops spawning missions and takes no land side effects, but stays readable via list_campaigns/get_campaign with its droppedAt timestamp. Idempotent. This is the only way to retire a stale campaign — passes otherwise run for EVERY campaign of a project.',
    inputSchema: {
      type: 'object',
      properties: {
        project: {
          type: 'string',
          description: 'Tracking project.',
        },
        campaignId: {
          type: 'string',
          description: 'Campaign id to drop.',
        },
      },
      required: ['project', 'campaignId'],
    },
  },
];

export async function handleCampaignTool(name: string, args: any): Promise<string | null> {
  switch (name) {
    case 'forge_campaign': {
      const { project, title, goal, probes } = args as { project?: string; title?: string; goal?: string; probes?: any[] };
      if (!project) throw new Error('Missing required: project');
      if (!title) throw new Error('Missing required: title');
      // Build the LLM for derivation (if needed).
      const llm = makeJudgmentLLM(resolveTriageRoute({ project }));
      // forgeCampaignFromGoal throws InvalidCampaignError or EmptyCampaignError if validation/constraints fail;
      // let it propagate. The setup.ts try/catch turns it into the tool error response.
      const result = await forgeCampaignFromGoal(project, { title, goal, probes }, { llm });
      // Return both campaign and questions responses — the caller parses the kind field.
      if (result.kind === 'campaign') {
        return JSON.stringify(result.campaign, null, 2);
      } else {
        return JSON.stringify({ kind: 'questions', questions: result.questions }, null, 2);
      }
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
      const campaign = getCampaign(project, campaignId);
      const probes = listProbes(project, campaignId);
      const enriched = probes.map((p) => ({
        ...p,
        verdicts: listProbeVerdicts(project, p.id),
      }));
      const front = campaignFront(project, campaignId);
      const latest = latestCampaignCompletion(project, campaignId);
      const completion = deriveCampaignCompletion({ probes, verdict: latest });
      return JSON.stringify({ campaignId, goal: campaign?.goal ?? null, probes: enriched, front, completion }, null, 2);
    }
    case 'drop_campaign': {
      const { project, campaignId } = args as { project?: string; campaignId?: string };
      if (!project) throw new Error('Missing required: project');
      if (!campaignId) throw new Error('Missing required: campaignId');
      const dropped = dropCampaign(project, campaignId);
      return JSON.stringify(dropped, null, 2);
    }
    default:
      return null;
  }
}
