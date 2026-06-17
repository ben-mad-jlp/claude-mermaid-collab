# Waves 5-8 Implementation

## Wave 5: onboarding-manager-rewire, onboarding-db-rewire
- Rewrote `onboarding-manager.ts` — replaced getKodexManager with getPseudoDb, removed DiagramBlock/parseRelatedTopics/getDiagram, rewrote deriveCategories for directory-based grouping
- Rewrote `onboarding-db.ts` — renamed topic_name→file_path in schema, rewired FTS to pseudo DB, added isPseudoDbReady health check

## Wave 6: onboarding-api-rewire
- Rewrote `onboarding-api.ts` — removed kodex import, renamed endpoints (topics→files, categories→directories), removed diagram endpoint, updated progress/notes to use filePath

## Wave 7: onboarding-ui-redesign
- Updated `onboarding-api.ts` client — types renamed (topicName→filePath), methods renamed (getTopics→getFiles), removed DiagramBlock
- Updated 5 UI pages: BrowseDashboard (files/directories), TopicDetail (3 tabs), TopicGraph (file graph), SearchResults (filePath), OnboardingLayout (labels)
- Deleted DiagramsTab.tsx

## Wave 8: remove-kodex
- Deleted ~40+ files: kodex-manager.ts, kodex-api.ts, all kodex UI pages/components, kodex-api client, 10 skill directories, test files
- Removed from server.ts: kodex route
- Removed from setup.ts: ~414 lines (15 tool defs + 15 handlers + imports)
- Removed from main.tsx: kodex routes
- Removed from NavMenu.tsx: kodex nav item
- Removed from collab-manager.ts: kodex exclusion logic
- Fix loop: deleted orphaned tools.test.ts, updated onboarding-db test path, cleaned alias-generator comment

## Verification
- TypeScript: no new errors from any wave
- All kodex imports/references cleaned from source code