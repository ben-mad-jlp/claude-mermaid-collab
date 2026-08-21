/// A single watched project or session, always carrying the id of the server that owns it —
/// so a later write can be routed back to that server rather than to whichever server the
/// picker happens to have selected.
public struct WatchEntry: Codable, Equatable, Sendable {
    public let serverId: String
    public let project: String
    /// `nil` == project-scoped; non-nil == session-scoped.
    public let session: String?

    public init(serverId: String, project: String, session: String? = nil) {
        self.serverId = serverId
        self.project = project
        self.session = session
    }
}

/// A collection of `WatchEntry` values, identified by the (serverId, project, session) triple.
/// Pure, total, no I/O.
public struct WatchList: Codable, Equatable, Sendable {
    public var entries: [WatchEntry]

    public init(entries: [WatchEntry] = []) {
        self.entries = entries
    }

    /// Appends `entry` unless an entry with the same (serverId, project, session) triple is
    /// already present, in which case the list is returned unchanged.
    public func adding(_ entry: WatchEntry) -> WatchList {
        let alreadyPresent = entries.contains {
            $0.serverId == entry.serverId && $0.project == entry.project && $0.session == entry.session
        }
        if alreadyPresent {
            return self
        }
        return WatchList(entries: entries + [entry])
    }

    /// Drops only the entry matching all three of `serverId`, `project` and `session`. A
    /// `session: nil` argument removes the project-scoped entry only — it never touches that
    /// project's session-scoped entries, and it never touches another server's entries.
    public func removing(serverId: String, project: String, session: String?) -> WatchList {
        WatchList(entries: entries.filter {
            !($0.serverId == serverId && $0.project == project && $0.session == session)
        })
    }

    /// Folds per-server results in argument order into one `WatchList`, de-duplicating on the
    /// (serverId, project, session) triple — first occurrence wins, order preserved. Unlike
    /// `ServerProjectsMapping.mapping` (which appends on a repeated serverId), a repeated triple
    /// here collapses, so a server listed twice in one poll cannot double a row.
    public static func list(from results: [(serverId: String, entries: [WatchEntry])]) -> WatchList {
        var out: [WatchEntry] = []
        var seen = Set<String>()
        for result in results {
            for entry in result.entries {
                let key = "\(entry.serverId)\u{0}\(entry.project)\u{0}\(entry.session ?? "")"
                if seen.insert(key).inserted {
                    out.append(entry)
                }
            }
        }
        return WatchList(entries: out)
    }
}
