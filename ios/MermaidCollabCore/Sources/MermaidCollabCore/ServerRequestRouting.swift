import Foundation

/// A resolved destination for a request: which server to hit, and the URL to hit it at.
public struct ServerRequestRoute: Equatable, Sendable {
    public let serverId: String
    /// host:port form, exactly as stored in `ServerEntry.host`.
    public let host: String
    public let path: String

    public init(serverId: String, host: String, path: String) {
        self.serverId = serverId
        self.host = host
        self.path = path
    }

    public var url: URL? {
        URL(string: "http://\(host)\(path)")
    }
}

/// Namespace for building `ServerRequestRoute`s. Pure, total, no I/O.
public enum ServerRequestRouter {
    /// Routes a project-scoped request to the project's owning server, falling back to
    /// `selectedServerId` when ownership is unclaimed or unresolvable. Ownership resolution is
    /// delegated entirely to `ProjectOwnership.owner` — this function never re-derives claimants.
    public static func route(
        forProject project: String,
        path: String,
        registry: ServerRegistry,
        projectsByServerId: [String: [String]],
        selectedServerId: String,
        localServerId: String?
    ) -> ServerRequestRoute {
        let resolvedId = ProjectOwnership.owner(
            ofProject: project,
            projectsByServerId: projectsByServerId,
            localServerId: localServerId,
            fallbackServerId: selectedServerId
        )

        let host = registry.entries.first { $0.id == resolvedId }?.host
            ?? registry.entries.first { $0.id == selectedServerId }?.host
            ?? ""

        return ServerRequestRoute(serverId: resolvedId, host: host, path: path)
    }

    /// Routes a request that already names one explicit server (auth check, escalation
    /// hydrate/decide). `ProjectOwnership` is not consulted.
    public static func route(
        serverId: String,
        path: String,
        registry: ServerRegistry
    ) -> ServerRequestRoute {
        let host = registry.entries.first { $0.id == serverId }?.host ?? ""
        return ServerRequestRoute(serverId: serverId, host: host, path: path)
    }
}
