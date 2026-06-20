import Foundation

// Domain models for the Zen monitoring surface, mirroring the web UI's store shapes
// (ui/src/stores/supervisorStore.ts + ui/src/lib/triageSelectors.ts). Kept minimal:
// only the fields the pure selectors read. Populated on-device exclusively from the
// sidecar's HTTP hydrate + WS feed (the same pure-HTTP+WS contract Zen was built for).

/// A watched session's structural progress state (pane-hash heartbeat derived).
public enum ProgressState: String, Codable, Sendable {
    case active, quiet, stalled, wedged, unknown
}

/// One watched session's summary row.
public struct SessionSummary: Codable, Sendable, Equatable {
    public let project: String
    public let session: String
    public var progressState: ProgressState
    /// Wall-clock (epoch ms) the pane was last seen changing.
    public var paneSeenAt: Double
    public var updatedAt: Double
    /// Epoch ms until which the operator snoozed this session (excluded from triage).
    public var snoozedUntil: Double?
    /// Epoch ms of the last interpreter summary write (Z7+); drives paragraph recency.
    public var summaryUpdatedAt: Double?
    /// Interpreter loop refresh state; "stale-failing" signals a stuck loop (Z9).
    public var refreshState: String?
    /// The human-readable progress paragraph (Z7 interpreter output).
    public var paragraph: String?

    public init(
        project: String,
        session: String,
        progressState: ProgressState,
        paneSeenAt: Double,
        updatedAt: Double,
        snoozedUntil: Double? = nil,
        summaryUpdatedAt: Double? = nil,
        refreshState: String? = nil,
        paragraph: String? = nil
    ) {
        self.project = project
        self.session = session
        self.progressState = progressState
        self.paneSeenAt = paneSeenAt
        self.updatedAt = updatedAt
        self.snoozedUntil = snoozedUntil
        self.summaryUpdatedAt = summaryUpdatedAt
        self.refreshState = refreshState
        self.paragraph = paragraph
    }

    /// `${project}::${session}` — the store key + session triage-item id suffix.
    public var key: String { "\(project)::\(session)" }
}

/// An open decision/approval needing the human. Minimal projection of the wire row.
public struct Escalation: Codable, Sendable, Equatable {
    public let id: String
    public let project: String
    public let session: String
    public var status: String        // "open" | resolved states
    public var createdAt: Double     // epoch ms
    public var operatorGated: Bool?  // arrives 0|1 on the wire
    public var serverId: String?

    public init(
        id: String,
        project: String,
        session: String,
        status: String,
        createdAt: Double,
        operatorGated: Bool? = nil,
        serverId: String? = nil
    ) {
        self.id = id
        self.project = project
        self.session = session
        self.status = status
        self.createdAt = createdAt
        self.operatorGated = operatorGated
        self.serverId = serverId
    }
}

/// Read-model freshness — keyed off the heartbeat clock, the dead-man's switch.
public struct Freshness: Sendable, Equatable {
    public let live: Bool
    public let lastRefreshAt: Double
    public init(live: Bool, lastRefreshAt: Double) {
        self.live = live
        self.lastRefreshAt = lastRefreshAt
    }
}

public enum VerdictTone: String, Sendable, Equatable {
    case clear, attention, urgent, disconnected
}

/// The Verdict Bar's single source of truth.
public struct Verdict: Sendable, Equatable {
    public let tone: VerdictTone
    public let line: String
    public let updatedAt: Double
    public init(tone: VerdictTone, line: String, updatedAt: Double) {
        self.tone = tone
        self.line = line
        self.updatedAt = updatedAt
    }
}

/// A merged triage item — an open escalation or a wedged/unknown session.
public enum TriageItem: Sendable, Equatable {
    case escalation(severity: Int, since: Double, escalation: Escalation)
    case wedge(severity: Int, since: Double, summary: SessionSummary)
    case unknown(severity: Int, since: Double, summary: SessionSummary)

    public var severity: Int {
        switch self {
        case let .escalation(s, _, _), let .wedge(s, _, _), let .unknown(s, _, _): return s
        }
    }
    public var since: Double {
        switch self {
        case let .escalation(_, t, _), let .wedge(_, t, _), let .unknown(_, t, _): return t
        }
    }
    /// Stable, kind-uniform id (matches the TS triageItemId).
    public var id: String {
        switch self {
        case let .escalation(_, _, e): return e.id
        case let .wedge(_, _, s): return "wedge:\(s.key)"
        case let .unknown(_, _, s): return "unknown:\(s.key)"
        }
    }
}
