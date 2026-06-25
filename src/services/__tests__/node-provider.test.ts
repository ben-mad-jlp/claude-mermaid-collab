import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { resolveNodeProvider, anyGrokNodeConfigured, grokLedgerModel } from '../node-provider';

// cfg() reads config.json first then env; in CI config.json has no MERMAID_NODE_PROVIDER*
// keys, so env drives these. Clean up after each test.
const KEYS = ['MERMAID_NODE_PROVIDER', 'MERMAID_NODE_PROVIDER_IMPLEMENT', 'MERMAID_NODE_PROVIDER_BLUEPRINT', 'MERMAID_NODE_PROVIDER_REPORT'];
function clearEnv() { for (const k of KEYS) delete process.env[k]; }

describe('resolveNodeProvider', () => {
  beforeEach(clearEnv);
  afterEach(clearEnv);

  it('defaults to claude with no config (zero behaviour change)', () => {
    expect(resolveNodeProvider('implement', 'Read Edit Grep Glob Bash')).toBe('claude');
    expect(resolveNodeProvider('blueprint', 'Read Write Grep Glob Bash')).toBe('claude');
  });

  it('MCP-forced claude: any mcp__ tool in the allowlist overrides config', () => {
    process.env.MERMAID_NODE_PROVIDER = 'grok-build';            // project says all-grok…
    expect(resolveNodeProvider('report', 'Read Grep Glob mcp__mermaid__add_session_todo')).toBe('claude'); // …but MCP forces claude
    expect(resolveNodeProvider('implement', 'Read Edit Grep Glob Bash')).toBe('grok-build'); // non-MCP follows config
  });

  it('per-kind override wins over project default', () => {
    process.env.MERMAID_NODE_PROVIDER = 'claude';
    process.env.MERMAID_NODE_PROVIDER_IMPLEMENT = 'grok-build';
    expect(resolveNodeProvider('implement', 'Read Edit Bash')).toBe('grok-build');
    expect(resolveNodeProvider('blueprint', 'Read Write Bash')).toBe('claude'); // project default
  });

  it('the controlled-experiment shape: implement→grok, blueprint/review→claude', () => {
    process.env.MERMAID_NODE_PROVIDER_IMPLEMENT = 'grok-build';
    expect(resolveNodeProvider('implement', 'Read Edit Bash')).toBe('grok-build');
    expect(resolveNodeProvider('blueprint', 'Read Write Bash')).toBe('claude');
    expect(resolveNodeProvider('review', 'Read Grep Bash')).toBe('claude');
  });

  it('ignores invalid provider values (falls through to default)', () => {
    process.env.MERMAID_NODE_PROVIDER = 'gpt-9';
    expect(resolveNodeProvider('implement', 'Read Edit Bash')).toBe('claude');
  });
});

describe('anyGrokNodeConfigured', () => {
  beforeEach(clearEnv);
  afterEach(clearEnv);

  it('false when nothing configured', () => {
    expect(anyGrokNodeConfigured()).toBe(false);
  });
  it('true on a project default', () => {
    process.env.MERMAID_NODE_PROVIDER = 'grok-build';
    expect(anyGrokNodeConfigured()).toBe(true);
  });
  it('true on any per-kind override', () => {
    process.env.MERMAID_NODE_PROVIDER_IMPLEMENT = 'grok-build';
    expect(anyGrokNodeConfigured()).toBe(true);
  });
});

describe('grokLedgerModel', () => {
  it('reasoning kinds → grok-build-0.1; others → composer-fast', () => {
    expect(grokLedgerModel('blueprint')).toBe('grok-build-0.1');
    expect(grokLedgerModel('review')).toBe('grok-build-0.1');
    expect(grokLedgerModel('implement')).toBe('grok-composer-2.5-fast');
  });
});
