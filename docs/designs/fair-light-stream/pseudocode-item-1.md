# Pseudocode: Item 1 - Auto-select new terminal when opened

### useTerminalTabs.addTab()

```
1. Call api.createTerminalSession(project, session)
   - Returns: result with { id, tmuxSession, wsUrl }

2. Store result.id in local variable (newTerminalId)

3. Call refresh() to reload terminal list from API
   - This updates tabs state with new terminal included

4. After refresh completes, set active tab to new terminal:
   - Call setActiveTabId(newTerminalId)

5. Persist selection to localStorage:
   - Key: getStorageKey(project, session)
   - Value: newTerminalId

6. CATCH any errors:
   - Wrap error in Error object if needed
   - Set error state
   - Re-throw for caller to handle
```

**Error Handling:**
- API failure: Caught, set error state, re-thrown
- Existing pattern matches current implementation

**Edge Cases:**
- Empty project/session: API will fail, error caught
- Rapid double-click: Second call creates second terminal, both get added

**Dependencies:**
- api.createTerminalSession (existing)
- localStorage (browser API)
