/**
 * iOS Swift gate plugin (self-registering domain-tier plugin).
 *
 * Wires STRICT iOS Swift compilation + testing into the gate registry for type:'ios' leaves.
 * When an iOS leaf is gated, this domain-tier plugin is resolved AHEAD of the project's
 * generic manifest-command adapter (project tier), ensuring that type:'ios' leaves are
 * judged by actual Swift compilation/tests — not the placebo tsc --noEmit gate that
 * cannot compile Swift and silently accepts broken code.
 *
 * This is a DOMAIN module — the gate-runner.ts core stays domain-free and learns
 * nothing about iOS; this file self-registers on import.
 */
import { registerGatePlugin, lastLines, type GatePlugin, type GateSubject } from './gate-runner';
import type { GateVerdict } from './coordinator-daemon';

export const iosSwiftGatePlugin: GatePlugin = {
  id: 'ios-swift',
  tier: 'domain',
  // SYNC, cheap — keys off the leaf's agent-profile type, mirroring frontendSuiteGatePlugin.
  appliesTo: (_obj: GateSubject, type: string | null) => type === 'ios',
  run: async (ctx: GateSubject): Promise<GateVerdict | null> => {
    const cwd = ctx.laneCwd ?? ctx.gateProject;
    // Step (a): Core unit tests — headless-green 19/19, no simulator.
    const testCmd = 'cd ios/MermaidCollabCore && swift test';
    // Step (b): App compiles — .xcodeproj is gitignored so xcodegen must generate it first
    //           in the fresh worktree. Build-only (generic iOS Simulator dest, no boot), signing off.
    const buildCmd =
      'cd ios/MermaidCollab && /opt/homebrew/bin/xcodegen generate && ' +
      'xcodebuild -project MermaidCollab.xcodeproj -scheme MermaidCollab ' +
      '-destination "generic/platform=iOS Simulator" -configuration Debug ' +
      'CODE_SIGNING_ALLOWED=NO build';
    try {
      const t = await ctx.exec(['sh', '-c', testCmd], { cwd, capture: true });
      if (t.code !== 0) {
        return {
          passed: false,
          reasons: [
            'ios-swift gate: `swift test` failed in ios/MermaidCollabCore',
            lastLines(t.stdout + '\n' + t.stderr, 20),
          ],
        };
      }
      const b = await ctx.exec(['sh', '-c', buildCmd], { cwd, capture: true });
      if (b.code !== 0) {
        return {
          passed: false,
          reasons: [
            'ios-swift gate: xcodebuild failed for ios/MermaidCollab',
            lastLines(b.stdout + '\n' + b.stderr, 20),
          ],
        };
      }
      return { passed: true, reasons: [], metrics: { iosSwiftGate: true } };
    } catch (e) {
      // Fail CLOSED — an un-runnable gate blocks acceptance, never passes it.
      return {
        passed: false,
        reasons: [
          `ios-swift gate could not run: ${e instanceof Error ? e.message : String(e)}`,
        ],
      };
    }
  },
};

registerGatePlugin(iosSwiftGatePlugin);
