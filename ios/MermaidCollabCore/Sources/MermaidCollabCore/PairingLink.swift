import Foundation

public struct PairingLink: Equatable {
    public let host: String
    public let port: Int
    public let token: String

    public var hostPort: String {
        "\(host):\(port)"
    }

    public static func parse(_ urlString: String) -> PairingLink? {
        guard let url = URL(string: urlString) else { return nil }
        return parse(url)
    }

    public static func parse(_ url: URL) -> PairingLink? {
        guard let comps = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            return nil
        }
        return parsePairingLink(from: comps)
    }

    private static func parsePairingLink(from comps: URLComponents) -> PairingLink? {
        guard comps.scheme == "mermaidcollab", comps.host == "pair" else { return nil }

        let queryItems = comps.queryItems ?? []
        guard let hostParam = queryItems.first(where: { $0.name == "host" })?.value, !hostParam.isEmpty,
              let token = queryItems.first(where: { $0.name == "token" })?.value, !token.isEmpty else {
            return nil
        }

        let normalized = normalizeHost(hostParam)

        guard let (bareHost, port) = splitHostPort(normalized) else {
            return nil
        }

        return PairingLink(host: bareHost, port: port, token: token)
    }

    private static func normalizeHost(_ raw: String) -> String {
        var h = raw.trimmingCharacters(in: .whitespaces)
        for p in ["http://", "https://", "ws://", "wss://"] where h.hasPrefix(p) {
            h.removeFirst(p.count)
        }
        if h.hasSuffix("/") { h.removeLast() }
        if !h.contains(":") { h += ":9002" }
        return h
    }

    private static func splitHostPort(_ hostPortString: String) -> (String, Int)? {
        guard let lastColonIndex = hostPortString.lastIndex(of: ":") else {
            return nil
        }

        let bareHost = String(hostPortString[..<lastColonIndex])
        let portStr = String(hostPortString[hostPortString.index(after: lastColonIndex)...])

        guard !portStr.isEmpty, let port = Int(portStr), port > 0 else {
            return nil
        }

        return (bareHost, port)
    }
}
