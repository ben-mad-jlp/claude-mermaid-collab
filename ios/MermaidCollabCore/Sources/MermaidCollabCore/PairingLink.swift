import Foundation

public struct PairingLink: Codable, Equatable, Sendable {
    public let host: String
    public let port: Int
    public let token: String

    public init(host: String, port: Int, token: String) {
        self.host = host
        self.port = port
        self.token = token
    }

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

    /// One server entry within a multi-entry pairing payload.
    private struct PayloadServerDTO: Decodable {
        let id: String
        let label: String
        let host: String
        let token: String
    }

    /// Version-2 wrapper around a multi-entry pairing payload.
    private struct PayloadEnvelopeDTO: Decodable {
        let version: Int
        let servers: [PayloadServerDTO]
    }

    public static func parsePayload(_ urlString: String) -> PairingPayload? {
        guard let url = URL(string: urlString) else { return nil }
        guard let comps = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
        guard comps.scheme == "mermaidcollab", comps.host == "pair" else { return nil }

        let queryItems = comps.queryItems ?? []
        if let serversParam = queryItems.first(where: { $0.name == "servers" })?.value, !serversParam.isEmpty {
            guard let data = decodeBase64(serversParam) else { return nil }

            let dtos: [PayloadServerDTO]
            if let env = try? JSONDecoder().decode(PayloadEnvelopeDTO.self, from: data) {
                guard env.version == 2 else { return nil }
                dtos = env.servers
            } else if let bareDtos = try? JSONDecoder().decode([PayloadServerDTO].self, from: data) {
                dtos = bareDtos
            } else {
                return nil
            }

            var servers: [PairingPayloadServer] = []
            servers.reserveCapacity(dtos.count)
            for dto in dtos {
                guard !dto.id.isEmpty, !dto.token.isEmpty else { return nil }
                let normalized = normalizeHost(dto.host)
                guard let (bareHost, port) = splitHostPort(normalized) else { return nil }
                servers.append(PairingPayloadServer(
                    id: dto.id,
                    label: dto.label,
                    host: bareHost,
                    port: port,
                    token: dto.token
                ))
            }
            return PairingPayload(servers: servers)
        }

        guard let link = parse(url) else { return nil }
        let server = PairingPayloadServer(
            id: link.hostPort,
            label: link.host,
            host: link.host,
            port: link.port,
            token: link.token
        )
        return PairingPayload(servers: [server])
    }

    private static func decodeBase64(_ raw: String) -> Data? {
        var s = raw.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        let remainder = s.count % 4
        if remainder > 0 {
            s += String(repeating: "=", count: 4 - remainder)
        }
        return Data(base64Encoded: s)
    }
}

/// One server carried in a multi-entry pairing payload.
public struct PairingPayloadServer: Equatable, Sendable {
    public let id: String
    public let label: String
    public let host: String
    public let port: Int
    public let token: String

    public init(id: String, label: String, host: String, port: Int, token: String) {
        self.id = id
        self.label = label
        self.host = host
        self.port = port
        self.token = token
    }
}

/// The decoded contents of a pairing deep link — one or more servers.
public struct PairingPayload: Equatable, Sendable {
    public let servers: [PairingPayloadServer]

    public init(servers: [PairingPayloadServer]) {
        self.servers = servers
    }
}
