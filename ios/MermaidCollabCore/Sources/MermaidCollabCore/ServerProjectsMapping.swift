/// Namespace for folding one shared poll of per-server project lists into the map
/// `ProjectOwnership.owner` consumes. Pure, total, no I/O.
public enum ServerProjectsMapping {
    /// Folds `(serverId, projects)` pairs into a `serverId -> projects` dictionary. A
    /// duplicate `serverId` appends its projects to the existing list rather than
    /// overwriting it, so a repeated entry can never erase an earlier list.
    public static func mapping(from results: [(serverId: String, projects: [String])]) -> [String: [String]] {
        var out: [String: [String]] = [:]
        for result in results {
            out[result.serverId, default: []].append(contentsOf: result.projects)
        }
        return out
    }
}
