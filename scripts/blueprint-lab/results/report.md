# blueprint-lab report

- total cases: 77
- parsed: 42
- unparsed: 35 (4f30aa57, 6839bcc4, 6c3ce0b9, 72658d6d, 73ef63d6, 75828d39, 7c340a9a, 873e24fd, 8a2efaf6, 90ba58d9, 929910f1, 99f156b9, 9e506ad4, a4d8a493, a7d91455, b2de6979, b3f165cd, b885debd, b9134768, ba037b12, bc6ec69e, c2e6f88f, c69d7d35, ccde8d7e, cf490efb, d329744a, dabc980d, db8fd872, ee9aee37, f6233fef, f78d19a6, f8fa94d3, fbb7e001, fec75a4b, fedfd37c)
- blueprint model=sonnet effort=medium

## Corpus provenance

- total cases: 77
- corpus pinned to 7f473bf8's case list
- MATCH against baseline total of 77

| id | reason |
| --- | --- |
| none | none |

## Acceptance table

| id | title | leafKind expected | leafKind actual | validation | file match rate |
| --- | --- | --- | --- | --- | --- |
| 0b71906b | Test: pinning a converged or abandoned mission clears the pin and drives nothing | feature | test | missing:named-test | 100.0% |
| 0c1c2a86 | approveMission store action + Approve button in the mission detail view | feature | feature | missing:symbol-present | 66.7% |
| 0c1d3816 | align with container-close guard + bucket dedup | test | test | missing:named-test | 100.0% |
| 0c4766c3 | Live-evidence harness: two consecutive sweeps over the self/live project | feature | test | missing:named-test | 0.0% |
| 16a71d67 | Single resolvedPort() + config.json port key | feature | refactor | missing:symbol-present | 33.3% |
| 1a7bbd85 | Teach the UI status vocabulary the 'unapproved' mission status | feature | feature | missing:symbol-present | 66.7% |
| 1f8531ed | Live end-to-end sweep-measurement harness script | feature | test | missing:named-test | 0.0% |
| 2465dacc | wire the autonomous LAND path (conductor actor + ownership-gated) | feature | feature | missing:symbol-present | 66.7% |
| 277c10d1 | Fix findLandedAtDivergence: landed satisfies, stranded still violates | feature | fix | missing:symbol-present | 100.0% |
| 27a58a65 | Pin-as-conductor-target control in the mission rail + store action | feature | feature | missing:symbol-present | 66.7% |
| 296f7901 | list-badge status keys off criteria, not epics | fix | fix | missing:symbol-present | 100.0% |
| 2aa92d7a | GC orphan collab/epic branches (no live epic todo) | fix | feature | missing:symbol-present | 40.0% |
| 32d04f86 | run to LAND a build-green epic (don't building-wait past its land card) | fix | fix | missing:symbol-present | 100.0% |
| 37d2639d | Prove DaemonNodesMatrix renders and edits the forge/conductor/planner rows | feature | test | missing:named-test | 100.0% |
| 38447d5a | Add an orchestration-node registry and make forge/conductor/planner read their defaults from it | feature | refactor | missing:symbol-present | 42.9% |
| 3d22e9ca | repair tsc-red master base — add landedEpicSweep to passesForLevel test expectations | fix | test | missing:named-test | 100.0% |
| 44187e80 | Branch GC: delete only if fully-on-master, else flag + recover tip | feature | fix | missing:symbol-present | 0.0% |
| 465d8237 | unwedge master tsc — orchestrator-live test asserts archival tick flag | fix | fix | missing:symbol-present | 100.0% |
| 4f30aa57 | Emission runner: run REAL blueprint node at daemon real model to emit a v2 DiffContract | feature | n/a | parse-null | n/a |
| 51fcbaa6 | Offline end-to-end harness test + exportable score/gate wiring + fixture mode | feature | test | missing:named-test | 33.3% |
| 556c96e2 | live validation PASSED end-to-end (throwaway repo, real nodes, landed to master) | feature | infra | missing:symbol-present | 100.0% |
| 594d741c | Seed specJson at blueprint persist and route reattach through restoreEditableBlueprint | feature | feature | missing:symbol-present | 100.0% |
| 597bd3c1 | Throttle + orchestrator wiring for the landed-epic sweep | feature | feature | missing:symbol-present | 66.7% |
| 62b34feb | Corpus builder: mine ≥10 historical landed leaves spanning ≥3 leafKinds with their real base..HEAD diffs | feature | infra | missing:symbol-present | 0.0% |
| 6839bcc4 | Throttled archival sweep pass (chunked + yielding, off the loop) | feature | n/a | parse-null | n/a |
| 6c3ce0b9 | Enforce a mission-creation ceiling in the mission store + creation paths | feature | n/a | parse-null | n/a |
| 72658d6d | Enqueue instead of deactivate on create_mission / forge / approve | feature | n/a | parse-null | n/a |
| 73ef63d6 | Paginate GET /api/supervisor/missions, drop per-request unbounded fact collection, and prove bounds at 20k synthetic archive | feature | n/a | parse-null | n/a |
| 75828d39 | Conductor status indicator in the Bridge CommandBar | feature | n/a | parse-null | n/a |
| 7c340a9a | Make live mode preflight the real conductor and fail loudly instead of skipping | feature | n/a | parse-null | n/a |
| 8039dbe7 | Serve and accept the orchestration kinds on the node-profiles route | feature | feature | missing:symbol-present | 33.3% |
| 81f8f5de | Assert the two-tick drive and clean pin clearing from observed per-tick evidence | feature | test | missing:named-test | 100.0% |
| 835c2e4c | Add editable specJson/specRev to leaf_blueprint with edit + restore accessors | feature | feature | missing:symbol-present | 100.0% |
| 873e24fd | Regression tests: rival-preservation, approval-gate, idempotent promotion | feature | n/a | parse-null | n/a |
| 8a2efaf6 | Create diff-contract.ts with the v2 type, parseDiffContract (fail-safe) and renderContract (round-trip) | feature | n/a | parse-null | n/a |
| 8c054756 | Orchestrator + report + GATE verdict | feature | feature | missing:symbol-present | 100.0% |
| 90ba58d9 | Add an HTTP transport mode to the pin smoke so it can drive the deployed server | feature | n/a | parse-null | n/a |
| 929910f1 | 0700 per-user run dir with port-scoped lock/pid/run files | feature | n/a | parse-null | n/a |
| 980c5c24 | Per-instance CDP/proxy port and collision-free tab registry keying | feature | feature | missing:symbol-present | 40.0% |
| 99f156b9 | Fold same-pass queued-mission promotion into runLandedEpicSweep | feature | n/a | parse-null | n/a |
| 9e506ad4 | doc→node forge + mission approval (Phase 1 of autonomous conductor) | feature | n/a | parse-null | n/a |
| a4d8a493 | forge_mission — mechanize the mission constitution into machinery | feature | n/a | parse-null | n/a |
| a6d70f99 | Live two-mission pin measurement against the deployed app | feature | test | missing:named-test | 0.0% |
| a7d91455 | Archive storage layer: archivedAt column, partial indexes, and archive-excluding hot reads | feature | n/a | parse-null | n/a |
| b2de6979 | Make emit.ts run at the daemon's real blueprint model and persist failure diagnostics | feature | n/a | parse-null | n/a |
| b3f165cd | Tests: fail-safe parse, round-trip, v1/v2 parseSizeManifest parity, strictness matrix + repair citation | feature | n/a | parse-null | n/a |
| b6d256c1 | acquit output-artifact content assertions (unblock daemon measurement work) | fix | fix | missing:symbol-present | 100.0% |
| b885debd | prune stale post-land worktrees so fully-on-master branches GC | fix | n/a | parse-null | n/a |
| b9134768 | Deterministic test: same-pass activation + two-run idempotence | feature | n/a | parse-null | n/a |
| ba037b12 | Round-trip targetMissionId through GET/POST /api/supervisor/conductor | feature | n/a | parse-null | n/a |
| bc6ec69e | planner node + plan_mission_criterion; conductor delegates planning (Phase 3) | feature | n/a | parse-null | n/a |
| bdd4ea79 | Show and clear the current conductor target in ProjectSettingsModal | feature | feature | missing:symbol-present | 100.0% |
| c02a97ce | Unit test: measurement primitive over synthetic fixture + idempotence | feature | test | missing:named-test | 100.0% |
| c2e6f88f | Add validateContractForKind with the §4 strictness matrix and underspecified/missingField reporting | feature | n/a | parse-null | n/a |
| c2f0716c | edit_leaf_requirement MCP tool + end-to-end poison-trap test | feature | feature | missing:symbol-present | 50.0% |
| c69d7d35 | Port file written on bind; hooks + CLI read it and fail closed | feature | n/a | parse-null | n/a |
| cac7af6e | Conductor toggle in ProjectSettingsModal + shared useConductorEnabled hook | feature | feature | missing:symbol-present | 66.7% |
| ccde8d7e | History view + restore path (lossless round-trip) | feature | n/a | parse-null | n/a |
| cf490efb | break the debounce deadlock + harden planner JSON parse | fix | n/a | parse-null | n/a |
| d0c4cb52 | REST approve route delegating to handleMissionTool('approve_mission') | feature | feature | missing:symbol-present | 50.0% |
| d329744a | Right-size the corpus to ≥10 real leaves spanning ≥3 leafKinds | feature | n/a | parse-null | n/a |
| dabc980d | Composed convergence+land sweep measurement primitive | feature | n/a | parse-null | n/a |
| db8fd872 | Drive the criterion verdict over the deployed server's /mcp endpoint in live mode | feature | n/a | parse-null | n/a |
| e55114a0 | Honor the pin in runConductorPass with no-fallback and lazy auto-clear | feature | feature | missing:symbol-present | 100.0% |
| e6706c86 | queuePos column + enqueue/promote store primitives in mission-store | feature | feature | missing:symbol-present | 100.0% |
| e681766b | Add live conductor-pin evidence harness script | feature | infra | missing:symbol-present | 0.0% |
| eaad6c73 | Test the cap rejects/throttles bulk mission creation | feature | test | missing:named-test | 0.0% |
| ee9aee37 | Land-card reconciliation core (idempotent stampEpicLandedAt) | feature | n/a | parse-null | n/a |
| eeaf47f4 | Make the pin's per-tick drive observable rather than inferred | feature | feature | missing:symbol-present | 20.0% |
| f60d57d5 | Scorer: validateContractForKind acceptance/rejection enumeration + declared-vs-actual match rate | feature | infra | missing:symbol-present | 100.0% |
| f6233fef | Make live-conductor-pin-evidence.ts scratch-scoped and tear down its missions | feature | n/a | parse-null | n/a |
| f78d19a6 | add ^scripts/ test lane so scripts/ spec files are gate-verifiable | feature | n/a | parse-null | n/a |
| f8fa94d3 | Wire deterministic promotion into the reconcile/conductor sweep | feature | n/a | parse-null | n/a |
| fbb7e001 | Add a repeatable two-mission live pin harness script | feature | n/a | parse-null | n/a |
| fec75a4b | Harden the live conductor-pin evidence harness so every assertion runs (no SKIP) | feature | n/a | parse-null | n/a |
| fedfd37c | Persist conductorTargetMissionId on watched_project with get/set accessors | feature | n/a | parse-null | n/a |
| ffe7bae7 | autonomous conductor node v1 (Phase 2) | feature | feature | missing:symbol-present | 85.7% |

## Rejection-mode breakdown

| mode | count | percentage |
| --- | --- | --- |
| missing:named-test | 11 | 14.3% |
| missing:symbol-present | 31 | 40.3% |
| parse-null | 35 | 45.5% |

## Match-rate summary

- mean file-match rate: 65.0%
- total matched: 60
- total undeclared-actual: 44
- total declared-but-untouched: 44
- leafKind mismatches: 19/77

## Baseline comparison (crit 7 @ 7f473bf8)

| mode | baseline count | baseline % | this run count | this run % |
| --- | --- | --- | --- | --- |
| accept | 37 | 48.1% | 0 | 0.0% |
| missing:named-test | 34 | 44.2% | 11 | 14.3% |
| parse-null | 6 | 7.8% | 35 | 45.5% |
| missing:symbol-present | 0 | 0.0% | 31 | 40.3% |

- acceptRate delta: -48.1pp (baseline 48.1%, this run 0.0%)
- baseline meanMatchRate: 59.5%

## GATE verdict

**ESCALATE** — acceptRate=0.0% < 70% threshold

Recommendation: prose+normalize fallback — the primary node still authors first; add a fallback pass that normalizes free-text blueprint prose into the v2 shape when the primary node fails to emit a parseable fence.
