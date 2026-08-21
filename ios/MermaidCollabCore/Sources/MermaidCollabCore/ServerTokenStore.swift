import Foundation

/// Per-server-id bearer token storage. Bearer tokens never enter `ServerEntry` or the
/// persisted `ServerRegistry` JSON — this protocol is the seam between that model and
/// wherever the token actually lives (Keychain in the app target, memory in tests).
///
/// Mutation members are non-`mutating` so both a stateless `struct` conformer (the
/// Keychain one) and a stateful `final class` conformer can satisfy the protocol
/// without `mutating` fan-out at call sites.
public protocol ServerTokenStore {
    func token(forServerId serverId: String) -> String?
    func setToken(_ token: String, forServerId serverId: String)
    func removeToken(forServerId serverId: String)
}

/// Headless-testable in-memory `ServerTokenStore`, keyed by server id.
public final class InMemoryServerTokenStore: ServerTokenStore {
    private var tokens: [String: String] = [:]

    public init() {}

    public func token(forServerId serverId: String) -> String? {
        tokens[serverId]
    }

    public func setToken(_ token: String, forServerId serverId: String) {
        tokens[serverId] = token
    }

    public func removeToken(forServerId serverId: String) {
        tokens.removeValue(forKey: serverId)
    }
}
