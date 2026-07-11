# Implementation: remove-file-writes

## Changes

### src/mcp/tools/snippet.ts
- Removed `outputPath` property from `exportSnippetSchema`
- Removed `outputPath` param from `handleExportSnippet` function signature
- Removed `writeFile` call and temp file logic; now returns content directly
- Updated `ExportSnippetResult` interface: replaced `filePath`/`size` with `content`
- Removed unused imports: `join` from `path`, `tmpdir` from `os`

### src/mcp/tools/design-ai.ts
- Removed `outputPath` property from `exportDesignSvgSchema`
- Removed `outputPath` property from `exportDesignCodeSchema`
- Removed `outputPath` param from `handleExportDesignSvg` signature; removed `if (outputPath)` writeFile block
- Removed `outputPath` param from `handleExportDesignCode` signature; removed `if (outputPath)` writeFile block
- Removed unused `writeFile` import from `fs/promises`

### src/mcp/setup.ts
- Updated `export_design_svg` case: removed `outputPath` from destructuring and handler call
- Updated `export_design_code` case: removed `outputPath` from destructuring and handler call
- Updated `export_snippet` case: removed `outputPath` from destructuring and handler call
- Updated `export_design_svg` tool description to say "Returns SVG string" instead of "Optionally saves to file"

## Verification
- Type-checked with `tsc --noEmit` — no new errors introduced (all errors are pre-existing)
