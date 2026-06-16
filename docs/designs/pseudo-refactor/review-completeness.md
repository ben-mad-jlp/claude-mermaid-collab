# Completeness Review

## Phase 0 — Relocate Shared Infra
| Item | Status | Notes |
|------|--------|-------|
| Rename kodexStore.ts -> projectStore.ts | DONE | `ui/src/stores/projectStore.ts` exists, no kodexStore.ts found |
| Hook useKodexStore -> useProjectStore | DONE | All references use useProjectStore |
| Move ProjectSelector.tsx to shared/ | DONE | Located at `ui/src/components/shared/ProjectSelector.tsx` |

## Phase 1 — Pseudo to SQLite
| Item | Status | Notes |
|------|--------|-------|
| NEW: src/services/pseudo-parser.ts | DONE | File exists, exports `parsePseudo` function |
| NEW: src/services/pseudo-db.ts | DONE | File exists with 4 tables + FTS5, singleton pattern |
| pseudo-db.ts has 15 methods | DONE | All 15 methods present: upsertFile, deleteFile, bulkIngest, listFiles, getFile, search, getReferences, getCallGraph, getExports, getFilesByDirectory, getImpactAnalysis, getOrphanFunctions, getStaleFunctions, getCoverage, close |
| parsePseudo.ts regex for both EXPORT orderings | DONE | Regex handles both `EXPORT [date]` and `[date] EXPORT` orderings |
| pseudo-api.ts 9 new endpoints | DONE | All 9 endpoints found in `src/routes/pseudo-api.ts`: /graph, /exports, /impact, /orphans, /stale, /coverage, /stats, /diagram, /directories |
| setup.ts 6 MCP tools | DONE | All 6 tools registered: pseudo_impact_analysis, pseudo_find_function, pseudo_get_module_summary, pseudo_call_chain, pseudo_stale_check, pseudo_coverage_report |
| setup.ts no kodex_* tools | DONE | No kodex_ references in setup.ts |
| server.ts background ingest | GAP | No pseudo DB ingest logic found in `src/mcp/server.ts`. Blueprint specified background ingest on startup but server.ts has no references to getPseudoDb, bulkIngest, or pseudo-db |
| No stubs/TODOs in implementation | DONE | No TODO, Not implemented, or NotImplementedError found in pseudo-parser.ts, pseudo-db.ts |

## Phase 2 — Rewire Onboarding
| Item | Status | Notes |
|------|--------|-------|
| onboarding-manager.ts: removed getDiagram/parseRelatedTopics/DiagramBlock | DONE | None of these symbols found in onboarding-manager.ts |
| onboarding-db.ts: topic_name -> file_path | DONE | Schema uses file_path, types use filePath |
| onboarding-db.ts: isPseudoDbReady | DONE | Method exists at line 372 |
| onboarding-api.ts (server): removed diagram endpoint | DONE | No diagram references in onboarding-api.ts |
| UI: onboarding-api.ts client uses filePath | DONE | All client types use filePath |
| UI: BrowseDashboard, TopicDetail, TopicGraph, SearchResults exist | DONE | All 4 components exist |
| UI: DiagramsTab deleted | DONE | DiagramsTab.tsx does not exist (only .pseudo file remains) |
| UI: OnboardingDashboard.tsx still uses topicName | GAP | `ui/src/pages/onboarding/OnboardingDashboard.tsx` has a `WhatNextSuggestion` interface with `topicName` (line 12) and multiple references to `topicName` throughout. Blueprint specifies types should use `filePath` not `topicName` |
| onboarding-db.test.ts still uses topicName | GAP | `src/services/__tests__/onboarding-db.test.ts` has assertions referencing `topicName` (lines 44, 57, 96) which should be `filePath` |

## Phase 3 — Remove Kodex
| Item | Status | Notes |
|------|--------|-------|
| Delete kodex-manager.ts | DONE | File does not exist |
| Delete kodex-api.ts (server) | DONE | File does not exist |
| Delete kodex UI pages/components | DONE | No kodex UI pages found |
| Delete kodex-api client | DONE | No kodex-api client found |
| Delete 10 skill dirs | DONE | No skills/kodex* directories found |
| Remove kodex from server.ts | DONE | No kodex references in server.ts |
| Remove kodex from setup.ts | DONE | No kodex references in setup.ts |
| Remove kodex from collab-manager.ts | DONE | No kodex references |
| Remove kodex from NavMenu.tsx | DONE | No kodex references |
| Remove kodex from main.tsx | GAP | `ui/src/main.tsx` line 10 has comment: "React Router for navigation between Collab and Kodex sections" |
| Remove kodex from App.tsx | GAP | `ui/src/App.tsx` has kodex variable names: `kodexProject`, `setKodexProject` (line 257), comments referencing "Kodex store" (line 256), "kodex/onboarding/pseudo" (line 982) |
| Sidebar test still references Kodex | GAP | `ui/src/components/layout/__tests__/Sidebar.test.tsx` has test "should render Kodex link" (lines 118-135) that checks for a `/kodex` route |
| OnboardingLayout.tsx references Kodex | GAP | Line 4 comment mentions "KodexLayout pattern", line 330 mentions "Kodex or Collab" in UI text |
| PseudoPage.test.tsx references kodex | GAP | Lines 39, 54 have comments mentioning "kodex store" |

## Summary of Gaps

### Critical (functional issues)
1. **server.ts missing background ingest** — Blueprint specifies pseudo DB background ingest on startup but no implementation exists in server.ts
2. **OnboardingDashboard.tsx uses topicName instead of filePath** — WhatNextSuggestion interface and logic still uses topicName (should be filePath per blueprint)
3. **onboarding-db.test.ts uses topicName** — Test assertions reference topicName instead of filePath

### Non-critical (leftover kodex references)
4. **App.tsx** — Variable names `kodexProject`/`setKodexProject` and comments still reference Kodex
5. **main.tsx** — Comment references Kodex
6. **OnboardingLayout.tsx** — Comment and UI text reference Kodex
7. **PseudoPage.test.tsx** — Comments reference kodex store
8. **Sidebar.test.tsx** — Test expects a Kodex link at `/kodex` route (may cause test failures if route was removed)

**Total: 8 gaps found (3 critical, 5 non-critical)**
