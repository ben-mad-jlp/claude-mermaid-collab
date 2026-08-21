import Foundation
import MermaidCollabCore

// ZenStore — connects to the sidecar's collab WebSocket and keeps the live set of session
// summaries. On connect the server pushes its cached snapshot (hydrate), then live
// `session_summary_updated` messages. Read-only for v1. Loopback in the simulator needs no
// token; a real device over Tailscale will set the bearer header (v2).
@MainActor
final class ZenStore: ObservableObject {
    static let localFallbackServerId = "local"

    @Published var summaries: [String: ZenSummary] = [:]
    @Published var escalations: [String: Escalation] = [:] // keyed by escalation id (open only)
    @Published var missionRows: [MissionListRow] = []
    @Published var connected = false

    private var task: URLSessionWebSocketTask?
    private var closed = false
    private let registryStore: ServerRegistryPersisting
    /// Default host: the simulator shares the Mac's localhost → the sidecar on :9002.
    /// (A real device over Tailscale is configured with the tailnet host + bearer token.)
    /// Persisted on every mutation via `registryStore`; the `init` assignment deliberately
    /// does not trigger a re-save (didSet doesn't fire from init).
    var registry: ServerRegistry {
        didSet { registryStore.save(registry) }
    }
    var projectsByServerId: [String: [String]] = [:]
    var selectedServerId: String = ZenStore.localFallbackServerId
    var localServerId: String? = ZenStore.localFallbackServerId
    var tokenStore: ServerTokenStore = KeychainServerTokenStore()
    /// Legacy/selected fallback token, kept for pairing's back-compat call shape.
    var token: String?

    /// Defaulted so `ZenStore()` (`Pairing.swift:23`) keeps compiling with no arguments.
    init(registryStore: ServerRegistryPersisting = FileServerRegistryStore(url: ZenStore.defaultRegistryURL)) {
        self.registryStore = registryStore
        self.registry = registryStore.load()
    }

    /// `nonisolated` because this is evaluated in `init`'s DEFAULT ARGUMENT, which runs in a
    /// nonisolated context even though ZenStore is @MainActor. Without it the app target fails
    /// to compile: "main actor-isolated static property 'defaultRegistryURL' can not be
    /// referenced from a nonisolated context". It touches only FileManager, so it is safe
    /// off the main actor.
    private nonisolated static var defaultRegistryURL: URL {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? FileManager.default.temporaryDirectory
        return dir.appendingPathComponent("server-registry.json")
    }

    var host: String {
        registry.entries.first { $0.id == selectedServerId }?.host ?? "localhost:9002"
    }

    /// Fired when an authenticated HTTP call returns 401 (stale/rotated token).
    /// AppModel hooks this to drop creds and show the PairingView (re-pair). The
    /// WS upgrade 401 is opaque on URLSessionWebSocketTask, so re-pair is driven
    /// off HTTP — we probe GET /api/auth/check on start + each reconnect.
    var onUnauthorized: (() -> Void)?

    /// Point the store at a paired sidecar (host:port + bearer token).
    func configure(host: String, token: String) {
        if let i = registry.entries.firstIndex(where: { $0.id == selectedServerId }) {
            registry.entries[i].host = host
        } else {
            let entry = ServerEntry(id: ZenStore.localFallbackServerId, label: "This Mac", host: host, source: .paired)
            registry.entries.append(entry)
            selectedServerId = entry.id
        }
        self.token = token
        tokenStore.setToken(token, forServerId: selectedServerId)
    }
    private var wsURL: URL { URL(string: "ws://\(host)/ws")! }

    /// The WebSocket request, WITH the bearer token.
    ///
    /// `URLSession.webSocketTask(with: URL)` cannot carry headers, so the upgrade arrived
    /// with no Authorization and the server rejected it — the sidecar logged
    /// `REJECTED bad-token path=/ws sent=absent` while every HTTP call on the same
    /// credentials succeeded (2026-08-21). It never showed on the simulator because
    /// loopback peers are exempt from the token gate. `connected` is driven entirely by
    /// this socket, so the app read as "can't reach the server" while it was in fact
    /// authenticated for everything else.
    private var wsRequest: URLRequest {
        var r = URLRequest(url: wsURL)
        let bearer = tokenStore.token(forServerId: selectedServerId) ?? token
        if let bearer { r.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization") }
        return r
    }

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
            await refreshProjects()
        }
        connect()
    }

    /// Probe the gated liveness endpoint. A 401 means the token is stale/rotated
    /// → onUnauthorized (handled inside `send`). 200/other = creds still valid.
    func verifyAuth() async {
        _ = await send(request(serverId: selectedServerId, path: "/api/auth/check"))
    }

    func stop() {
        closed = true
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
        connected = false
    }

    private func connect() {
        let t = URLSession.shared.webSocketTask(with: wsRequest)
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

    private func request(serverId: String, path: String, method: String = "GET", body: [String: Any]? = nil) -> URLRequest {
        let route = ServerRequestRouter.route(serverId: serverId, path: path, registry: registry)
        let url = route.url ?? URL(string: "http://\(host)\(path)")!
        var r = URLRequest(url: url)
        r.httpMethod = method
        let bearer = tokenStore.token(forServerId: serverId) ?? token
        if let bearer { r.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization") }
        if let body {
            r.setValue("application/json", forHTTPHeaderField: "Content-Type")
            r.httpBody = try? JSONSerialization.data(withJSONObject: body)
        }
        return r
    }

    private func request(project: String, path: String, method: String = "GET", body: [String: Any]? = nil) -> URLRequest {
        let route = ServerRequestRouter.route(
            forProject: project,
            path: path,
            registry: registry,
            projectsByServerId: projectsByServerId,
            selectedServerId: selectedServerId,
            localServerId: localServerId
        )
        return request(serverId: route.serverId, path: path, method: method, body: body)
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

    /// One request per reachable server, folded through `EscalationMerge.merged` and rebuilt
    /// as a fresh dict so a card resolved on any server disappears rather than lingering from
    /// a previous pass. A server that fails or returns undecodable JSON contributes nothing and
    /// does not abort the loop — mirrors `refreshProjects()`.
    func hydrateEscalations() async {
        // The UI needs the app's Escalation (questionText, options); the merge needs Core's
        // (serverId, createdAt). Keep the display cards by id, merge on the Core projections,
        // then stamp each surviving card with the server the merge attributed it to.
        var cardsById: [String: Escalation] = [:]
        var results: [(serverId: String, escalations: [MermaidCollabCore.Escalation])] = []
        for entry in registry.entries where entry.reachability == .reachable {
            guard let data = await send(request(serverId: entry.id, path: "/api/supervisor/escalations?status=open")),
                  let resp = try? JSONDecoder().decode(EscalationsResponse.self, from: data)
            else { continue }
            for var card in resp.escalations {
                card.serverId = entry.id
                cardsById[card.id] = card
            }
            results.append((entry.id, resp.escalations.map { card in
                var c = card
                c.serverId = entry.id
                return c.coreModel()
            }))
        }
        var merged: [String: Escalation] = [:]
        for core in EscalationMerge.merged(results) {
            guard var card = cardsById[core.id] else { continue }
            card.serverId = core.serverId
            merged[core.id] = card
        }
        escalations = merged
    }

    /// One shared pass over `registry.entries`: a single request per server, populating
    /// `projectsByServerId` so `request(project:)` can resolve the owning server instead of
    /// falling back to `selectedServerId`. A server that fails or returns undecodable JSON
    /// contributes no key — it does not abort the pass for the remaining entries.
    func refreshProjects() async {
        var results: [(serverId: String, projects: [String])] = []
        for entry in registry.entries {
            guard let data = await send(request(serverId: entry.id, path: "/api/supervisor/projects")),
                  let resp = try? JSONDecoder().decode(WatchedProjectsResponse.self, from: data)
            else { continue }
            results.append((serverId: entry.id, projects: resp.projects.map(\.project)))
        }
        projectsByServerId = ServerProjectsMapping.mapping(from: results)
    }

    func fetchMission(project: String, session: String) async -> MissionSummary? {
        func enc(_ s: String) -> String {
            s.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? s
        }
        let path = "/api/supervisor/missions?project=\(enc(project))&session=\(enc(session))"
        guard let data = await send(request(project: project, path: path)) else { return nil }
        guard let resp = try? JSONDecoder().decode(MissionsResponse.self, from: data) else { return nil }
        return resp.missions.first(where: { $0.mission.active }) ?? resp.missions.first
    }

    func fetchBridgeSnapshot(project: String) async -> [MissionListRow] {
        func enc(_ s: String) -> String {
            s.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? s
        }
        let path = "/api/supervisor/bridge-snapshot?project=\(enc(project))"
        guard let data = await send(request(project: project, path: path)) else { return [] }
        guard let resp = try? JSONDecoder().decode(BridgeSnapshotResponse.self, from: data) else { return [] }
        missionRows = resp.missions
        return resp.missions
    }

    func fetchMissionDiagnostic(project: String, missionId: String) async -> MissionDiagnostic? {
        func enc(_ s: String) -> String {
            s.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? s
        }
        let path = "/api/supervisor/missions/diagnostic?project=\(enc(project))&missionId=\(enc(missionId))"
        guard let data = await send(request(project: project, path: path)) else { return nil }
        guard let resp = try? JSONDecoder().decode(MissionDiagnostic.self, from: data) else { return nil }
        return resp
    }

    func fetchTranscript(project: String, session: String, limit: Int = 20) async -> TranscriptResponse? {
        func enc(_ s: String) -> String {
            s.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? s
        }
        let path = "/api/transcript/recent?project=\(enc(project))&session=\(enc(session))&limit=\(limit)"
        guard let data = await send(request(project: project, path: path)) else { return nil }
        guard let resp = try? JSONDecoder().decode(TranscriptResponse.self, from: data) else { return nil }
        return resp
    }

    func fetchDocuments(project: String, session: String) async -> [DocRef] {
        func enc(_ s: String) -> String { s.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? s }
        let path = "/api/documents?project=\(enc(project))&session=\(enc(session))"
        guard let data = await send(request(project: project, path: path)) else { return [] }
        guard let resp = try? JSONDecoder().decode(DocumentsResponse.self, from: data) else { return [] }
        return resp.documents
    }

    func fetchDocument(id: String, project: String, session: String) async -> DocumentContent? {
        func enc(_ s: String) -> String { s.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? s }
        let path = "/api/document/\(enc(id))?project=\(enc(project))&session=\(enc(session))"
        guard let data = await send(request(project: project, path: path)) else { return nil }
        return try? JSONDecoder().decode(DocumentContent.self, from: data)
    }

    func fetchImages(project: String, session: String) async -> [ImageRef] {
        func enc(_ s: String) -> String { s.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? s }
        let path = "/api/images?project=\(enc(project))&session=\(enc(session))"
        guard let data = await send(request(project: project, path: path)) else { return [] }
        guard let resp = try? JSONDecoder().decode(ImagesResponse.self, from: data) else { return [] }
        return resp.images
    }

    func fetchImageData(id: String, project: String, session: String) async -> Data? {
        func enc(_ s: String) -> String { s.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? s }
        let path = "/api/image/\(enc(id))/content?project=\(enc(project))&session=\(enc(session))"
        return await send(request(project: project, path: path))
    }

    // MARK: Actions

    /// Decide a structured escalation. Optimistically clears it.
    func decide(_ escalationId: String, optionId: String) {
        guard let card = escalations[escalationId] else { return }
        escalations.removeValue(forKey: escalationId)
        let route = EscalationMerge.decideRoute(for: card.coreModel(), registry: registry, selectedServerId: selectedServerId)
        Task {
            await send(request(serverId: route.serverId, path: "/api/supervisor/escalation/\(escalationId)/decide", method: "POST", body: ["optionId": optionId]))
        }
    }

    /// Answer a pane-derived question by nudging text into the session.
    func answer(project: String, session: String, text: String) {
        Task {
            await send(request(project: project, path: "/api/supervisor/nudge", method: "POST", body: ["project": project, "session": session, "text": text]))
        }
    }

    /// Approve & proceed — the single 'act' verb for a green Zen card (design §2 Q1):
    /// tell the session to push/land its current green work. Fire-and-forget; the
    /// resulting state change arrives over the WS like any other update.
    func approvePush(project: String, session: String) {
        Task {
            await send(request(project: project, path: "/api/supervisor/approve-push", method: "POST", body: ["project": project, "session": session]))
        }
    }
}

/// Envelope for GET /api/supervisor/bridge-snapshot — mission rows are `MissionSummary`
/// (`{ node, rollup }`) shaped, matching `MissionListRow.init(from:)`.
struct BridgeSnapshotResponse: Codable {
    let missions: [MissionListRow]
}
