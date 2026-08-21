import Foundation

/// How a server entry entered the registry — QR/deep-link pairing vs. hand-typed host.
public enum ServerSource: String, Codable, Sendable {
    case paired, manual
}

/// Last-known reachability of a registered server. Closed union extended by later arms.
public enum ServerReachability: String, Codable, Sendable {
    case reachable, unreachable, unauthorized
}

/// One registered server the phone can connect to.
public struct ServerEntry: Codable, Equatable, Sendable {
    public let id: String
    public var label: String
    public var host: String
    public var source: ServerSource
    public var pairing: PairingLink?
    public var reachability: ServerReachability

    public init(
        id: String,
        label: String,
        host: String,
        source: ServerSource,
        pairing: PairingLink? = nil,
        reachability: ServerReachability = .unreachable
    ) {
        self.id = id
        self.label = label
        self.host = host
        self.source = source
        self.pairing = pairing
        self.reachability = reachability
    }
}

/// The operator's ordered list of registered servers. Order is model state — never sorted or keyed.
public struct ServerRegistry: Codable, Equatable, Sendable {
    public var entries: [ServerEntry]

    public init(entries: [ServerEntry] = []) {
        self.entries = entries
    }

    public func encoded() throws -> Data {
        try JSONEncoder().encode(self)
    }

    public static func decoded(from data: Data) throws -> ServerRegistry {
        try JSONDecoder().decode(ServerRegistry.self, from: data)
    }

    /// Merges a pairing payload into this registry, upserting entries by id and preserving order.
    /// Matching ids are updated in place at their current index; new ids are appended in payload
    /// order; entries whose ids are absent from the payload carry through unchanged.
    public func merging(_ payload: PairingPayload) -> ServerRegistry {
        var result = self.entries
        var indexById: [String: Int] = [:]
        for (i, entry) in result.enumerated() {
            indexById[entry.id] = i
        }

        for server in payload.servers {
            let pairing = PairingLink(host: server.host, port: server.port, token: server.token)
            if let i = indexById[server.id] {
                result[i].label = server.label
                result[i].host = "\(server.host):\(server.port)"
                result[i].pairing = pairing
                result[i].source = .paired
            } else {
                let newEntry = ServerEntry(
                    id: server.id,
                    label: server.label,
                    host: "\(server.host):\(server.port)",
                    source: .paired,
                    pairing: pairing
                )
                result.append(newEntry)
                indexById[server.id] = result.count - 1
            }
        }

        return ServerRegistry(entries: result)
    }
}
