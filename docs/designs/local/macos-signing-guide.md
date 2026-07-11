# macOS Code Signing & Notarization — Step-by-Step

What's already wired in `desktop/package.json` + `desktop/build/` (no action needed):
- `hardenedRuntime: true`, `gatekeeperAssess: false`
- `entitlements` + `entitlementsInherit` → `build/entitlements.mac.plist` (JIT + disable-library-validation so the **Bun sidecar** and **Chrome** can launch under hardened runtime)
- `notarize: true`
- App icon (`build/icon.png`)
- `build:ui` runs **`vite build` directly** (NOT the root `tsc && vite build`). The root build is gated on a full-project type-check that fails on pre-existing errors in unrelated files (Onboarding/Pseudo/agentStore); that gate would block `npm run dist` from ever producing a fresh `ui/dist`. Type-checking belongs in CI, not the packaging path.

You provide the credentials + run the build. Steps:

## 1. Apple Developer Program
Enrol at https://developer.apple.com/programs/ ($99/year). Individual or org both work.

## 2. Create a "Developer ID Application" certificate
This is the cert for distributing **outside** the App Store (a normal downloadable app).
- Easiest: **Xcode → Settings → Accounts → (your Apple ID) → Manage Certificates → + → "Developer ID Application"**. It installs into your **login keychain** automatically.
- Or: create at https://developer.apple.com/account/resources/certificates → download the `.cer` → double-click to add to Keychain.
- Verify it's present:
  ```bash
  security find-identity -v -p codesigning
  ```
  You should see a line like `"Developer ID Application: Your Name (TEAMID)"`. electron-builder auto-discovers it from the keychain.

> **This machine (verified):** the Developer ID Application cert is installed —
> `Developer ID Application: Benjamin Maderazo (N8N4CQ6RT3)`. Use **`APPLE_TEAM_ID=N8N4CQ6RT3`**
> (NOT the `3FYX7956PV` personal/dev team). notarytool + Xcode 26.4.1 are present.

## 3. Notarization credential — App Store Connect API key (recommended default)
An **App Store Connect API key** is the preferred credential: it's **account/team-wide (not per-app)**, doesn't expire like an app-specific password, and drops straight into CI. The same key notarizes any app under your team.

Create it once at **App Store Connect → Users and Access → Integrations → App Store Connect API**:
- Click **+** to generate a **Team Key** with the **Developer** role (enough for notarization; no Admin needed).
- You get three things:
  - **Issuer ID** — a UUID at the top of the Keys page (e.g. `57246542-96fe-…`)
  - **Key ID** — the 10-char ID on the key row (e.g. `2X9R4HXF34`)
  - **`.p8` file** — **downloadable only once**. Save it somewhere stable, e.g. `~/.appstoreconnect/private/AuthKey_<KEYID>.p8`. (Lost it? You can't re-download — revoke + reissue.)

> **Team Key vs Individual Key:** create a *Team Key* (shared at the team level, CI-friendly). *Individual Keys* are tied to your personal Apple ID and are less suited to sharing/CI. Either works for notarization.

> **Alternative (legacy): app-specific password.** https://account.apple.com → Sign-In & Security → App-Specific Passwords. Then use `APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD` + `APPLE_TEAM_ID` instead of the three `APPLE_API_*` vars below. Don't set both sets at once — see the credential-precedence note in step 4.

## 4. Set the build environment (API key)
```bash
export APPLE_API_KEY="$HOME/.appstoreconnect/private/AuthKey_2X9R4HXF34.p8"  # PATH to the .p8, not its contents
export APPLE_API_KEY_ID="2X9R4HXF34"
export APPLE_API_ISSUER="57246542-96fe-…-your-issuer-uuid"
# Do NOT set CSC_IDENTITY_AUTO_DISCOVERY=false (that disables signing — it's only
# what we used for unsigned local --dir test builds).
```
electron-builder reads these: the keychain cert signs the app; the three `APPLE_API_*` vars drive notarization via `notarytool`.

> ⚠️ **Credential precedence — the `APPLE_ID` leftover gotcha.** electron-builder resolves notarization creds in this order:
> 1. if `APPLE_API_KEY` **and** `APPLE_API_KEY_ID` **and** `APPLE_API_ISSUER` are all set → **API key path**;
> 2. **else if** `APPLE_ID` is set → Apple-ID path, which then **requires** `APPLE_APP_SPECIFIC_PASSWORD`.
>
> So if you previously exported `APPLE_ID` and then switch to the API key, a leftover `APPLE_ID` (or a typo in any one `APPLE_API_*` var) drops you into branch 2 and you'll see:
> `⨯ APPLE_APP_SPECIFIC_PASSWORD env var needs to be set`.
> Fix: `unset APPLE_ID APPLE_APP_SPECIFIC_PASSWORD`, confirm all three `APPLE_API_*` are set **in the same shell** (`ls -l "$APPLE_API_KEY"` to prove the `.p8` exists), then re-run.

> If electron-builder complains it needs the team id in config, add it explicitly:
> `"mac": { "notarize": { "teamId": "N8N4CQ6RT3" } }` instead of `"notarize": true`.

## 5. Build the signed + notarized app
```bash
cd desktop
npm run dist      # build:ui (vite) → electron-vite build → build:sidecar → electron-builder
```
This signs `Mermaid Collab.app` (incl. the embedded `mc-server` sidecar + Chrome helpers), staples the notarization ticket, and produces a signed `.dmg` + `.zip` in `desktop/dist/`.
- If the bundles are already fresh from a prior build, you can skip straight to the sign+notarize step with `npx electron-builder`.
- First notarization can take a few minutes (Apple's service) and the first 1–2 attempts often fail with actionable errors — read them; usually a missing entitlement or an unsigned nested binary.

## 6. Verify
Run the bundled script (auto-detects `dist/mac-*/Mermaid Collab.app`):
```bash
cd desktop
./scripts/verify-signing.sh                       # or pass an explicit .app path
```
It checks, with a non-zero exit on any failure: signature validity (`codesign --verify --deep --strict`), Developer ID authority + `TeamIdentifier=N8N4CQ6RT3`, Gatekeeper acceptance (`spctl` → "Notarized Developer ID"), a stapled ticket (`stapler validate`), and that the **`mc-server` sidecar** is signed.

Manual equivalents if you want them:
```bash
APP="dist/mac-arm64/Mermaid Collab.app"
codesign --verify --deep --strict --verbose=2 "$APP"
codesign -dvvv "$APP" 2>&1 | grep -E "Authority|TeamIdentifier"
spctl -a -vvv -t install "$APP"        # expect: accepted, source=Notarized Developer ID
xcrun stapler validate "$APP"
codesign --verify --verbose "$APP/Contents/Resources/mc-server"
```

## Troubleshooting: `errSecInternalComponent` during codesign
This means `codesign` couldn't access the signing key — almost always because the
build ran in a **non-interactive** shell (CI, an agent, an SSH session) that can't
answer the keychain prompt. Two fixes:
- **Easiest — run the build in your own GUI Terminal.** The first sign triggers a
  "codesign wants to sign using key …" prompt — click **Always Allow**. Subsequent
  builds are silent.
- **Non-interactive (CI / agent) — authorize the key once:**
  ```bash
  security unlock-keychain ~/Library/Keychains/login.keychain-db
  security set-key-partition-list -S apple-tool:,apple:,codesign: \
    -s -k "<your-login-password>" ~/Library/Keychains/login.keychain-db
  ```
  After this, any shell can sign. (The password is your macOS login password; never
  paste it into a shared chat/transcript.)

> Note: a fresh signing config that reaches the `codesign --sign … --options runtime
> --entitlements …` step and only fails on key access is **correct** — it's purely the
> keychain-authorization issue above, not a config problem.

## The sidecar gotcha (why the entitlements matter)
`mc-server` is a `bun build --compile` Mach-O placed via `extraResources`. electron-builder signs nested binaries during app signing, but:
- It must be signed with **your** Developer ID + the hardened runtime, and
- The app needs **`com.apple.security.cs.disable-library-validation`** (already in the entitlements) so the hardened Electron process is allowed to spawn the sidecar and Chrome.
If notarization rejects the sidecar, the error names it — re-check it's signed (step 6) and that the entitlement is applied.

## Auto-update (after signing works)
Signed + notarized builds enable `electron-updater` on macOS. To turn it on:
1. Add a publish target (GitHub Releases is simplest):
   `"publish": { "provider": "github", "owner": "<you>", "repo": "<repo>" }` (replaces the current `"publish": null`).
2. `npm run dist -- --publish always` (needs a `GH_TOKEN`).
3. The app's `autoUpdater.checkForUpdatesAndNotify()` (already wired, packaged-only) will then find updates.

## Windows (for later)
Analogous: a code-signing cert (OV/EV or Azure Trusted Signing) → set `CSC_LINK`/`CSC_KEY_PASSWORD` (or the Azure signing config) → `electron-builder --win`. No notarization, but SmartScreen reputation builds with signed downloads.

## CI note
Cross-OS builds need per-OS runners (you can't notarize macOS from Linux). A matrix (macos-latest / windows-latest / ubuntu-latest) each running `npm run dist` with the platform's secrets is the standard setup. The API key (step 3) is the right notarization credential for CI: store the `.p8` as a base64 secret, write it to disk in the job, and point `APPLE_API_KEY` at it.
