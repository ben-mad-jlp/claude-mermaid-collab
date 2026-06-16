/**
 * In-process collab funnel for worker-core tools (north-star §1/§6: diagram-as-spec).
 *
 * The worker runs IN the sidecar, so it reaches the collab artifact store DIRECTLY —
 * no MCP HTTP round-trip (the MCP create_diagram helper at setup.ts fetches /api/diagram;
 * a worker calling that would loop back into its own process). This exposes the two
 * diagram verbs the recipe needs: the research phase posts a before/after
 * diagram-as-spec into the run's session (visible in the collab UI), and the
 * verify/review phases read it back as the contract they judge against.
 *
 * Per-call DiagramManager (cheap, indexes a small per-session dir) keeps this stateless
 * and avoids holding handles; mirrors how the API route builds managers per request.
 */
import { DiagramManager } from './diagram-manager';
import { sessionRegistry } from './session-registry';

function managerFor(project: string, session: string): DiagramManager {
  return new DiagramManager(sessionRegistry.resolvePath(project, session, 'diagrams'));
}

/** Create a diagram in the run's collab session. Returns its id. */
export async function createWorkerDiagram(
  project: string,
  session: string,
  name: string,
  content: string,
): Promise<string> {
  const mgr = managerFor(project, session);
  await mgr.initialize();
  return mgr.createDiagram(name, content);
}

/** Read a diagram (the diagram-as-spec contract) back by id. Null if absent. */
export async function getWorkerDiagram(
  project: string,
  session: string,
  id: string,
): Promise<{ id: string; name: string; content: string } | null> {
  const mgr = managerFor(project, session);
  await mgr.initialize();
  const d = await mgr.getDiagram(id);
  return d ? { id: d.id, name: d.name, content: d.content } : null;
}
