# Pseudocode Spec

## Purpose

Every non-trivial code file gets a sibling `.pseudo` file that captures the file's intent and logic in plain English. The code is the source of truth. The pseudocode is a readable summary that stays in sync with it.

## When to create

Generate a `.pseudo` file when a code file is created. Skip files that are:
- Index/barrel files (only re-exports)
- Pure type/interface definition files
- Test files
- Config files (tsconfig, package.json, etc.)
- Files under 20 lines

## When to update

After modifying a code file, check if the logic changed. If so, update the `.pseudo` to reflect the new logic. Cosmetic code changes (formatting, variable renames, comment edits) do not require a `.pseudo` update.

## File location and naming

Sibling to the code file with `.pseudo` extension:
- `http-handler.ts` -> `http-handler.pseudo`
- `data-loader.tsx` -> `data-loader.pseudo`

## Format

### Header

The first lines describe the file's purpose. No keyword needed — just plain English comments.

```
// Short title
// One or two sentences describing what this file does and why it exists.
```

### Module-level context

If the file has important state, config, or background behavior, describe it in plain prose before the functions. Keep it brief.

```
Sessions expire after 30 minutes of inactivity.
A background timer checks every minute and cleans up expired sessions.
```

### Functions

Each function gets a block. Use this format:

```
FUNCTION functionName(params) -> returnType                             EXPORT (if exported)
  Description of what the function does, written as prose or steps.
```

#### Rules for function bodies:

1. **Use plain English.** Write what the function does, not how it does it.
   - Good: "Parse request body as JSON"
   - Bad: "const body = JSON.parse(await req.text())"

2. **Use numbered steps for sequential logic** when order matters.
   - Step 1, Step 2, Step 3 — for distinct phases within a function

3. **Use IF/ELSE for branching** when the branches represent meaningfully different behavior.
   - "IF session exists, use it. ELSE create a new one."
   - Don't enumerate every if/else — only the ones that matter for understanding intent.

4. **Name specific values, APIs, and keys only when they're important for correctness.**
   - Include: field names that callers depend on ("store by transport.sessionId", "header: Mcp-Session-Id")
   - Include: sentinel values with non-obvious meaning ("timeout = -1 means no timeout")
   - Include: error codes/status codes ("return 400", "return 204")
   - Omit: variable names, implementation helpers, library-specific syntax

5. **Describe error handling only when it affects behavior.**
   - "If body can't be parsed, proceed normally with original request" — this matters
   - A generic try/catch that logs and rethrows — skip it

6. **One level of nesting max.** If pseudocode needs deeper nesting, summarize the inner logic in a sentence.

7. **Every named function, method, or callback gets its own FUNCTION block.** Don't inline a function's logic into another function's description. If the code defines a named unit of logic — a function, method, callback, handler, or hook — it gets its own block, even if it's only called from one place. The parent should reference it by name, not describe what it does. This applies across all languages (TypeScript callbacks, Python methods, Go functions, etc.).

### Cross-file references (CALLS)

When a function calls functions defined in **other files**, add a `CALLS:` line immediately after the FUNCTION header. Format:

```
FUNCTION handlePost(req, sessionId) -> Response
  CALLS: setupMCPServer (setup), StreamableHttpTransport (http-transport)
  1. Resolve the session: ...
```

Each entry is `functionName (file-stem)` where file-stem is the `.pseudo` filename without extension. Multiple entries are comma-separated.

Rules:
- **Only list cross-file calls.** Don't list calls to functions defined in the same file.
- **Only list direct calls.** Don't list transitive dependencies.
- **Include constructors and classes** when they're instantiated (e.g., `StreamableHttpTransport (http-transport)`).
- **Omit standard library and framework calls** (e.g., `JSON.parse`, `useState`, `fetch`).
- The pseudocode viewer uses these to create navigable links between `.pseudo` files.

### Section separators

Use `---` between function blocks for visual scanning.

### EXPORT marker

Right-align `EXPORT` on the FUNCTION line for exported functions. This makes it easy to scan which functions are part of the public API.

## Style principles

- **30 second rule**: Someone should understand what the file does by reading the pseudocode in 30 seconds.
- **Intent over implementation**: Describe what and why, not how.
- **Specific where it matters, vague where it doesn't**: Error codes, key field names, and behavioral quirks are specific. Variable names, loop mechanics, and library calls are omitted.
- **No types on parameters** unless the type is surprising or important for understanding.
- **No imports section** — the pseudocode reader doesn't care about module paths.
- **Prose over syntax** — prefer "Returns SSE stream" over "RETURN transport.handleGet()".

## Example

For a file that manages user authentication:

```
// User Authentication
// Handles login, logout, and session validation for the web UI.

Auth tokens are JWTs with a 24-hour expiry.
Refresh tokens are stored in httpOnly cookies.

FUNCTION login(email, password) -> AuthResult                           EXPORT
  CALLS: hashPassword (crypto-utils), RateLimiter (rate-limiter)
  Validate credentials against the database.
  IF valid, generate JWT + refresh token, set cookie, return user info.
  IF invalid, return 401 with generic "invalid credentials" message.
  Rate limited: 5 attempts per email per 15 minutes.

---

FUNCTION logout(request) -> Response                                    EXPORT
  CALLS: invalidateToken (token-store)
  Clear the refresh token cookie.
  Invalidate the refresh token in the database.
  Return 204.

---

FUNCTION validateSession(request) -> User | null                        EXPORT
  CALLS: verifyJWT (crypto-utils), refreshToken (token-store)
  Extract JWT from Authorization header.
  IF valid and not expired, return the user.
  IF expired, attempt silent refresh using the refresh token cookie.
  IF refresh succeeds, return user with new JWT in response header.
  IF refresh fails, return null (caller should redirect to login).
```
