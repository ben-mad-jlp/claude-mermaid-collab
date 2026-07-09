import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveNodeProvider, anyGrokNodeConfigured, anyXaiApiNodeConfigured, grokLedgerModel, grokModelForKind, xaiApiLedgerModel, resolveNodeModel } from '../node-provider';
import { setNodeProfileOverride, setProjectNodeProvider, _closeDb } from '../orchestrator-config';

// resolveNodeProvider precedence: mcp → per-kind DB → project DB → per-kind env → project
// env → claude. Isolate BOTH config.json (MERMAID_CONFIG_PATH) AND the orchestrator DB
// (MERMAID_SUPERVISOR_DIR) to temp so tests never touch the developer's real state.
const KEYS = ['MERMAID_NODE_PROVIDER', 'MERMAID_NODE_PROVIDER_IMPLEMENT', 'MERMAID_NODE_PROVIDER_BLUEPRINT', 'MERMAID_NODE_PROVIDER_REPORT'];
let cfgDir: string;
const P = '/proj/np-test';
function isolate() {
  for (const k of KEYS) delete process.env[k];
  cfgDir = mkdtempSync(join(tmpdir(), 'np-cfg-'));
  process.env.MERMAID_CONFIG_PATH = join(cfgDir, 'config.json'); // nonexistent → empty config
  process.env.MERMAID_SUPERVISOR_DIR = cfgDir;                   // fresh, empty orchestrator DB
  _closeDb();
}
beforeEach(isolate);
afterEach(() => {
  for (const k of KEYS) delete process.env[k];
  delete process.env.MERMAID_CONFIG_PATH;
  delete process.env.MERMAID_SUPERVISOR_DIR;
  _closeDb();
});

describe('resolveNodeProvider — precedence', () => {
  it('defaults to claude with no config (zero behaviour change)', () => {
    expect(resolveNodeProvider(P, 'implement', 'Read Edit Grep Glob Bash')).toBe('claude');
    expect(resolveNodeProvider(P, 'blueprint', 'Read Write Grep Glob Bash')).toBe('claude');
  });

  it('MCP-forced claude beats every other layer', () => {
    setProjectNodeProvider(P, 'grok-build');
    setNodeProfileOverride(P, 'report', null, null, 'grok-build'); // even an explicit per-kind grok…
    expect(resolveNodeProvider(P, 'report', 'Read Grep Glob mcp__mermaid__add_session_todo')).toBe('claude');
  });

  it('grok-api resolves as a provider (per-kind DB + env) and reports via anyXaiApiNodeConfigured', () => {
    setNodeProfileOverride(P, 'review', null, null, 'grok-api');
    expect(resolveNodeProvider(P, 'review', 'Read Grep Glob Bash')).toBe('grok-api');
    expect(anyXaiApiNodeConfigured(P)).toBe(true);
    expect(anyGrokNodeConfigured(P)).toBe(false); // grok-api is NOT grok-build (separate auth)
    // MCP still forces claude even over grok-api
    expect(resolveNodeProvider(P, 'review', 'Read mcp__x__y')).toBe('claude');
  });

  it('xaiApiLedgerModel is the flagship reasoner', () => {
    expect(xaiApiLedgerModel('review')).toBe('grok-4.3');
    expect(xaiApiLedgerModel('blueprint')).toBe('grok-4.3');
  });

  it('grokModelForKind defaults implement→composer-fast but honors a grok model override', () => {
    // default: implement is non-reasoning → composer-fast
    expect(grokModelForKind(P, 'implement')).toBe('grok-composer-2.5-fast');
    // override implement → grok-build (grok-build-0.1, the agentic coding model)
    setNodeProfileOverride(P, 'implement', 'grok-build', null, 'grok-build');
    expect(grokModelForKind(P, 'implement')).toBe('grok-build');
    // a claude alias override on a grok row is ignored → kind default
    setNodeProfileOverride(P, 'review', 'opus', null, 'grok-build');
    expect(grokModelForKind(P, 'review')).toBe('grok-build'); // review's own kind default (reasoning)
  });

  it('per-kind DB override wins over project DB default and env', () => {
    process.env.MERMAID_NODE_PROVIDER = 'claude'; // env says claude
    setProjectNodeProvider(P, 'claude');          // project default claude
    setNodeProfileOverride(P, 'implement', null, null, 'grok-build'); // per-kind DB grok
    expect(resolveNodeProvider(P, 'implement', 'Read Edit Bash')).toBe('grok-build');
    expect(resolveNodeProvider(P, 'blueprint', 'Read Write Bash')).toBe('claude');
  });

  it('project DB default applies when no per-kind override', () => {
    setProjectNodeProvider(P, 'grok-build');
    expect(resolveNodeProvider(P, 'implement', 'Read Edit Bash')).toBe('grok-build');
    expect(resolveNodeProvider(P, 'report', 'Read mcp__mermaid__add_session_todo')).toBe('claude'); // mcp guard
  });

  it('DB beats the env/config knob (UI is authoritative)', () => {
    process.env.MERMAID_NODE_PROVIDER_IMPLEMENT = 'grok-build'; // env wants grok
    setNodeProfileOverride(P, 'implement', null, null, 'claude'); // DB pins claude
    expect(resolveNodeProvider(P, 'implement', 'Read Edit Bash')).toBe('claude');
  });

  it('falls through to the env knob when no DB config', () => {
    process.env.MERMAID_NODE_PROVIDER_IMPLEMENT = 'grok-build';
    expect(resolveNodeProvider(P, 'implement', 'Read Edit Bash')).toBe('grok-build');
    expect(resolveNodeProvider(P, 'blueprint', 'Read Write Bash')).toBe('claude');
  });

  it('ignores invalid provider values', () => {
    process.env.MERMAID_NODE_PROVIDER = 'gpt-9';
    expect(resolveNodeProvider(P, 'implement', 'Read Edit Bash')).toBe('claude');
  });

  it('resolves with no project (undefined) via env only', () => {
    process.env.MERMAID_NODE_PROVIDER_IMPLEMENT = 'grok-build';
    expect(resolveNodeProvider(undefined, 'implement', 'Read Edit Bash')).toBe('grok-build');
  });
});

describe('anyGrokNodeConfigured', () => {
  it('false when nothing configured', () => {
    expect(anyGrokNodeConfigured(P)).toBe(false);
  });
  it('true on a project DB default', () => {
    setProjectNodeProvider(P, 'grok-build');
    expect(anyGrokNodeConfigured(P)).toBe(true);
  });
  it('true on a per-kind DB override', () => {
    setNodeProfileOverride(P, 'implement', null, null, 'grok-build');
    expect(anyGrokNodeConfigured(P)).toBe(true);
  });
  it('true on an env knob', () => {
    process.env.MERMAID_NODE_PROVIDER_IMPLEMENT = 'grok-build';
    expect(anyGrokNodeConfigured(P)).toBe(true);
  });
});

describe('grokLedgerModel', () => {
  it('reasoning kinds → grok-build; others → composer-fast', () => {
    expect(grokLedgerModel('blueprint')).toBe('grok-build');
    expect(grokLedgerModel('review')).toBe('grok-build');
    expect(grokLedgerModel('implement')).toBe('grok-composer-2.5-fast');
  });
});

describe('resolveNodeModel — defensive override validation', () => {
  it('claude provider returns the default when override is absent', () => {
    expect(resolveNodeModel(P, 'implement', 'claude', 'opus')).toBe('opus');
  });

  it('grok-build provider returns default when override is absent', () => {
    expect(resolveNodeModel(P, 'implement', 'grok-build', 'unused')).toBe('grok-composer-2.5-fast');
  });

  it('grok-api provider returns grok-4.3 default when override is absent', () => {
    expect(resolveNodeModel(P, 'implement', 'grok-api', 'unused')).toBe('grok-4.3');
  });

  it('claude provider honors a valid claude model override', () => {
    setNodeProfileOverride(P, 'implement', 'sonnet', null, 'claude');
    expect(resolveNodeModel(P, 'implement', 'claude', 'opus')).toBe('sonnet');
  });

  it('grok-build provider honors a valid grok-build model override', () => {
    setNodeProfileOverride(P, 'implement', 'grok-build-0.1', null, 'grok-build');
    expect(resolveNodeModel(P, 'implement', 'grok-build', 'unused')).toBe('grok-build-0.1');
  });

  it('grok-api provider honors a valid grok-api model override', () => {
    setNodeProfileOverride(P, 'implement', 'grok-4.3', null, 'grok-api');
    expect(resolveNodeModel(P, 'implement', 'grok-api', 'unused')).toBe('grok-4.3');
  });

  it('claude provider ignores a mismatched override and returns default + warns', () => {
    const consoleSpy = console.warn;
    let warnCalled = false;
    console.warn = (...args: unknown[]) => {
      if (String(args[0]).includes('provider/model mismatch')) {
        warnCalled = true;
      }
    };
    setNodeProfileOverride(P, 'review', 'grok-4.3', null, null);
    const result = resolveNodeModel(P, 'review', 'claude', 'opus');
    expect(result).toBe('opus');
    expect(warnCalled).toBe(true);
    console.warn = consoleSpy;
  });

  it('grok-build provider ignores a mismatched override (claude model) and returns default', () => {
    setNodeProfileOverride(P, 'implement', 'opus', null, null);
    const result = resolveNodeModel(P, 'implement', 'grok-build', 'unused');
    expect(result).toBe('grok-composer-2.5-fast');
  });

  it('grok-api provider ignores a mismatched override (claude model) and returns default', () => {
    setNodeProfileOverride(P, 'implement', 'opus', null, null);
    const result = resolveNodeModel(P, 'implement', 'grok-api', 'unused');
    expect(result).toBe('grok-4.3');
  });

  it('returns default when DB access fails (defensive)', () => {
    // This simulates a scenario where DB read fails; the function should fall back gracefully
    const result = resolveNodeModel(undefined, 'implement', 'grok-build', 'unused');
    expect(result).toBe('grok-composer-2.5-fast');
  });
});
