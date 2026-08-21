import Foundation

/// Builds a `ServerEntry` from a hand-typed host string + bearer token — the manual
/// (non-QR-pairing) server-entry path. Pure and total: never throws, never traps, and never
/// returns nil, however garbled the input.
public enum ManualServerEntry {
    /// Default port used when `host` carries no `:port` suffix, matching `PairingLink`'s default.
    private static let defaultPort = 9002

    public static func entry(host: String, token: String, id: String, label: String? = nil) -> ServerEntry {
        let trimmed = host.trimmingCharacters(in: .whitespacesAndNewlines)
        let (bareHost, port) = splitHostPort(trimmed)

        return ServerEntry(
            id: id,
            label: label ?? trimmed,
            host: trimmed,
            source: .manual,
            pairing: PairingLink(host: bareHost, port: port, token: token)
        )
    }

    /// Splits `hostPortString` on its LAST `:`. If the tail parses as a positive Int, that's the
    /// port; otherwise (or if there's no `:` at all) the whole string is the bare host and the
    /// port defaults to `defaultPort`. Total — never nil.
    private static func splitHostPort(_ hostPortString: String) -> (String, Int) {
        guard let lastColonIndex = hostPortString.lastIndex(of: ":") else {
            return (hostPortString, defaultPort)
        }

        let bareHost = String(hostPortString[..<lastColonIndex])
        let portStr = String(hostPortString[hostPortString.index(after: lastColonIndex)...])

        guard !portStr.isEmpty, let port = Int(portStr), port > 0 else {
            return (hostPortString, defaultPort)
        }

        return (bareHost, port)
    }
}
