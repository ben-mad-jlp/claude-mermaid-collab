# Packaging Station Process

## Flow

1. **Station Login** - Select packaging station
2. **Select Workorder** - Choose workorder to package
3. **Load Source Containers** - Scan/enter container IDs to load pieces (can do multiple times)
4. **Post Package** - Create packaged container
   - **Scale Mode**: Validate scale reading matches `piecesPerBox`
   - **Manual Mode**: Enter number of boxes, validate enough pieces loaded
5. **Check Completion** - Call station info endpoint after post (see Behavior Tree)
   - If workorder complete → Unload containers
   - If not complete → Continue (load more sources or post more packages)

## Unload Process

Display all containers currently at station:
- Containers on pallets
- Containers at station table

User can perform these actions:

### Option A: Move Container(s) to Location
- Select one or more containers
- Scan/enter destination location
- Transfer containers to location

### Option B: Move Container(s) to New Pallet
- Select one or more containers
- Create new pallet at station table
- Transfer containers to new pallet

### Option C: Move Container(s) to Existing Pallet
- Select one or more containers
- Select existing pallet at station table
- Transfer containers to pallet

### Option D: Move Pallet to Location
- Select a pallet
- Scan/enter destination location
- Transfer pallet to location

### Option E: Print Pallet Label
- Select a pallet
- Print label via printer service

6. **Complete** - Return to workorder selection or logout