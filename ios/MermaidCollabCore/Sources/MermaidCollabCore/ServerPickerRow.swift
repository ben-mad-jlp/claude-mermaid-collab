import Foundation

/// One row of the server picker: a registry entry's display facts plus how many projects it
/// owns. Pure, total, no I/O — same shape as `ServerProjectsMapping` / `reachabilityState`
/// (`Reachability.swift:12`).
public struct ServerPickerRow: Equatable, Sendable {
    public let id: String
    public let label: String
    public let reachability: ServerReachability
    public let projectCount: Int

    public init(id: String, label: String, reachability: ServerReachability, projectCount: Int) {
        self.id = id
        self.label = label
        self.reachability = reachability
        self.projectCount = projectCount
    }

    /// Maps `registry.entries` in order, one row per entry, taking `label` and `reachability`
    /// verbatim off `ServerEntry` — no probing, sorting, filtering, or re-defaulting
    /// reachability. Callers stamp reachability first via the shipped
    /// `ServerRegistry.applyingProbeResults` (`Reachability.swift:32`), which already defaults
    /// absent ids to `.unreachable`. A server with no mapped projects gets `projectCount == 0`,
    /// never dropped from the list.
    public static func rows(
        registry: ServerRegistry,
        projectsByServerId: [String: [String]]
    ) -> [ServerPickerRow] {
        registry.entries.map { entry in
            ServerPickerRow(
                id: entry.id,
                label: entry.label,
                reachability: entry.reachability,
                projectCount: projectsByServerId[entry.id]?.count ?? 0
            )
        }
    }
}
