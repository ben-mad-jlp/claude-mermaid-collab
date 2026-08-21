/// Namespace for resolving which server "owns" a project path. Pure, total, no I/O.
public enum ProjectOwnership {
    /// Resolves the owning server id for `path` given a map of server id -> project paths that
    /// server claims.
    ///
    /// Resolution order:
    /// 1. No server lists `path` -> `fallbackServerId`.
    /// 2. Exactly one server lists `path` -> that server's id.
    /// 3. Two or more servers list `path` -> `localServerId` when it is one of the claimants,
    ///    else the lexicographically smallest claimant id (via `min()`, never dictionary
    ///    iteration order, which is hash-seeded and varies per process).
    public static func owner(
        ofProject path: String,
        projectsByServerId: [String: [String]],
        localServerId: String?,
        fallbackServerId: String
    ) -> String {
        let claimants = projectsByServerId
            .filter { $0.value.contains(path) }
            .map { $0.key }

        if claimants.isEmpty {
            return fallbackServerId
        }
        if claimants.count == 1 {
            return claimants[0]
        }
        if let localServerId, claimants.contains(localServerId) {
            return localServerId
        }
        return claimants.min()!
    }
}
