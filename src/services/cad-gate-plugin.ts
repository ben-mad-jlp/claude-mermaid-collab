/**
 * CAD gate plugin (design-system-object-primitive §8 Phase 1, plugin #1).
 *
 * Wires the PURE, TESTED `runCadGate` (cad-gate-runner.ts) into the gate registry
 * as the first domain plugin — the concrete first win: the orphaned deterministic
 * CAD gate goes LIVE. When a CAD todo has produced a step artifact + its analyzer
 * metrics, this plugin (domain tier) is resolved AHEAD of a project's generic
 * gateCommand adapter (project tier), so a mechanism whose fitness is a number is
 * judged by the deterministic code invariant — not self-certified by the worker.
 *
 * ZERO durable schema (Phase 1 constraint): the "cad:step artifact" is a plain
 * JSON file the worker/bsync analyzers write next to the exported STEP, at a
 * conventional path. Its presence is the appliesTo signal; its contents
 * ({ metrics, spec, thresholds? }) are the runCadGate inputs. No DB, no migration.
 *
 * This is a DOMAIN module — the gate-runner.ts core stays domain-free and learns
 * nothing about CAD; this file self-registers on import.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  runCadGate,
  type CadMetrics,
  type CadGateSpec,
  type CadGateThresholds,
} from './cad-gate-runner';
import { registerGatePlugin, type GatePlugin, type GateSubject } from './gate-runner';
import type { GateVerdict } from './coordinator-daemon';

/** The on-disk CAD gate artifact a worker emits alongside its exported STEP. Its
 *  presence in the gate repo is what "obj has a cad:step artifact" means today. */
interface CadGateArtifact {
  metrics: CadMetrics;
  spec: CadGateSpec;
  thresholds?: CadGateThresholds;
}

/** Conventional path of the CAD gate artifact for a todo, in the gate repo. */
export function cadGateArtifactPath(gateProject: string, todoId: string): string {
  return join(gateProject, '.collab', 'cad', `${todoId}.gate.json`);
}

/** Read + parse the CAD gate artifact, or null when absent/unparseable/malformed. */
function readCadGateArtifact(gateProject: string, todoId: string): CadGateArtifact | null {
  const path = cadGateArtifactPath(gateProject, todoId);
  try {
    if (!existsSync(path)) return null;
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    if (parsed && typeof parsed === 'object' && parsed.metrics && parsed.spec) {
      return parsed as CadGateArtifact;
    }
  } catch { /* a malformed artifact is treated as absent here; run() fails closed */ }
  return null;
}

export const cadGatePlugin: GatePlugin = {
  id: 'cad-step',
  tier: 'domain',
  // Applies when this todo's deliverable is a CAD step artifact with metrics —
  // i.e. the conventional gate artifact exists in the gate repo for this todo.
  appliesTo: (obj: GateSubject) => readCadGateArtifact(obj.gateProject, obj.todoId) !== null,
  run: async (ctx: GateSubject): Promise<GateVerdict | null> => {
    const artifact = readCadGateArtifact(ctx.gateProject, ctx.todoId);
    if (!artifact) {
      // appliesTo saw an artifact that has since vanished/corrupted → fail CLOSED:
      // a CAD deliverable we cannot deterministically verify must not pass.
      return { passed: false, reasons: ['cad:step gate artifact missing or unreadable at run time'] };
    }
    const verdict = runCadGate(artifact.metrics, artifact.spec, artifact.thresholds);
    return {
      passed: verdict.pass,
      reasons: verdict.reasons.filter((r) => !r.pass).map((r) => `${r.check}: ${r.detail}`),
      metrics: {
        thresholdsVersion: verdict.thresholdsVersion,
        checks: verdict.reasons.map((r) => ({ check: r.check, pass: r.pass })),
      },
    };
  },
};

registerGatePlugin(cadGatePlugin);
