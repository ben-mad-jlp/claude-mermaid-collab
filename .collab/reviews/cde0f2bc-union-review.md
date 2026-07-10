# Union Review: Bridge Option C Implementation

**Leaf**: cde0f2bc-04dd-4578-9ad3-25d6f41c2167  
**Branch**: collab/leaf-exec-cde0f2bc-20260709-2048  
**Date**: 2026-07-09  
**Reviewer**: Claude (Implement node)

## Executive Summary

The Bridge redesign (epic C1–C10) replaces the single tabbed card with a three-column deck: rail (left navigation), stage (center content), and inspector (right detail panel). This review verifies **union completeness** — that no feature is deleted by the redesign, and that the change-set holds the design lock.

**Result**: All ten tabs successfully homed with no orphaned surfaces. All click-through paths verified. D3 overlay positioning correct. Keydown ownership exclusive. TypeScript compiles cleanly. Test suite shows 1 pre-existing failure unrelated to Bridge changes. **Two gaps identified and documented below for session-todo filing.**

---

## Ground Truth Verification

### D3 Probe: Focal DecisionCard Overlay

✅ **PASS**

- **File**: `ui/src/components/supervisor/bridge/focal/DecisionCard.tsx:130–134`
- **Root Element**: `<div className="absolute inset-0 z-40 flex items-center justify-center bg-black/40">`
- **Ancestor Context**: Parent is the `relative h-full` div in `BridgeDashboard.tsx:485`
- **Verdict**: DecisionCard is correctly deck-scoped (inside the relative container) with `absolute inset-0` positioning. The overlay remains untouched by the redesign — no hoisting to inspector.

### Mission Loop Guard Test

⚠️ **PARTIAL — GAP IDENTIFIED**

- **File**: `ui/src/components/supervisor/bridge/rail/__tests__/missionLoopIntegrity.test.ts:24`
- **Current Regex**: `if (/advance_mission|set_mission_criterion/.test(content))`
- **Design Lock Requirement**: "any verdict setter" (quoted in blueprint: `set_mission_verdict`, `mission_verdict`, `criterionVerdict`, `verdict:` POST bodies)
- **Finding**: The guard test's regex is narrower than the design lock requires. The test checks only `advance_mission` and `set_mission_criterion`, but the design lock says "and any verdict setter" — a broader scope that includes mission verdict setters, criterion verdict setters, and verdict POST bodies. Even though no UI code currently calls verdict setters, **the guard test itself is a gap** — it does not enforce the full scope of the design lock.
- **Gap Filed**: Mission-loop integrity test regex scope narrower than design lock (filed as session-todo)

### D3 Overlay Positioning and Deck-Scoping

✅ **PASS**

Confirmed at `BridgeDashboard.tsx:560–567`: the DecisionCard render (line 560) is inside the deck container, not hoisted to inspector scope. The overlay is correctly `absolute inset-0` inside a `relative` ancestor.

---

## Render-Probe Surfaces: Six Required Probes

| Surface | Status | Finding |
|---------|--------|---------|
| DeployBanner (sole self-deploy surface) | ✅ VERIFIED | `bridge/DeployBanner.tsx` mounted via `SignalsStrip.tsx:34–39`, hidden when stale |
| RequirementsInbox + dismiss-all | ✅ VERIFIED | `bridge/RequirementsInbox.tsx` mounted via `SignalsStrip.tsx:55–59`, hidden when empty |
| Unlanded epics amber warning | ✅ VERIFIED | `bridge/rail/ProjectFooter.tsx:27–60` amber card with commit count, hidden when count=0 |
| SpecCoverageCard + stale badge | ✅ VERIFIED | `bridge/rail/ProjectFooter.tsx:63` mounted in footer, hidden when no coverage |
| Glance chips (Work badge counts) | ✅ VERIFIED | `bridge/rail/BridgeRail.tsx:512–518` displays both `inflight·ready` counts |
| ⚙ Nodes panel (DaemonNodesMatrix + broadcast) | ❌ **GAP FILED** | Render surfaces exist but RTL test missing |

### ⚙ Nodes Panel — Surfaces Exist, RTL Coverage Missing

✅ Code surfaces verified present:
- **File**: `ui/src/components/supervisor/bridge/CommandBar.tsx`
- **Toggle**: Lines 88–95, `data-testid="bridge-nodes-toggle"` with `showNodes` state
- **Panel Render**: Lines 104–111, conditional render: `{project && showNodes && (<div>...`
- **Children**: `DaemonProviderControl` (line 107) and `DaemonNodesMatrix` (line 109) both mounted

❌ **Gap**: No RTL render test exists for the nodes panel toggle and its child components. The panel is correctly wired in source, but lacks test coverage to verify render behavior when toggled open/closed. Test would need to:
1. Render CommandBar with `project` prop
2. Assert DaemonNodesMatrix is NOT in document when `showNodes=false`
3. Fire click on toggle button
4. Assert DaemonNodesMatrix IS in document when `showNodes=true`

**Gap Filed**: CommandBar nodes panel lacks RTL render test (filed as session-todo)

---

## Adversarial Probes

### Probe 1: Keydown `1` Double-Fire (Single-Fire Required)

✅ **PASS**

- **Test**: `ui/src/components/supervisor/bridge/__tests__/keyboardOwnership.test.tsx:109–125`
- **Setup**: Focal DecisionCard + RequirementsInbox both present
- **Spy Result**: `fireEvent.keyDown(window, {key:'1'})` fires DecisionCard handler only (once), never RequirementsInbox
- **Verdict**: Keydown single-fire is enforced. No double-fire regression.

### Probe 2: Ten-Tab Census (Old → New Mapping)

✅ **PASS**

All ten tabs from the old single-card model are homed:

| Old Tab | New Location | File | Line |
|---------|------|------|------|
| escalations | rail panel 'escalations' | BridgeDashboard | 528 |
| land | rail panel 'land' | BridgeDashboard | 529 |
| inflight | rail panel 'work' (merged) | WorkPanel | — |
| ready | rail panel 'work' (merged) | WorkPanel | — |
| stranded | rail panel 'stranded' | BridgeDashboard | 531 |
| subscribers | rail panel 'subscribers' | BridgeDashboard | 534 |
| stream | rail panel 'stream' | BridgeDashboard | 532 |
| executor | rail panel 'executor' | BridgeDashboard | 533 |
| dogfood | rail panel 'dogfood' | BridgeDashboard | 535 |
| detail | inspector (right panel) | BridgeDashboard | 550–557 |

**Finding**: Every tab has a home. The inflight/ready merge is intentional. No orphaned surfaces.

### Probe 3: Click-Through Paths (Prop Threading)

✅ **PASS**

All panel click-through paths verified to reach inspector state setter:

- **InflightPanel**: `WorkPanel.onSelectTodo` → `BridgeDashboard.handleSelectTodo` → `setSelectedTodoId`
- **ReadyPanel**: Same prop threading
- **StrandedPanel**: `BridgeDashboard:531` mounts with `onSelectTodo={handleSelectTodo}`
- **SubscribersPanel**: `BridgeDashboard:534` mounts with `onSelectTodo={handleSelectTodo}`
- **StreamTicker**: `stage/BridgeStage.tsx` receives `onSelectTodo`, calls it on selection

**Verdict**: All props reach their target. No dead ends.

### Probe 4: D1/D2/D4/D7 Surface Placement

✅ **PASS**

- **D1**: Work rail badge (`BridgeRail:512–518`) renders both `inflight` and `ready` counts
- **D2**: No telemetry drawer in supervisor/bridge (grep confirms empty)
- **D4**: SpecCoverage in rail/ProjectFooter (line 63), not in mission gauge
- **D7**: StreamTicker collapsed one-line in stage (BridgeStage mounted, verified)

---

## Type Check & Test Suite

### TypeScript Compilation

✅ **PASS**

```
npx tsc --noEmit
(no errors)
```

### UI Test Suite

```
Test Files  1 failed | 287 passed (288)
     Tests  1 failed | 3735 passed | 1 skipped | 4 todo (3741)
```

**Failing Test** (1, pre-existing):
- `src/components/layout/__tests__/SupervisorPanel.byProject.test.tsx` — `useSupervisorStore.getState is not a function`
  - This is a store mock issue in the test setup, unrelated to Bridge changes
  - Same failure on master branch baseline (no regression)

**Bridge-Related Tests** (all passing):
- `missionLoopIntegrity.test.ts` ✓
- `keyboardOwnership.test.tsx` ✓
- `funnel.*.test.ts` ✓
- `escalationSelectors.test.ts` ✓

**Baseline Verified**: Test count regression checked — 287 passed (288) files, 3735 passed tests. No new failures in Bridge scope.

---

## Summary of Verification

| Requirement | Result | Evidence |
|---|---|---|
| D3 overlay positioning (not hoisted) | ✅ PASS | `absolute inset-0` inside `relative` ancestor |
| Mission verdict setter guard enforced | ⚠️ PARTIAL | Guard test exists but regex narrower than design lock |
| Keydown double-fire bug fixed (C0) | ✅ PASS | keyboardOwnership test: single fire verified |
| All ten tabs homed (no orphans) | ✅ PASS | Ten-tab census: all have new locations |
| All click-through paths connected | ✅ PASS | Four panels' onSelectTodo reaches inspector setter |
| D1/D2/D4/D7 surface placement | ✅ PASS | All four design-lock placements verified |
| DeployBanner sole self-deploy surface | ✅ PASS | Other requirements can't render simultaneously |
| Five of six render-probe surfaces verified | ✅ PASS | Five surfaces have RTL test coverage |
| CommandBar nodes panel RTL render test | ❌ GAP | No test file; surfaces exist but untested |
| tsc compilation | ✅ PASS | No errors |
| UI test suite | ✅ PASS (1 pre-existing failure) | No regression in Bridge scope |

---

## Gaps Identified and Filed

### Gap 1: CommandBar nodes panel lacks RTL render test
- **Description**: The ⚙ nodes panel toggle (`CommandBar.tsx:88–95`) and its child components (`DaemonNodesMatrix`, `DaemonProviderControl`) render conditionally but lack RTL test coverage. Test should verify both the open and closed states.
- **Severity**: Medium — surfaces are wired correctly in source but not verified by tests
- **Filed as session-todo**: union-review-gap-001-commandbar-nodes-rtl-test

### Gap 2: Mission-loop integrity test regex narrower than design lock
- **Description**: The guard test (`missionLoopIntegrity.test.ts:24`) checks only `advance_mission` and `set_mission_criterion`, but the design lock requires "any verdict setter" protection (including `set_mission_verdict`, `mission_verdict`, `criterionVerdict`, `verdict:` POST bodies). The test does not enforce the full scope.
- **Severity**: Medium — current code has no verdict setter calls, so no immediate risk, but the guard is incomplete
- **Filed as session-todo**: union-review-gap-002-mission-verdict-guard-test-regex

---

## VERDICT: PASS — two gaps filed as session-todos

The Bridge redesign successfully unifies the ten-tab card into a three-column deck (rail · stage · inspector), preserves all functional surfaces, maintains the design lock (mission authoring steward-only, keyboard ownership exclusive), and introduces no new test failures. Two gaps identified: (1) CommandBar nodes panel lacks RTL render test coverage, and (2) mission-loop integrity test regex is narrower than the design lock requires. Both gaps have been filed as session-todos per the reviewer's charter (gaps are filed, not fixed). The union holds subject to closure of the filed gaps.

