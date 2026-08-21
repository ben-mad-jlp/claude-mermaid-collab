/// Namespace for folding per-server escalation polls into a single list, and for routing a
/// decide request back to the card's own origin server. Pure, total, no I/O.
public enum EscalationMerge {
    /// Flattens per-server escalation lists in input order, stamping each card's `serverId`
    /// to the origin server of the tuple it came from — overwriting whatever the wire row
    /// carried, since the poll knows the truth. No dedup, no sort: order is the caller's
    /// contract.
    public static func merged(_ results: [(serverId: String, escalations: [Escalation])]) -> [Escalation] {
        var out: [Escalation] = []
        for result in results {
            for var escalation in result.escalations {
                escalation.serverId = result.serverId
                out.append(escalation)
            }
        }
        return out
    }

    /// Routes a decide request to the card's own server, falling back to `selectedServerId`
    /// only when the card carries no `serverId`. Delegates entirely to
    /// `ServerRequestRouter.route(serverId:path:registry:)` — hosts are never re-derived here.
    public static func decideRoute(
        for card: Escalation,
        registry: ServerRegistry,
        selectedServerId: String
    ) -> ServerRequestRoute {
        ServerRequestRouter.route(
            serverId: card.serverId ?? selectedServerId,
            path: "/api/supervisor/escalation/\(card.id)/decide",
            registry: registry
        )
    }
}
