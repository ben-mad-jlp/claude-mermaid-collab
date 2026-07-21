// Propagates the version from package.json into every file that carries a
// duplicated copy of it. Invoked by `npm version` (see package.json's
// "version" script) via `npm run version:sync`.
//
// Targets:
//   - .claude-plugin/plugin.json        (JSON field: .version)
//   - .claude-plugin/marketplace.json   (JSON field: .plugins[0].version)
//   - desktop/package.json              (JSON field: .version)
//   - src/mcp/server.ts                 (regex: const SERVER_VERSION = '...';)
//
// Each replacement is followed by a post-condition assertion: after writing,
// re-read the file and confirm it now contains the new version string in the
// expected shape. The JSON.stringify path can't silently no-op (the parsed
// object is mutated directly), but the regex replace against server.ts CAN
// silently no-op if the `const SERVER_VERSION = '...'` line format drifts
// (renamed const, different quote style, added type annotation, etc.) —
// String.replace() returns the original string unchanged when the pattern
// doesn't match, and the write would succeed while shipping a stale version.
// The assertion below turns that silent no-op into a hard, named failure.

import fs from 'fs';

function fail(file: string, detail: string): never {
  console.error(`version:sync FAILED for ${file}: ${detail}`);
  process.exit(1);
}

function assertContains(file: string, needle: string) {
  const contents = fs.readFileSync(file, 'utf-8');
  if (!contents.includes(needle)) {
    fail(file, `expected to find ${JSON.stringify(needle)} after the update, but it was not present (post-condition check failed)`);
  }
}

const v = JSON.parse(fs.readFileSync('package.json', 'utf-8')).version;
if (!v) {
  fail('package.json', 'could not read .version');
}

// .claude-plugin/plugin.json
{
  const file = '.claude-plugin/plugin.json';
  const p = JSON.parse(fs.readFileSync(file, 'utf-8'));
  p.version = v;
  fs.writeFileSync(file, JSON.stringify(p, null, 2) + '\n');
  const reread = JSON.parse(fs.readFileSync(file, 'utf-8'));
  if (reread.version !== v) {
    fail(file, `expected .version to be "${v}", found "${reread.version}"`);
  }
}

// .claude-plugin/marketplace.json
{
  const file = '.claude-plugin/marketplace.json';
  const m = JSON.parse(fs.readFileSync(file, 'utf-8'));
  m.plugins[0].version = v;
  fs.writeFileSync(file, JSON.stringify(m, null, 2) + '\n');
  const reread = JSON.parse(fs.readFileSync(file, 'utf-8'));
  if (reread.plugins?.[0]?.version !== v) {
    fail(file, `expected .plugins[0].version to be "${v}", found "${reread.plugins?.[0]?.version}"`);
  }
}

// desktop/package.json
{
  const file = 'desktop/package.json';
  const dp = JSON.parse(fs.readFileSync(file, 'utf-8'));
  dp.version = v;
  fs.writeFileSync(file, JSON.stringify(dp, null, 2) + '\n');
  const reread = JSON.parse(fs.readFileSync(file, 'utf-8'));
  if (reread.version !== v) {
    fail(file, `expected .version to be "${v}", found "${reread.version}"`);
  }
}

// src/mcp/server.ts — regex replace, so this is the one that can silently
// no-op if the line format drifts. Assert the new literal is actually present
// after the write.
{
  const file = 'src/mcp/server.ts';
  const before = fs.readFileSync(file, 'utf-8');
  const pattern = /const SERVER_VERSION = '[^']+';/;
  if (!pattern.test(before)) {
    fail(file, `pattern /const SERVER_VERSION = '[^']+';/ did not match anything in the file — the const declaration's format has drifted (renamed, re-typed, or re-quoted) and the regex needs updating`);
  }
  const after = before.replace(pattern, `const SERVER_VERSION = '${v}';`);
  fs.writeFileSync(file, after);
  assertContains(file, `const SERVER_VERSION = '${v}';`);
}

console.log(`version:sync OK — synced version ${v} to plugin.json, marketplace.json, desktop/package.json, src/mcp/server.ts`);
