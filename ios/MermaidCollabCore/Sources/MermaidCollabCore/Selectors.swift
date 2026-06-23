import Foundation

// PURE selectors — a faithful Swift port of the web UI's freshnessSelectors.ts +
// triageSelectors.ts. Same semantics, same test cases (incl. the wedge-not-green
// regression fixed in v6.7.1). No I/O, no Date.now() — callers inject `now` — so the
// whole monitoring verdict is unit-testable headlessly and identical to the web UI.

public enum Zen {
    /// Default dead-man's-switch window (mirrors GONE_MS in subscriptionStore.ts).
    public static let goneMs: Double = 15 * 60_000

    // Severity tiers — HIGHER = more urgent (triageSelectors.ts).
    public static let sevGatedOrWedged = 3 // operatorGated escalation | wedged session
    public static let sevRoutine = 2        // any other open escalation
    public static let sevUnknownSoft = 1    // unknown-liveness session

    /// Marks the operator has locally applied, mirroring TriageStackOpts.
    public struct TriageOpts: Sendable {
        public var onlyYouIds: Set<String>
        public var clearedIds: Set<String>
        public init(onlyYouIds: Set<String> = [], clearedIds: Set<String> = []) {
            self.onlyYouIds = onlyYouIds
            self.clearedIds = clearedIds
        }
    }

    /// Read-model freshness. `live` requires a real prior message (`> 0`) within
    /// `goneMs`; the boundary `now - last == goneMs` is still live (`<=`).
    public static func freshness(lastWsMessageAt: Double, now: Double, goneMs: Double = goneMs) -> Freshness {
        let live = lastWsMessageAt > 0 && now - lastWsMessageAt <= goneMs
        return Freshness(live: live, lastRefreshAt: lastWsMessageAt)
    }

    static func effectiveOperatorGated(_ e: Escalation, _ onlyYou: Set<String>) -> Bool {
        (e.operatorGated ?? false) || onlyYou.contains(e.id)
    }

    static func escalationSeverity(_ e: Escalation, _ onlyYou: Set<String>) -> Int {
        effectiveOperatorGated(e, onlyYou) ? sevGatedOrWedged : sevRoutine
    }

    /// Merged triage stack: severity DESC, then age ASC (oldest `since` first within a
    /// tier). Snoozed + optimistically-cleared items excluded. Only-you promotes to top.
    public static func triageStack(
        openEscalations: [Escalation],
        sessionSummaries: [String: SessionSummary],
        now: Double,
        opts: TriageOpts = .init()
    ) -> [TriageItem] {
        var items: [TriageItem] = []

        for e in openEscalations {
            guard e.status == "open" else { continue }
            let item = TriageItem.escalation(
                severity: escalationSeverity(e, opts.onlyYouIds), since: e.createdAt, escalation: e)
            if opts.clearedIds.contains(item.id) { continue }
            items.append(item)
        }

        // Deterministic iteration order (dict is unordered) so the stable sort's
        // tie-breaks match the web UI; sort below is the real ordering anyway.
        for s in sessionSummaries.values.sorted(by: { $0.key < $1.key }) {
            if let snz = s.snoozedUntil, now < snz { continue } // snoozed → out
            switch s.progressState {
            case .wedged:
                let item = TriageItem.wedge(severity: sevGatedOrWedged, since: s.paneSeenAt, summary: s)
                if opts.clearedIds.contains(item.id) { continue }
                items.append(item)
            case .unknown:
                let id = "unknown:\(s.key)"
                let sev = opts.onlyYouIds.contains(id) ? sevGatedOrWedged : sevUnknownSoft
                let item = TriageItem.unknown(severity: sev, since: s.paneSeenAt, summary: s)
                if opts.clearedIds.contains(item.id) { continue }
                items.append(item)
            case .active, .quiet, .stalled:
                break // do not enter the stack (stalled only tints the pill)
            }
        }

        return items.sorted { a, b in
            a.severity != b.severity ? a.severity > b.severity : a.since < b.since
        }
    }

    public static func triageTop(
        openEscalations: [Escalation],
        sessionSummaries: [String: SessionSummary],
        now: Double,
        opts: TriageOpts = .init()
    ) -> TriageItem? {
        triageStack(openEscalations: openEscalations, sessionSummaries: sessionSummaries, now: now, opts: opts).first
    }

    /// HH:MM in the viewer's locale/timezone (mirrors fmtHHMM).
    public static func hhmm(_ epochMs: Double) -> String {
        let f = DateFormatter()
        f.dateFormat = "HH:mm"
        return f.string(from: Date(timeIntervalSince1970: epochMs / 1000))
    }

    /// The Verdict Bar's single source of truth. DEAD-MAN'S SWITCH FIRST, then folds
    /// the SAME triage truth Zone-1 promotes from — needs-you decisions AND
    /// wedged/unknown sessions — so Zone-0 can never read green "All clear" over a
    /// session the focus card flags as stuck (web fix 899f33a7). Tone graded: URGENT
    /// for a wedged session or waiting decision; ATTENTION (amber) for unknown-liveness
    /// only (416e00bb — the amber branch is now actually emitted).
    public static func verdict(
        openEscalations: [Escalation],
        sessionSummaries: [String: SessionSummary],
        freshness: Freshness,
        now: Double,
        opts: TriageOpts = .init()
    ) -> Verdict {
        if !freshness.live {
            let line = freshness.lastRefreshAt > 0
                ? "NOT UPDATING — reconnecting (last good \(hhmm(freshness.lastRefreshAt)))"
                : "NOT UPDATING — reconnecting…"
            return Verdict(tone: .disconnected, line: line, updatedAt: freshness.lastRefreshAt)
        }
        let stack = triageStack(openEscalations: openEscalations, sessionSummaries: sessionSummaries, now: now, opts: opts)
        if stack.isEmpty {
            return Verdict(tone: .clear, line: "All clear", updatedAt: now)
        }
        var stuck = 0, decisions = 0, unknown = 0
        for it in stack {
            switch it {
            case .wedge: stuck += 1
            case .escalation: decisions += 1
            case .unknown: unknown += 1
            }
        }
        var parts: [String] = []
        if stuck > 0 { parts.append("\(stuck) session\(stuck == 1 ? "" : "s") stuck") }
        if decisions > 0 { parts.append("\(decisions) decision\(decisions == 1 ? "" : "s") waiting") }
        if unknown > 0 { parts.append("\(unknown) session\(unknown == 1 ? "" : "s") unknown") }
        let tone: VerdictTone = (stuck > 0 || decisions > 0) ? .urgent : .attention
        return Verdict(tone: tone, line: parts.joined(separator: " · "), updatedAt: now)
    }

    /// Always-visible paragraph stack: recency-sorted (max of summary/pane/updated
    /// timestamps) DESC, capped to `cap` (default 5). Mirrors selectParagraphStack.
    public static func paragraphStack(
        sessionSummaries: [String: SessionSummary],
        cap: Int = 5
    ) -> [SessionSummary] {
        func recency(_ s: SessionSummary) -> Double {
            max(s.summaryUpdatedAt ?? 0, s.paneSeenAt, s.updatedAt)
        }
        return sessionSummaries.values
            .sorted { a, b in
                let ra = recency(a), rb = recency(b)
                return ra != rb ? ra > rb : a.key < b.key
            }
            .prefix(cap)
            .map { $0 }
    }

    /// Minutes of no-progress for a wedged/unknown session, for the card label.
    public static func wedgeMinutes(_ s: SessionSummary, now: Double) -> Int {
        max(0, Int((now - s.paneSeenAt) / 60_000))
    }
}
