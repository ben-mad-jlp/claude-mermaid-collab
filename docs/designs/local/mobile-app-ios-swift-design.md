# Zen for iOS — a LAN-local, Apple-native monitor for collab

**Status:** DESIGN — not started. Decisions below are *locked recommendations* by the
build-time steward; the "Open questions" section lists what still needs a human ruling.
**Series:** native-app design (companion to `design-remote-connectivity.md`).
**One-line thesis:** a calm, glance-don't-open iOS app that watches your collab Zen
sessions, works **only when you're on the same LAN as the desktop**, and feels like it
shipped from Cupertino — not like a web dashboard in a phone frame.

---

## 0. Why this is a small mission, not a greenfield one

The hard backend and a real native client already exist. This mission is **finish +
elevate + re-scope to LAN**, not "build an iOS app." What's already here:

- **`ios/MermaidCollab/`** — a genuine SwiftUI app (XcodeGen, iOS 16, iPhone+iPad),
  display name **"Zen."** Glance grid of session cards, status dots, glance/expanded
  summaries, question + answer pills, `PairingView`, Keychain token, a WebSocket store
  that ingests `session_summary_updated`/`escalation_*` and can **decide** + **nudge**.
- **`ios/MermaidCollabCore/`** — a Swift package that is a *pure port of the web UI's
  freshness/triage selectors* (same severity tiers, same 15-min dead-man's-switch), with
  unit tests. Keep this architecture — it's the right one.
- **Pairing seam** — `/api/pair`, `/api/pair/rotate` (loopback-only, 403-first),
  `/api/auth/check`, bearer token authoritative in `config.json`, QR deep-link
  `mermaidcollab://pair?host&token`.
- **Zen backend** — the session-summary loop (structural pass + LLM interpreter),
  `zen-presence` viewing-heartbeat gating, and the WS/REST feeds.

**What today's on-device path actually is:** Tailscale-oriented (server binds loopback
by default; pairing surfaces Tailscale CGNAT IPs first). This mission **deliberately
constrains** that to the LAN. Tailscale remains the escape hatch if "from anywhere" is
ever wanted again — nothing is burned.

---

## 1. Product stance (the north star)

1. **LAN-local by design.** No cloud, no account, no VPN to install. It works when you're
   on your wifi and is simply absent when you're not. That's a *feature* — the same
   local-first trust boundary as AirPlay/AirDrop/HomeKit. Zen is a device in your space,
   not a leash that follows you to the coffee shop.
2. **Glance, don't open.** The product is the ambient surface — a Lock-Screen/Home-Screen
   read that says "2 working · 1 needs you." Opening the app is the *exception*, for when
   you want to act.
3. **Calm.** Motion is restrained and physical, never busy. The app should feel like it's
   breathing, not blinking.
4. **Act in one tap.** The three things worth doing from a phone — **approve/push a green
   card, decide an escalation, answer a question** — are each a single, confident,
   haptic-confirmed tap.

---

## 2. Locked decisions (the four open questions, answered)

### Q1 — Scope of Zen on the phone → **read + the three quick acts**
The phone is a **monitor + minimal actuator**, not a workstation.
- **Keep:** read glance/expanded cards; **decide** an escalation
  (`POST /api/supervisor/escalation/{id}/decide`); **nudge/answer**
  (`POST /api/supervisor/nudge`).
- **Add (marquee):** **approve/push a green card.** This is the one moment you actually
  reach for your phone — you're away from the desk, a session went green, you tap to ship.
  It maps to the standing "green card = push immediately" instinct. Gate it behind a
  deliberate confirm (swipe-to-confirm or a hold-button) + a success haptic, because a
  push is consequential. Needs one endpoint (see §6).
- **Explicitly out of scope:** code editing, planning, diagram authoring, terminal. The
  phone never becomes a tiny IDE. If you need to *work*, you're at the Mac.

### Q2 — TLS posture → **v1 cleartext + token via `NSAllowsLocalNetworking`; pin in v2**
- **v1:** HTTP + bearer token on the LAN, made *App-Store-legitimate* with the ATS
  exception **`NSAllowsLocalNetworking`** — the sanctioned path for local-network apps
  (NOT the red-flag `NSAllowsArbitraryLoads` currently in the dev build). On your own LAN
  the token is the real gate.
- **Forward-compat:** the pairing handshake records a **cert-fingerprint slot** so v2 can
  add **self-signed TLS + cert pinning** (the app trusts exactly the one cert it saw at
  pairing, HomeKit-style) with no redesign.
- **Rationale:** home-LAN eavesdropping is low-but-nonzero and the token covers it;
  pinning is *shared-LAN* (office/coffee-shop wifi) hardening and is deferrable. Decide it
  now so the pairing flow reserves the fingerprint field from day one.

### Q3 — Ambient ambition → **first-class, phased; pure-LAN by default, APNs opt-in**
Glance-don't-open is the thesis, so ambient surfaces are a *goal*, not a stretch — but
sequenced honestly around the LAN constraint:
- **P1:** in-app glance grid + discovery + the three acts (foundation).
- **P2:** **WidgetKit** Home/Lock-Screen widget — a `TimelineProvider` that shows the
  triage rollup ("2 working · 1 needs you · all green"), refreshed on app foreground and
  via background-refresh **while the phone is reachable on the LAN**. Fully local.
- **P3:** **Live Activity + notifications**, with the LAN/push tension resolved by a
  **default/opt-in split**:
  - **Default — pure LAN, zero cloud:** local notifications + widget updates only while
    the socket is reachable. Honors the "nothing leaves the LAN" promise literally.
  - **Opt-in — APNs poke:** the *Mac* (which has internet even though the app's data
    channel is LAN-only) sends a lightweight status ping through Apple's cloud to wake a
    Live Activity / deliver a background notification. **Data stays local; only the "poke"
    uses APNs.** Clearly labeled, off by default, because it crosses the no-cloud line.
- **Decision:** ship P2 (pure-LAN widget) as the ambient MVP; treat Live Activity as
  designed-for but gated on the P3 opt-in call.

### Q4 — Loose ends → **this doc; plus an Origin/LAN guard when binding to the LAN**
- The design docs referenced in code (`mobile-app-ios-swift-design`,
  `zen-phone-pairing-design`) did not exist as files — **this file is the first.**
- There is **no CORS/Origin/Host allow-listing** today (the remote-connectivity design
  flags it as proposed-only). The moment the server binds to the LAN this matters — see
  §5's LAN guard and Origin allowlist.

---

## 3. Discovery — the single biggest "feels Apple" lever (currently absent)

No IP typing, no QR if you don't want it. The Mac **advertises a Bonjour service**; the
phone **browses** for it and offers "MermaidCollab found on Ben's Mac → tap to connect."
That AirPlay-picker moment is what separates "native" from "a form where I paste an
address."

- **Service:** `_mermaidcollab._tcp` advertised by the desktop app (Network.framework
  `NWListener`/`NetService` on the Bun/Electron side, or a tiny mDNS responder). TXT
  record carries `port`, protocol version, and (v2) the cert fingerprint.
- **Phone:** `NWBrowser` for `_mermaidcollab._tcp`; resolve to host:port; hydrate.
- **iOS Local Network permission is a first-class onboarding moment.** iOS 14+ requires
  `NSLocalNetworkUsageDescription` and shows the Local Network prompt on first Bonjour
  use. Design the pre-permission priming screen ("Zen finds your Mac on your wifi — no
  account, no cloud") and the denied-state fallback (manual host entry / QR). Getting this
  prompt to feel intentional *is* the first impression.

**Pairing handshake (target UX, HomeKit-style):** discover → tap → the desktop **"Phone
access" tab shows a 6-digit confirm code** → enter it on the phone → server validates the
short-lived code and issues the token. This avoids putting the token itself in a QR that
can be shoulder-surfed. **QR/deep-link stays as the fallback** (already built), so v1 can
ship on discovery + existing QR while the confirm-code endpoint is added.

---

## 4. Architecture at a glance

```
 iPhone (on LAN)                         Mac (desktop app / sidecar :9002)
 ┌────────────────────────┐             ┌───────────────────────────────────┐
 │ NWBrowser _mermaidcollab│  Bonjour   │ NWListener advertises              │
 │        ._tcp  ──────────┼────────────┤   _mermaidcollab._tcp              │
 │ ZenStore (WS + REST)    │  ws:// +   │ /ws  session_summary_updated,      │
 │   Bearer <token>  ──────┼── Bearer ──┤       escalation_*                 │
 │ MermaidCollabCore       │  (HTTP)    │ /api/supervisor/* (hydrate+act)    │
 │   selectors (freshness/ │            │ /api/pair, /pair/confirm (LAN)     │
 │   triage) — shared truth│            │ LAN guard: RFC1918 peer + token    │
 │ Keychain(token,cert fp) │            │ Bind: LAN iface, auth REQUIRED     │
 │ WidgetKit + LiveActivity│            │ config.json token authoritative    │
 └────────────────────────┘             └───────────────────────────────────┘
        data channel = LAN only              (APNs poke = opt-in, Mac→cloud)
```

- **Data channel** (`/ws` + REST hydrate + the action POSTs) is unchanged and LAN-scoped.
- **Shared truth:** `MermaidCollabCore` selectors are the *same* freshness/triage logic as
  the web UI — the phone and the Mac never disagree about what "needs attention" means.

---

## 5. Security model (LAN-only, enforced — not just defaulted)

1. **Bind to the LAN, auth always required.** `MERMAID_BIND_HOST=<lan-ip|0.0.0.0>` with
   the invariant from the remote-connectivity design: **a non-loopback bind is *always*
   token-gated.** No open-LAN hole, ever.
2. **A real LAN guard, not just a token.** Add a peer check that rejects any peer not in a
   private range (RFC1918 / same subnet) — so even a `0.0.0.0` bind is scoped to the local
   network. "LAN-only" becomes *enforced*, matching the product promise.
3. **Origin/Host allowlist** on WS upgrade + routes (absent today) — closes drive-by
   browser SSRF once the port is LAN-reachable.
4. **Token = the root secret** (existing). Rotatable (`/api/pair/rotate`); a 401 drops the
   phone's creds → re-pair. Keychain `kSecAttrAccessibleAfterFirstUnlock`.
5. **Pairing endpoints stay loopback-only** (existing 403-first). The *phone* never mints a
   token; the desktop (on loopback) does, and hands it over via the confirm-code/QR.
6. **v2:** self-signed TLS + cert pinning (fingerprint captured at pairing) for shared-LAN
   safety.

Net: the only ways in are (a) be on the LAN AND (b) hold the token AND (c) pass the
Origin/peer guards. Data never touches a cloud unless the user explicitly enables the APNs
poke.

---

## 6. Backend deltas (small)

| Need | Endpoint / change | Status |
|---|---|---|
| Approve/push a green card | `POST /api/supervisor/session/{…}/approve-push` (or reuse the green-card push path the web UI uses) | **new, 1 endpoint** |
| Confirm-code pairing (target UX) | `POST /api/pair/confirm { code }` + desktop code display | new (QR fallback exists) |
| Bonjour advertise | `NWListener`/mDNS responder in the desktop/sidecar | new |
| LAN peer guard + Origin allowlist | in the server `fetch`/WS upgrade | new |
| APNs poke (opt-in, P3) | Mac-side APNs sender + device-token registration | new, deferred |

Everything else (read-model, WS types, decide, nudge) already exists.

---

## 7. The "feels like an Apple app" spec — the last 80%

Native SwiftUI buys the baseline (no web-view tell). The gap to *delightful* is deliberate
craft. Audit every screen against **Emil Kowalski's eight categories** (his `skills` repo —
`improve-animations`): **purpose & frequency, easing & duration, physicality,
interruptibility, performance, accessibility, cohesion, missed opportunities.** House rules:

- **Enter with `ease-out`, exit with `ease-in`;** never `ease-in` on an entrance. Prefer
  **spring** physics for anything the user's touch drives.
- **Physicality:** glance-card → expanded uses `matchedGeometryEffect` so the card *grows
  into* detail, it doesn't cross-fade. The status dot **pulses like breathing** (slow,
  low-amplitude), not blinking.
- **Interruptibility:** every animation is cancellable mid-flight — a tap during a
  transition redirects, never queues. (Springs make this free.)
- **Haptics with intent:** a soft tick on decide/nudge; a firmer success haptic on
  approve/push (the consequential act earns a stronger confirmation).
- **Restraint & taste:** semi-transparent shadows over solid borders; one accent, calm
  neutrals; motion that's felt, not watched. "These little things compound."
- **Accessibility:** honor **Reduce Motion** (swap matched-geometry for a clean fade),
  Dynamic Type, VoiceOver labels on every card/action. Non-negotiable for "Apple."
- **Discovery-as-onboarding** (§3) is the first animation the user ever sees — treat the
  Bonjour "found your Mac" reveal and the Local-Network priming as a designed moment.
- Also apply his **`apple-design`** skill (WWDC principles) and **`animation-vocabulary`**
  when specifying motion to builders, so specs are precise, not "make it smooth."

---

## 8. Phasing

- **P1 — Foundation & feel.** LAN bind + guard + Origin allowlist; Bonjour discovery + the
  Local-Network onboarding; `NSAllowsLocalNetworking`; polish the glance grid and the three
  acts with the §7 craft pass. *Outcome: it works on the LAN, finds the Mac by itself, and
  already feels made.*
- **P2 — Ambient MVP.** WidgetKit Home/Lock-Screen widget (pure-LAN refresh). *Outcome: you
  stop opening the app.*
- **P3 — Live surface & (opt-in) reach.** Live Activity + the APNs-poke opt-in; confirm-code
  pairing; v2 TLS pinning. *Outcome: the lock screen is the product.*

Each phase is independently shippable and testable **on a real device on the LAN** (the
current build has only simulator artifacts — a device build + a physical-LAN test gate is
part of P1's definition of done).

---

## 9. Open questions for the human (genuinely undecided)

1. **APNs opt-in — worth it, or keep it strictly zero-cloud?** P3 hinges on this. My lean:
   offer it, off by default, clearly labeled — but it's a values call about the "no cloud"
   purity of the LAN promise.
2. **Approve/push from the phone — how much friction?** Swipe-to-confirm vs hold-to-confirm
   vs a plain confirm sheet. It's the only *destructive-ish* action; how guarded should it
   feel?
3. **Multi-Mac / multi-server?** Bonjour can surface several. Is Zen strictly one Mac, or a
   picker? (Affects the discovery UI and the credential store shape.)
4. **iPad — first-class or incidental?** The target is universal today; is a real iPad
   layout (sidebar + detail) in scope, or is this an iPhone story with iPad as a bonus?
5. **Shared-LAN threat model — is v2 TLS pinning actually needed for your use,** or is
   home-wifi-only realistic and pinning is over-engineering?

---

## 10. Non-goals

- No cloud backend, no account system, no push-by-default.
- No "work" surfaces on the phone (editing/planning/terminal).
- No Tailscale/from-anywhere in this mission (it remains the untouched escape hatch).
- No Android/React-Native/web-wrapper — native SwiftUI is the whole point.
