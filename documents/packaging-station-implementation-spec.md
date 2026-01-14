# Packaging Station Implementation Specification

## Existing API Endpoints

**Status:** PARTIALLY IMPLEMENTED in QBS API

**Controller**: `PackagingStationController`
**Route Base**: `/api/stations/packaging`

### Authentication & Station Selection
- **GET** `/api/stations/packaging` - Get packaging stations by division

### Station Info (CONSOLIDATE)
- **GET** `/api/stations/packaging/{division}/{name}/info` - **CONSOLIDATED ENDPOINT**
  - Returns single response with:
    - `workorders[]` - Available workorders for station
    - `workingContainer` - Current working container state
    - `stationConfig` - Station configuration (useScale, scaleModel, comPort, etc.)
    - `tableLocationContainers[]` - Containers at station table location
    - `availablePallets[]` - Available pallets at station
  
  **Note:** Consolidates existing endpoints:
  - GET `/workorders` - Move to info response
  - GET `/working-container` - Move to info response
  - Station config - Move to info response
  - NEW: tableLocationContainers
  - NEW: availablePallets

### Workorder Selection
- **POST** `/api/stations/packaging/{division}/{name}/select-workorder` - Select a workorder to package
  - Request: `{ workorderId }`
  - Returns: (void - just updates server state)

### Load & Package
- **POST** `/api/stations/packaging/{division}/{name}/load` - Load source container into working area
  - Request: `{ sourceContainerId }`
  - Returns: Updated working container state

- **POST** `/api/stations/packaging/{division}/{name}/package` - Create packages from working container
  - Scale Mode Request: `{ actualPieceCount, weight }`
  - Manual Mode Request: `{ numberOfBoxes, actualPieceCount }`
  - Returns: Created container IDs, updated workorder status

### Session
- **POST** `/api/stations/packaging/{division}/{name}/logout` - End station session

---

## Dart/Flutter Services

### PackagingService (API Client - IMPLEMENT)
Wrapper around API endpoints:
```
- getAvailableStations(division) → List<Station>
- getStationInfo(division, stationName) → StationInfoResponse
  {
    workorders: List<WorkorderDto>,
    workingContainer: WorkingContainerDto,
    stationConfig: StationConfigDto,
    tableLocationContainers: List<ContainerDto>,
    availablePallets: List<PalletDto>
  }
- selectWorkorder(division, stationName, workorderId) → void
- loadSourceContainer(division, stationName, sourceContainerId) → WorkingContainerDto
- postPackage(division, stationName, request) → PackageResponseDto
```

### QBContainerService (EXISTING - Used directly from frontend)
- Location: `/qbs_library_dart/lib/src/services/container/container_service.dart`
- Methods for unload operations:
  - `moveAsync(container, employee, location, unassemble)` - Move container to location
  - `nestAsync(container, employee, destination, unassemble)` - Nest container into another
  - `nestOnNewPalletAsync(container, employee, destination)` - Create pallet and nest
  - **NEEDED**: `nestMultipleAsync(containers[], employee, destination, unassemble)` - Move multiple containers to location
  - **NEEDED**: `nestMultipleOnNewPalletAsync(containers[], employee, destination)` - Nest multiple containers on new pallet
  - **NEEDED**: `nestMultipleOnExistingPalletAsync(containers[], employee, destination, unassemble)` - Nest multiple containers on existing pallet

### PrinterService (PLANNED - NOT YET IMPLEMENTED)
Endpoints planned but not yet built:
- GET `/api/BarcodePrint/LabelPrinters/{size}` - Get available label printers
- GET `/api/BarcodePrint/PaperPrinters` - Get available paper printers
- GET `/api/Print/History` - Get print history
- POST `/api/Print/History` - Log print operation
- GET `/api/container/{containerName}/print_label_info` - Get label info for container

**Status**: Database models exist (QBS_BarcodePrinter, Container_PrintLog), but controller/service/DTOs need implementation

---

## State Management (Riverpod)

### PackagingStateNotifier
- Manages: Division, selected station, employee context
- Handles: Station login, logout, session persistence
- Methods:
  - `loginStation(station)`
  - `logout()`

### PackagingStationProvider
- Manages: Current workorder, workorders list, working container, table containers, pallets, station config
- Updates on: Load source, post package, refresh
- Methods:
  - `getStationInfo()` - Refresh all station data (called after every action)
  - `selectWorkorder(workorderId)` - Select workorder
  - `loadSourceContainer(containerId)` - Load source container
  - `postPackage(scaleOrManualRequest)` - Create package

### PackagingUnloadStateNotifier (NEW)
- Manages: Unload mode (packaged/unpacked), selected containers/pallets, unload progress
- Methods:
  - `moveUnpackedToLocation(location)` - Move working container to location
  - `moveContainersToLocation(containers, location)` - Move multiple containers to location
  - `moveContainersToPallet(containers, palletId)` - Nest containers on new pallet
  - `moveContainersToExistingPallet(containers, palletId)` - Nest containers on existing pallet
  - `movePalletToLocation(palletId, location)` - Move pallet to location
  - `printLabel(palletId)` - Print pallet label

---

## Models/DTOs

### Consolidated Response DTO (NEW)
```
StationInfoResponse {
  workorders: List<WorkorderDto>,
  workingContainer: WorkingContainerDto,
  stationConfig: StationConfigDto,
  tableLocationContainers: List<ContainerDto>,
  availablePallets: List<PalletDto>
}
```

### Existing DTOs (ALREADY IMPLEMENTED)
Located in `/qbs_api/qb_api_dtos/Packaging/`:
- WorkorderDto
- PackageRequest
- PackageResult
- LoadSourceRequest
- LoadSourceResult
- SelectWorkorderRequest
- WorkingContainerDto
- CreatedContainerDto
- WorkorderRefreshDto

Located in `/qbs_api/qb_api_dtos/Stations/PackagingStation.cs`:
- PackagingStationDto
- ScaleConfigDto
- WorkingContainerPackageDto

### New DTOs Needed
```
StationInfoResponse - Consolidated station info
ContainerDto - Table location containers
PalletDto - Available pallets
PrinterConfigDto - Printer configuration
PaperPrinterConfigDto - Paper printer configuration
PrintRecordDto - Print history record
PrintResultDto - Print operation result
PrintLabelInfoDto - Label information for printing
```

---

## Error Handling

### Expected Errors
- Invalid/unavailable workorder
- Insufficient pieces loaded
- Scale reading not settled or mismatch
- Invalid location/pallet
- Printing failure
- Network/API errors

### Error Recovery
- Allow retry for transient failures
- Allow cancel operation
- If cancelled, refresh station info
- Each provider tracks error state with user-friendly messages

---

## Session Persistence

### SharedPreferences
- Last selected station
- Last selected workorder (optional)
- Division/employee context

### Auto-login
- If saved station exists, auto-login on app start
- Validate station still available before proceeding

---

## Refresh Strategy

- **When**: After every action completion (load, package, unload)
- **Frequency**: Single call to `getStationInfo()` - not auto-polling
- **Updates**: Workorders, working container, table containers, pallets, station config all refresh in one call

---

## Implementation Plan

### ALREADY DONE (in QBS API)
1. ✅ Packaging station endpoints (authentication, select-workorder, load, package)
2. ✅ Packaging service implementation
3. ✅ Packaging DTOs
4. ✅ Database models for printing exist

### NEEDED - API Backend Enhancements
1. **Consolidate Station Info Endpoint** 
   - Combine `/workorders`, `/working-container`, and station config into single `/info` endpoint
   - Add table location containers
   - Add available pallets
   - Return: StationInfoResponse (new DTO)

2. **Printer Service Implementation** 
   - Create PrinterController, PrinterService, DTOs (planned but not implemented)

### NEEDED - Flutter/Dart Layer
1. **PackagingService** - API client wrapper for endpoints
2. **PackagingStateNotifier** - High-level workflow state
3. **PackagingStationProvider** - Station info state with single refresh call
4. **PackagingUnloadStateNotifier** - Unload workflow state
5. **5 Packaging Screens** - Login, Select WO, Action, Unload Unpacked, Unload Packaged

### NEEDED - QBContainerService Extensions
1. Add batch operation methods if not already present:
   - `nestMultipleAsync()`
   - `nestMultipleOnNewPalletAsync()`
   - `nestMultipleOnExistingPalletAsync()`