# Packaging Station Implementation Plan - Updated for Riverpod

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement complete packaging station workflow for Flutter scanner app, including backend API consolidation, state management via Riverpod, services, and 5 UI screens.

**Architecture:**
- **Backend**: Consolidate station info endpoint to reduce API calls from 3 to 1. Implement printer service endpoints.
- **Frontend State**: Three Riverpod StateNotifiers manage workflow:
  - PackagingSessionNotifier: Session/division/station/workorders
  - PackagingStationNotifier: Workorder/container/pieces state
  - PackagingProgressNotifier: Progress tracking and box completion
- **Services**: PackagingService wraps API endpoints. QBContainerService used directly for move/nest operations.
- **UI**: 5 screens in state-based flow: Login → Select WO → Action → Unload (two variants) → back to Action/Login.

**Tech Stack:** C# / EF Core (backend), Dart / Flutter / Riverpod (frontend), Mermaid diagrams for documentation

**References:**
- Design docs: `docs/designs/packaging-station-design.md` and `docs/designs/packaging-station-implementation-spec.md`
- Diagrams: `docs/diagrams/packaging-*.mmd`
- Architecture: `docs/diagrams/packaging-implementation-architecture.mmd`
- Migration Guide: `riverpod-migration-guide.md` in mermaid-collab

---

## Task Summary

| Task | Component | Language | Status | Note |
|------|-----------|----------|--------|------|
| 1 | Consolidate Station Info Endpoint | C# | Ready | API backend |
| 2 | Implement Printer Service Backend | C# | Ready | API backend |
| 3 | Add Batch Operations to QBContainerService | Dart | Ready | Service layer |
| 4A | Create Riverpod Providers | Dart | ✅ DONE | New architecture |
| 4B | Create PackagingService (API Client) | Dart | Ready | Existing service |
| 5A | Update Main.dart with ProviderScope | Dart | Pending | Riverpod setup |
| 5B | Update Routes.dart for Riverpod | Dart | Pending | Riverpod setup |
| 6 | Packaging Station Login Screen | Dart/Flutter | ✅ DONE | Riverpod version |
| 7 | Select Workorder Screen | Dart/Flutter | Pending | Integrate into workflow |
| 8 | Action Screen (Main Hub) | Dart/Flutter | ✅ DONE | Riverpod version |
| 9 | Unload Unpacked Inventory Screen | Dart/Flutter | Ready | Unload flow |
| 10 | Unload Packaged Inventory Screen | Dart/Flutter | Ready | Unload flow |
| 11 | Wire Up Routing and Navigation | Dart | Pending | Routes config |
| 12 | Delete/Archive Old ChangeNotifier Files | Dart | Pending | Cleanup |
| 13 | Create Comprehensive Documentation | Diagrams | Pending | Final docs |

---

## What's Changed vs Original Plan

### Already Implemented ✅
- **Riverpod State Management (4A)**: New `riverpod_packaging_providers.dart` with all three providers
- **Login Screen (6)**: New `packaging_station_login_screen_riverpod.dart`
- **Main Workflow Screen (8)**: New `packaging_screen_riverpod.dart` with ConsumerStatefulWidget

### Key Implementation Decisions
- **Riverpod over Provider/ChangeNotifier**: Better composition, type safety, easier testing
- **StateNotifier pattern**: Immutable state + methods for mutations
- **Three focused providers**: Separation of concerns (session, station, progress)
- **Existing screens preserved**: Old Provider implementation still available for comparison

---

## Backend Implementation Tasks (1-3)

### Task 1: Consolidate Station Info Endpoint (API)

**What it does:** Combines 3 separate API calls into single GET `/info` endpoint.

**Files to create:** `qbs_api/qb_api_dtos/Stations/StationInfoResponse.cs`  
**Files to modify:** PackagingStationController, PackagingStationService

**Status:** Ready for implementation

---

### Task 2: Implement Printer Service Backend

**What it does:** Provides printer discovery, print history, and label info endpoints.

**Files to create:**
- `qbs_api/qb_api/Controllers/PrinterController.cs`
- `qbs_api/qb_api/Services/PrinterService.cs`
- `qbs_api/qb_api_dtos/Printing/` (DTOs)

**Endpoints:**
- GET `/api/BarcodePrint/LabelPrinters/{size}`
- GET `/api/BarcodePrint/PaperPrinters`
- GET `/api/container/{name}/label-info`
- POST `/api/Print/History`
- GET `/api/Print/History`

**Status:** Ready for implementation

---

### Task 3: Add Batch Operations to QBContainerService

**What it does:** Adds convenience methods for moving multiple containers in unload workflow.

**Methods to add:**
- `nestMultipleAsync()`
- `nestMultipleOnNewPalletAsync()`
- `nestMultipleOnExistingPalletAsync()`

**Status:** Ready for implementation

---

## Frontend Implementation Tasks (4-12)

### Task 4A: Create Riverpod Providers ✅ COMPLETED

**Status:** Done  
**File:** `lib/providers/packaging/riverpod_packaging_providers.dart`

**Providers created:**
- `packagingSessionProvider` - StateNotifierProvider for session state
- `packagingStationProvider` - StateNotifierProvider for station state
- `packagingProgressProvider` - StateNotifierProvider for progress tracking
- `packagingServiceProvider` - Provider for service injection
- `sharedPreferencesProvider` - FutureProvider for async preferences

---

### Task 4B: Create PackagingService (API Client)

**Status:** Ready  
**Existing:** Service already exists at `lib/services/packaging/packaging_service.dart`

**Action:** Review existing implementation, ensure it has all methods needed by Riverpod providers

**Service Methods:**
- getAvailableStations(division)
- loadWorkorders(division, stationName)
- selectWorkorder(division, stationName, workorderId)
- loadSourceContainer(division, stationName, containerId)
- getWorkingContainer(division, stationName)
- createBox(division, stationName, actualPieceCount, piecesPerBox)
- logoutAsync(division, stationName, employeeId)

---

### Task 5A: Update Main.dart with ProviderScope

**Status:** Pending

**File:** `lib/main.dart`

**Change:**
```dart
runApp(
  ProviderScope(  // ADD THIS
    child: const QbsApp(),
  ),
);
```

**Steps:**
1. Import `flutter_riverpod`
2. Wrap app root with ProviderScope
3. Test that app loads
4. Commit

---

### Task 5B: Update Routes.dart for Riverpod Screens

**Status:** Pending

**File:** `lib/config/routes.dart`

**Changes:**
1. Update imports to use `_riverpod.dart` versions of screens
2. Update packaging routes to use new ConsumerWidget screens
3. Remove old Provider setup code if present
4. Remove import of old `packaging_state.dart`

**Routes to update:**
- `/packaging` → Use `PackagingStationLoginScreenRiverpod`
- `/packaging/workflow` → Use `PackagingScreenRiverpod`

**Steps:**
1. Update all imports
2. Update route builders
3. Remove ChangeNotifierProvider setup
4. Test navigation
5. Commit

---

### Task 6: Packaging Station Login Screen ✅ COMPLETED

**Status:** Done  
**File:** `lib/screens/packaging/packaging_station_login_screen_riverpod.dart`

**Features:**
- Scan field for station entry
- Station list with cards
- Auto-login from saved preferences
- Session persistence
- Error handling

---

### Task 7: Select Workorder Screen (Integrated)

**Status:** Integrated into packaging_screen_riverpod.dart

**Features:** Built into main workflow, shown when no workorder selected

**Action:** Extract to separate screen if needed, or keep integrated

---

### Task 8: Action Screen (Main Hub) ✅ COMPLETED

**Status:** Done (as part of `PackagingScreenRiverpod`)

**Features:**
- Display current workorder details
- Load containers (scan/manual)
- Show total pieces at station
- Create box button
- Unload buttons

---

### Task 9: Unload Unpacked Inventory Screen

**Status:** Ready

**File:** `lib/screens/packaging/unload_unpacked_screen_riverpod.dart`

**Features:**
- Total containers input
- Quantity per container input
- Destination location scan
- Return inventory button

**Integration:** Use packagingStationProvider for current state, call container service to move

---

### Task 10: Unload Packaged Inventory Screen

**Status:** Ready

**File:** `lib/screens/packaging/unload_packaged_screen_riverpod.dart`

**Features:**
- Container list with checkboxes
- Pallet list with actions
- Move to location, new pallet, existing pallet
- Move pallet to location
- Print label

**Integration:** Use packagingUnloadProvider (if created) or packagingProgressProvider for selections

---

### Task 11: Wire Up Routing and Navigation

**Status:** Pending (after main.dart and routes.dart updated)

**File:** `lib/config/routes.dart`

**Routes:**
- `/packaging/login` → PackagingStationLoginScreenRiverpod
- `/packaging/workflow` → PackagingScreenRiverpod
- `/packaging/unload` → Existing UnloadWidget (or new Riverpod unload screens)
- `/packaging/unload-unpacked` → New unload unpacked screen
- `/packaging/unload-packaged` → New unload packaged screen

---

### Task 12: Delete/Archive Old ChangeNotifier Files

**Status:** Pending

**Files to archive/delete:**
- `lib/screens/packaging/packaging_state.dart` - OLD ChangeNotifier state
- `lib/screens/packaging/packaging_screen.dart` - OLD Provider implementation
- `lib/screens/packaging/packaging_station_login_screen.dart` - OLD Provider version

**Action:** Move to `lib/screens/packaging/archived/` with `.bak` extension for reference

---

### Task 13: Create Comprehensive Documentation

**Status:** Pending

**Documentation:**
- Riverpod migration guide ✅ (created in mermaid-collab)
- Update implementation spec with Riverpod architecture
- Create provider composition diagram
- Document state flow for each screen
- Testing guide for Riverpod providers

---

## Current State

### Files Created
✅ `lib/providers/packaging/riverpod_packaging_providers.dart` - All three providers  
✅ `lib/screens/packaging/packaging_station_login_screen_riverpod.dart` - Login screen  
✅ `lib/screens/packaging/packaging_screen_riverpod.dart` - Main workflow screen  

### Immediate Next Steps
1. Update `main.dart` to add ProviderScope wrapper (Task 5A)
2. Update `routes.dart` to use Riverpod screen versions (Task 5B)
3. Test packagi ng station workflows
4. Create unload screens (Tasks 9, 10)
5. Archive old files (Task 12)

### Backend Work (In Parallel)
- Consolidate info endpoint (Task 1)
- Implement printer service (Task 2)
- Add batch operations to container service (Task 3)

---

## Riverpod Architecture Overview

```
packagingSessionProvider (division, station, workorders)
        ↓
packagingSessionNotifier.selectStation()
        ↓
packagingStationProvider (selectedWorkorder, scannedContainers, pieces)
        ↓
packagingScreenRiverpod (ConsumerStatefulWidget)
        ↓
packagingProgressProvider (completedBoxes, remainingPieces, createdContainers)
```

Each provider is self-contained, composable, and testable.

---

## Key Principles

- **Single Responsibility:** Each provider manages one aspect of state
- **Immutable State:** State objects are immutable, changes create new instances
- **Type Safety:** Riverpod provides compile-time type checking
- **Testable:** Use ProviderContainer for isolated test environments
- **Composable:** Providers depend on other providers automatically
- **Efficient:** Only watching widgets rebuild on state changes

---

## Testing Approach

```dart
// Test example
test('selects workorder', () async {
  final container = ProviderContainer();
  
  // Set up session first
  await container.read(packagingSessionProvider.notifier)
      .selectStation('DIV1', 'STATION1');
  
  // Then test station actions
  final workorder = WorkorderDto(...);
  await container.read(packagingStationProvider.notifier)
      .selectWorkorderWithServer(workorder);
  
  expect(
    container.read(packagingStationProvider).selectedWorkorder?.workorderId,
    'WO-001',
  );
});
```

---

Ready for implementation task-by-task using superpowers:executing-plans.
