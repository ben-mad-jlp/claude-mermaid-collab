---
name: kodex-generate-aliases
description: Use when generating aliases for Kodex topics to improve findability and search coverage
---

# Generate Aliases for Kodex Topic

## Overview

Kodex topics can only be found by exact name match. This skill automates alias generation to make topics discoverable through synonyms, abbreviations, and related terms. Generate aliases for a topic and approve additions in one workflow.

**Core principle:** Good aliases expand discoverability without cluttering the knowledge base.

## When to Use

- Adding multiple aliases to an existing topic manually is tedious
- You want to quickly generate relevant search terms for a topic
- You need to improve topic findability without renaming it
- Batch-generating aliases across multiple topics

**When NOT to use:**
- Manual alias management for 1-2 topics (use the UI directly)
- Fixing incorrect generated aliases (edit them individually in UI)

## Quick Reference

**Invoke the skill:**
```
/kodex-generate-aliases topic-name
```

**What happens:**
1. Load topic and display current aliases
2. Generate new aliases from title, synonyms, abbreviations, content
3. Show generated aliases for approval
4. Add confirmed aliases to topic

**Aliases come from 4 sources:**
| Source | Example |
|--------|---------|
| **Title keywords** | Topic "debugging-with-logs" → "debugging", "logs" |
| **Synonyms** | "db" → "database", "storage", "data" |
| **Abbreviations** | "configuration" → "config" |
| **Content keywords** | Most-used words from topic content |

## Workflow

### Step 1: Select Topic

Provide a topic name. The skill loads the full topic with content.

**Input format:** `/kodex-generate-aliases topic-name`

**Error handling:**
- Topic not found: "Topic 'xyz' not found. Check name and try again."
- Topic without title: Use topic name as fallback

### Step 2: Generate Aliases

The skill calls the `generateAliases()` function with:
- Topic name (canonical identifier)
- Topic title (for keyword extraction)
- Topic content (for keyword frequency analysis)

**Generation rules:**
- Extract keywords from title (words > 2 chars)
- Expand with SYNONYMS map (e.g., "auth" → "authentication", "login", "signin")
- Expand with ABBREVIATIONS (e.g., "authentication" ↔ "auth")
- Extract top 5 keywords from content (if included)
- Remove canonical name from results
- Max 10 aliases per topic
- Remove duplicates automatically

### Step 3: Show Generated Aliases

Display:
- **Current aliases:** What the topic already has
- **Generated aliases:** What the system suggests
- **Difference:** Which ones are new

Example output:
```
Topic: testing-async-code
Current aliases: [testing, async, flaky]
Generated aliases: [timing, timeout, condition-based, wait, awaiting]
New: [timeout, condition-based, wait, awaiting] (4 new)
```

### Step 4: Approve Aliases

User selects which generated aliases to add:
- ✓ Approve all suggested aliases
- ✓ Select subset to add
- ✗ Reject all and exit

**Validation:**
- Skip aliases that are already present
- Warn if adding alias that matches other topic names
- Confirm before applying changes

### Step 5: Add to Topic

For each approved alias, call `kodexApi.addAlias(topicName, alias)`.

Display confirmation:
```
Added 4 aliases to 'testing-async-code':
✓ timeout
✓ condition-based
✓ wait
✓ awaiting
```

## Implementation Notes

### Function Dependencies

The skill relies on `generateAliases()` function (implemented separately):

```typescript
export function generateAliases(
  name: string,           // Topic name (canonical)
  title: string,          // Topic title
  content?: TopicContent, // Full topic content
  options?: AliasGeneratorOptions
): string[]
```

**What generateAliases returns:**
- Array of strings (candidate aliases)
- Already deduplicated and limited to max 10
- Does NOT include the canonical name
- Sorted alphabetically

### API Methods Required

The skill uses these kodex API methods:

```typescript
// Load full topic with content
getTopic(project: string, name: string): Promise<Topic>

// Add alias to topic
addAlias(project: string, topicName: string, alias: string): Promise<void>
```

### Constants

The skill uses these constants from `alias-generator.ts`:

**SYNONYMS:** Word variations (e.g., "auth" → "authentication", "login")

**ABBREVIATIONS:** Long-form ↔ short-form pairs (e.g., "authentication" ↔ "auth")

**MAX_ALIASES:** 10 (cap on returned aliases)

**MIN_ALIAS_LENGTH:** 2 (minimum alias length)

### Browser-Based UI

When displaying generated aliases and asking for approval, use `render_ui` to show in browser:

```typescript
mcp__mermaid__render_ui({
  project,
  session,
  ui: {
    type: 'Checklist',
    items: generatedAliases.map(alias => ({
      label: alias,
      checked: true // Pre-select all
    })),
    name: 'aliasSelection'
  },
  blocking: true
})
```

When user responds, extract selected aliases from form data and proceed to add.

## Real-World Example

### Scenario: Improve discoverability of "authentication" topic

**Starting state:**
```
Topic: authentication
Current aliases: [auth, login]
Content: ~500 words on auth patterns, OAuth, JWT
```

**Run:** `/kodex-generate-aliases authentication`

**Generation:**
1. Title keywords: ["authentication"] (only 1 word)
2. Synonyms: "auth" is in title → add ["authentication", "login", "signin", "authorization"]
3. Abbreviations: "authentication" is long → add "auth" (already present)
4. Content keywords: ["oauth", "jwt", "bearer", "token", "session"]
5. Deduplicate: ["authorization", "signin", "oauth", "jwt", "bearer", "token", "session"]

**User sees:**
```
Topic: authentication
Current aliases: [auth, login]
Generated: [authorization, signin, oauth, jwt, bearer, token, session] (7 new)
```

**User approves all 7.**

**Result:**
```
Topic: authentication now has aliases:
[auth, login, authorization, signin, oauth, jwt, bearer, token, session]
```

Now queries for "oauth", "jwt", "bearer", "token", or "authorization" all find "authentication".

## Common Mistakes

### Mistake 1: Approving aliases that match topic names

**Problem:** Generated alias happens to match another topic's name (e.g., "auth" exists as separate topic)

**Fix:** Warning message appears: "Alias 'auth' matches topic name 'auth'. Add anyway? (not recommended)"

**Prevention:** Always review the generated list before approving.

### Mistake 2: Over-aliasing a topic

**Problem:** Added 20+ aliases making the topic too discoverable for unrelated queries

**Fix:** Capped at 10 aliases max. If you need more, add manually one at a time through UI.

**Prevention:** Review each generated batch. If too many, decrease content keyword inclusion.

### Mistake 3: Forgetting synonyms are bidirectional

**Problem:** Generated "auth" but forgot it also adds "authentication", "login", etc.

**Fix:** The SYNONYMS map is bidirectional. Adding "auth" automatically includes "authentication" and vice versa.

**Prevention:** Check the SYNONYMS constant to understand expansion rules.

## Edge Cases

### Very short topic name (1 word)

**Behavior:** Still generates aliases from synonyms and abbreviations.

**Example:** Topic "auth"
- Title keywords: ["auth"]
- Synonyms: ["authentication", "login", "signin"]
- Abbreviations: (none apply, "auth" is short form)
- Result: ["authentication", "login", "signin"]

### Topic with no content

**Behavior:** Uses title only (skips content keywords).

**Example:** Topic "new-topic" with empty content
- Title keywords: ["new", "topic"] (both length > 2)
- Synonyms: (none match)
- Result: ["new", "topic"] (minimal but useful)

### Content with stop words

**Behavior:** Automatically filters stop words (the, a, an, is, etc.)

**Example:** Content "The authentication system is a critical component..."
- Extracted: ["authentication", "system", "critical", "component"] (not "the", "is", "a")

### Duplicate aliases

**Behavior:** Automatically deduplicated at generation time.

**Example:** Title "authentication" + synonym "authentication"
- Generated once, not twice

## Troubleshooting

### "Topic not found" error

**Cause:** Topic name doesn't exist or typo in name

**Fix:**
1. Check Kodex topic list for exact spelling
2. Use topic's canonical name (not an alias of another topic)
3. Try: `kodex-query-topic topic-name` to verify it exists

### Generated aliases seem wrong

**Cause:** SYNONYMS map doesn't include the terms you expected

**Fix:**
1. Check `src/services/alias-generator.ts` SYNONYMS constant
2. Add the missing synonym pair (requires code change)
3. For now, manually add the alias through UI

### Too many aliases generated

**Cause:** Content is very verbose or has many repeated keywords

**Fix:**
1. Review the generated list and select only the most relevant
2. Don't feel obligated to approve all suggestions
3. Keep aliases focused on alternate names, not full topic descriptions

## Advanced Configuration

### Custom generation options

If you need different generation behavior, `generateAliases()` accepts options:

```typescript
generateAliases(name, title, content, {
  maxAliases: 15,              // Return up to 15 aliases
  minAliasLength: 3,           // Aliases must be 3+ chars
  includeSynonyms: true,       // Include synonym expansion
  includeAbbreviations: true,  // Include abbreviation expansion
  includeContentKeywords: true // Extract keywords from content
})
```

The skill uses defaults. To use custom options, modify the generateAliases() call in the skill implementation.

## Integration with Kodex Workflow

**Auto-generation on topic creation** (optional, future enhancement):
- When `createTopic()` is called, automatically generate aliases
- User can review and edit before saving
- Not required for MVP

**Alias removal:**
- Use `kodex_remove_alias` MCP tool (separate skill)
- Or edit directly in Kodex UI

**Alias conflicts:**
- If alias is already present, adding it is a no-op
- UI validates before applying

## Performance Considerations

**Generation time:** < 100ms for typical topics
- Keyword extraction: O(title length)
- Synonym expansion: O(keywords × synonym map size)
- Content keywords: O(content length) for frequency analysis
- Limit: max 10 aliases, so output is bounded

**Storage:** Minimal
- Aliases stored as JSON array in SQLite
- Typical topic: 5-10 aliases = 50-100 bytes

**Query performance:** Not impacted
- Alias lookup uses LIKE on JSON array: `aliases LIKE '%"alias-name"%'`
- Index not required (tables typically small)
