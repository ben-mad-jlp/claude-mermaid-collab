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
    /// (A real device over Tailscale is configured with the tailnet host + bearer token.)
    var host = "localhost:9002"
    var token: String?

    /// Fired when an authenticated HTTP call returns 401 (stale/rotated token).
    /// AppModel hooks this to drop creds and show the PairingView (re-pair). The
    /// WS upgrade 401 is opaque on URLSessionWebSocketTask, so re-pair is driven
    /// off HTTP — we probe GET /api/auth/check on start + each reconnect.
    var onUnauthorized: (() -> Void)?

    /// Point the store at a paired sidecar (host:port + bearer token).
    func configure(host: String, token: String) {
        self.host = host
        self.token = token
    }
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
        Task {
            // Validate creds first: a 401 here fires onUnauthorized → re-pair,
            // instead of the WS silently looping on a bad token.
            await verifyAuth()
            await hydrateEscalations()
        }
        connect()
    }

    /// Probe the gated liveness endpoint. A 401 means the token is stale/rotated
    /// → onUnauthorized (handled inside `send`). 200/other = creds still valid.
    func verifyAuth() async {
        _ = await send(request("/api/auth/check"))
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
                    if !self.closed {
                        // A rotated token surfaces as an opaque WS upgrade failure;
                        // probe HTTP so a 401 triggers re-pair instead of looping.
                        await self.verifyAuth()
                        if !self.closed { self.connect() }
                    }
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

    /// Single authenticated-HTTP path: returns the body on 2xx, nil otherwise.
    /// A 401 (stale/rotated token) fires onUnauthorized → re-pair.
    @discardableResult
    private func send(_ req: URLRequest) async -> Data? {
        do {
            let (data, resp) = try await URLSession.shared.data(for: req)
            if let http = resp as? HTTPURLResponse, http.statusCode == 401 {
                onUnauthorized?()
                return nil
            }
            return data
        } catch {
            return nil
        }
    }

    func hydrateEscalations() async {
        guard let data = await send(request("/api/supervisor/escalations?status=open")) else { return }
        guard let resp = try? JSONDecoder().decode(EscalationsResponse.self, from: data) else { return }
        for e in resp.escalations { escalations[e.id] = e }
    }

    func fetchMission(project: String, session: String) async -> MissionSummary? {
        func enc(_ s: String) -> String {
            s.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? s
        }
        let path = "/api/supervisor/missions?project=\(enc(project))&session=\(enc(session))"
        guard let data = await send(request(path)) else { return nil }
        guard let resp = try? JSONDecoder().decode(MissionsResponse.self, from: data) else { return nil }
        return resp.missions.first(where: { $0.mission.active }) ?? resp.missions.first
    }

    func fetchDocuments(project: String, session: String) async -> [DocRef] {
        func enc(_ s: String) -> String { s.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? s }
        let path = "/api/documents?project=\(enc(project))&session=\(enc(session))"
        guard let data = await send(request(path)) else { return [] }
        guard let resp = try? JSONDecoder().decode(DocumentsResponse.self, from: data) else { return [] }
        return resp.documents
    }

    func fetchDocument(id: String, project: String, session: String) async -> DocumentContent? {
        func enc(_ s: String) -> String { s.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? s }
        let path = "/api/document/\(enc(id))?project=\(enc(project))&session=\(enc(session))"
        guard let data = await send(request(path)) else { return nil }
        return try? JSONDecoder().decode(DocumentContent.self, from: data)
    }

    func fetchImages(project: String, session: String) async -> [ImageRef] {
        func enc(_ s: String) -> String { s.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? s }
        let path = "/api/images?project=\(enc(project))&session=\(enc(session))"
        guard let data = await send(request(path)) else { return [] }
        guard let resp = try? JSONDecoder().decode(ImagesResponse.self, from: data) else { return [] }
        return resp.images
    }

    func fetchImageData(id: String, project: String, session: String) async -> Data? {
        func enc(_ s: String) -> String { s.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? s }
        let path = "/api/image/\(enc(id))/content?project=\(enc(project))&session=\(enc(session))"
        return await send(request(path))
    }

    // MARK: Actions

    /// Decide a structured escalation. Optimistically clears it.
    func decide(_ escalationId: String, optionId: String) {
        escalations.removeValue(forKey: escalationId)
        Task {
            await send(request("/api/supervisor/escalation/\(escalationId)/decide", method: "POST", body: ["optionId": optionId]))
        }
    }

    /// Answer a pane-derived question by nudging text into the session.
    func answer(project: String, session: String, text: String) {
        Task {
            await send(request("/api/supervisor/nudge", method: "POST", body: ["project": project, "session": session, "text": text]))
        }
    }

    /// Approve & proceed — the single 'act' verb for a green Zen card (design §2 Q1):
    /// tell the session to push/land its current green work. Fire-and-forget; the
    /// resulting state change arrives over the WS like any other update.
    func approvePush(project: String, session: String) {
        Task {
            await send(request("/api/supervisor/approve-push", method: "POST", body: ["project": project, "session": session]))
        }
    }
}
