import Foundation

/// A watched session's summary tagged with the server it came from.
public struct SessionCard: Equatable, Sendable {
    public let summary: SessionSummary
    public let serverId: String

    public init(summary: SessionSummary, serverId: String) {
        self.summary = summary
        self.serverId = serverId
    }

    public var project: String { summary.project }
    public var session: String { summary.session }
    public var key: String { summary.key }
}

/// Namespace for folding per-server session-summary polls into a single, deduplicated,
/// registry-ordered list. Pure, total, no I/O.
public enum SessionCardMerge {
    /// Iterates `registry.entries` in order — the registry is the ordering authority, not the
    /// order of `results`. Entries whose reachability is `.unreachable` are skipped;
    /// `.unauthorized` still contributes. Within the surviving entries, the first occurrence of
    /// a given `SessionSummary.key` wins — later duplicates (whether from the same or a later
    /// server) are dropped.
    public static func merged(
        _ results: [(serverId: String, summaries: [SessionSummary])],
        registry: ServerRegistry
    ) -> [SessionCard] {
        var byServerId: [String: [SessionSummary]] = [:]
        for result in results {
            byServerId[result.serverId] = result.summaries
        }

        var out: [SessionCard] = []
        var seenKeys: Set<String> = []
        for entry in registry.entries {
            guard entry.reachability != .unreachable else { continue }
            guard let summaries = byServerId[entry.id] else { continue }
            for summary in summaries {
                guard seenKeys.insert(summary.key).inserted else { continue }
                out.append(SessionCard(summary: summary, serverId: entry.id))
            }
        }
        return out
    }
}
