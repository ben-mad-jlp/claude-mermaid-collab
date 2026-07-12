import Foundation
import Network

/// Bonjour discovery of the desktop server (`_mermaidcollab._tcp`) on the LAN — the
/// AirPlay-picker "found your Mac" moment (design §3). Uses NWBrowser (Network.framework);
/// requires NSLocalNetworkUsageDescription + NSBonjourServices (set in project.yml) and
/// triggers the iOS Local Network permission prompt on first browse.
///
/// v1 hands the resolved `host:port` to the pairing flow; the bearer token still comes from
/// the QR/deep-link or manual entry (discovery locates the Mac, it does not convey secrets).
@MainActor
final class Discovery: ObservableObject {
    struct Service: Identifiable, Equatable {
        let id: String        // Bonjour instance name (stable id)
        let name: String
        var hostPort: String? // "host:port" once resolved (e.g. "Bens-Mac.local:9002")
    }

    @Published private(set) var services: [Service] = []
    @Published private(set) var browsing = false
    /// True once the Local Network permission is denied (NWBrowser goes `.waiting`/`.failed`
    /// with a permission error) — the UI falls back to manual host entry / QR.
    @Published private(set) var permissionLikelyDenied = false

    private var browser: NWBrowser?
    private var endpoints: [String: NWEndpoint] = [:] // service id → endpoint (for resolve)

    func start() {
        guard browser == nil else { return }
        let params = NWParameters()
        params.includePeerToPeer = false
        let b = NWBrowser(for: .bonjour(type: "_mermaidcollab._tcp", domain: nil), using: params)
        browser = b

        b.stateUpdateHandler = { [weak self] state in
            Task { @MainActor in
                guard let self else { return }
                switch state {
                case .ready:
                    self.browsing = true
                    self.permissionLikelyDenied = false
                case .waiting:
                    // Local Network permission not (yet) granted, or no network. Keep
                    // trying; flag so the UI can offer the manual fallback.
                    self.browsing = true
                    self.permissionLikelyDenied = true
                case .failed, .cancelled:
                    self.browsing = false
                default:
                    break
                }
            }
        }
        b.browseResultsChangedHandler = { [weak self] results, _ in
            Task { @MainActor in self?.apply(results) }
        }
        b.start(queue: .main)
        browsing = true
    }

    func stop() {
        browser?.cancel()
        browser = nil
        browsing = false
        services = []
        endpoints = [:]
    }

    private func apply(_ results: Set<NWBrowser.Result>) {
        var out: [Service] = []
        var eps: [String: NWEndpoint] = [:]
        for r in results {
            if case let .service(name, _, _, _) = r.endpoint {
                out.append(Service(id: name, name: name, hostPort: services.first { $0.id == name }?.hostPort))
                eps[name] = r.endpoint
            }
        }
        endpoints = eps
        services = out.sorted { $0.name < $1.name }
    }

    /// Resolve a discovered service to a concrete `host:port` by opening a short-lived
    /// NWConnection and reading its resolved remote endpoint, then handing back the
    /// `host:port` string the pairing flow / URLSession WebSocket uses. Best-effort.
    func resolve(_ service: Service, completion: @escaping (String?) -> Void) {
        guard let endpoint = endpoints[service.id] else { completion(nil); return }
        let conn = NWConnection(to: endpoint, using: .tcp)
        var done = false
        let finish: (String?) -> Void = { result in
            guard !done else { return }
            done = true
            conn.cancel()
            Task { @MainActor in
                if let result { self.markResolved(service.id, hostPort: result) }
                completion(result)
            }
        }
        conn.stateUpdateHandler = { state in
            switch state {
            case .ready:
                if case let .hostPort(host, port) = conn.currentPath?.remoteEndpoint {
                    finish("\(Self.hostString(host)):\(port.rawValue)")
                } else {
                    finish(nil)
                }
            case .failed, .cancelled:
                finish(nil)
            default:
                break
            }
        }
        conn.start(queue: .global())
        // Safety timeout so a stuck resolve never hangs the picker.
        DispatchQueue.global().asyncAfter(deadline: .now() + 4) { finish(nil) }
    }

    private func markResolved(_ id: String, hostPort: String) {
        if let i = services.firstIndex(where: { $0.id == id }) {
            services[i].hostPort = hostPort
        }
    }

    /// Render an NWEndpoint.Host for a URL: prefer the .local name, else the IP literal.
    /// `nonisolated` — pure, called from the connection handler (off the main actor).
    private nonisolated static func hostString(_ host: NWEndpoint.Host) -> String {
        switch host {
        case .name(let n, _): return n
        case .ipv4(let a): return "\(a)".split(separator: "%").first.map(String.init) ?? "\(a)"
        case .ipv6(let a): return "[\("\(a)".split(separator: "%").first.map(String.init) ?? "\(a)")]"
        @unknown default: return "\(host)"
        }
    }
}
