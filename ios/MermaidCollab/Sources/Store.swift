import Foundation

// ZenStore — connects to the sidecar's collab WebSocket and keeps the live set of session
// summaries. On connect the server pushes its cached snapshot (hydrate), then live
// `session_summary_updated` messages. Read-only for v1. Loopback in the simulator needs no
// token; a real device over Tailscale will set the bearer header (v2).
@MainActor
final class ZenStore: ObservableObject {
    @Published var summaries: [String: ZenSummary] = [:]
    @Published var escalations: [String: Escalation] = [:] // keyed by escalation id (open only)
    @Published var connected = false

    private var task: URLSessionWebSocketTask?
    private var closed = false
    /// Default host: the simulator shares the Mac's localhost → the sidecar on :9002.
    /// (A real device over Tailscale will set this to the tailnet host + a bearer token.)
    var host = "localhost:9002"
    var token: String?
    private var wsURL: URL { URL(string: "ws://\(host)/ws")! }
    private func apiURL(_ path: String) -> URL { URL(string: "http://\(host)\(path)")! }

    var ordered: [ZenSummary] {
        summaries.values.sorted { a, b in
            a.rank != b.rank ? a.rank < b.rank : a.recency > b.recency
        }
    }

    /// The open escalation for a session, if any (drives the question + decide buttons).
    func openEscalation(for s: ZenSummary) -> Escalation? {
        escalations.values.first { $0.project == s.project && $0.session == s.session }
    }

    func start() {
        closed = false
        Task { await hydrateEscalations() }
        connect()
    }

    func stop() {
        closed = true
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
        connected = false
    }

    private func connect() {
        let t = URLSession.shared.webSocketTask(with: wsURL)
        task = t
        t.resume()
        connected = true
        receive()
    }

    private func receive() {
        task?.receive { [weak self] result in
            Task { @MainActor in
                guard let self, !self.closed else { return }
                switch result {
                case .success(let message):
                    switch message {
                    case .string(let text): self.ingest(text)
                    case .data(let data): self.ingest(String(decoding: data, as: UTF8.self))
                    @unknown default: break
                    }
                    self.receive()
                case .failure:
                    self.connected = false
                    try? await Task.sleep(nanoseconds: 2_000_000_000)
                    if !self.closed { self.connect() }
                }
            }
        }
    }

    private func ingest(_ text: String) {
        guard let data = text.data(using: .utf8) else { return }
        // Peek at the type, then decode the matching shape.
        guard let type = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["type"] as? String else { return }
        switch type {
        case "session_summary_updated":
            if let m = try? JSONDecoder().decode(ZenSummary.self, from: data) { summaries[m.id] = m }
        case "escalation_created":
            if let m = try? JSONDecoder().decode(EscalationCreatedMsg.self, from: data), let e = m.escalation {
                escalations[e.id] = e
            }
        case "escalation_decided", "escalation_resolved", "drive.auto_resolved":
            if let m = try? JSONDecoder().decode(EscalationGoneMsg.self, from: data), let id = m.id {
                escalations.removeValue(forKey: id)
            }
        default:
            break
        }
    }

    // MARK: HTTP

    private func request(_ path: String, method: String = "GET", body: [String: Any]? = nil) -> URLRequest {
        var r = URLRequest(url: apiURL(path))
        r.httpMethod = method
        if let token { r.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body {
            r.setValue("application/json", forHTTPHeaderField: "Content-Type")
            r.httpBody = try? JSONSerialization.data(withJSONObject: body)
        }
        return r
    }

    func hydrateEscalations() async {
        do {
            let (data, _) = try await URLSession.shared.data(for: request("/api/supervisor/escalations?status=open"))
            let resp = try JSONDecoder().decode(EscalationsResponse.self, from: data)
            for e in resp.escalations { escalations[e.id] = e }
        } catch {
            // best-effort; WS escalation_created will still populate new ones
        }
    }

    // MARK: Actions

    /// Decide a structured escalation. Optimistically clears it.
    func decide(_ escalationId: String, optionId: String) {
        escalations.removeValue(forKey: escalationId)
        Task {
            _ = try? await URLSession.shared.data(
                for: request("/api/supervisor/escalation/\(escalationId)/decide", method: "POST", body: ["optionId": optionId]))
        }
    }

    /// Answer a pane-derived question by nudging text into the session.
    func answer(project: String, session: String, text: String) {
        Task {
            _ = try? await URLSession.shared.data(
                for: request("/api/supervisor/nudge", method: "POST", body: ["project": project, "session": session, "text": text]))
        }
    }
}
