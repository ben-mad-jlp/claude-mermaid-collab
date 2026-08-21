import Foundation

/// Turns a set of per-server fetch OUTCOMES into the merged, paged home feed. Pure, total, no
/// I/O. Origin-tagging, registry-order dedupe and the `.unreachable` filter stay owned by
/// `SessionCardMerge.merged`; the ceiling and `omittedCount` stay owned by `RowPage.build`. This
/// layer only decides what each server CONTRIBUTES to the merge input.
public enum HomeFeed {
    /// The outcome of polling one server for its session summaries this round.
    public enum ServerFetch: Sendable {
        case answered([SessionSummary])
        case failed
    }

    /// A server that `.answered` (even with an empty list) contributes that answer verbatim — an
    /// explicit empty answer is authoritative and clears that server's rows. A server that
    /// `.failed` contributes its last-known cards from `previous`, preserving their order, so a
    /// server that fails to answer keeps its last-known cards. Carry-through happens on the
    /// merge INPUT side, before `SessionCardMerge.merged` runs, so a carried card is still
    /// subject to `merged`'s `.unreachable` filter and first-key-wins dedupe against fresher rows
    /// from other servers.
    public static func page(
        previous: [SessionCard],
        results: [(serverId: String, fetch: ServerFetch)],
        registry: ServerRegistry,
        pageSize: Int
    ) -> RowPage<SessionCard> {
        let mergeInputs: [(serverId: String, summaries: [SessionSummary])] = results.map { result in
            switch result.fetch {
            case .answered(let summaries):
                return (serverId: result.serverId, summaries: summaries)
            case .failed:
                let carried = previous
                    .filter { $0.serverId == result.serverId }
                    .map(\.summary)
                return (serverId: result.serverId, summaries: carried)
            }
        }

        let merged = SessionCardMerge.merged(mergeInputs, registry: registry)
        return RowPage.build(rows: merged, pageSize: pageSize)
    }
}
