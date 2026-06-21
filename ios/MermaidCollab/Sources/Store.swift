import Foundation

// ZenStore — connects to the sidecar's collab WebSocket and keeps the live set of session
// summaries. On connect the server pushes its cached snapshot (hydrate), then live
// `session_summary_updated` messages. Read-only for v1. Loopback in the simulator needs no
// token; a real device over Tailscale will set the bearer header (v2).
@MainActor
final class ZenStore: ObservableObject {
    @Published var summaries: [String: ZenSummary] = [:]
    @Published var connected = false

    private var task: URLSessionWebSocketTask?
    private var closed = false
    /// Default host: the simulator shares the Mac's localhost → the sidecar on :9002.
    var wsURL = URL(string: "ws://localhost:9002/ws")!

    var ordered: [ZenSummary] {
        summaries.values.sorted { a, b in
            a.rank != b.rank ? a.rank < b.rank : a.recency > b.recency
        }
    }

    func start() {
        closed = false
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
        guard let msg = try? JSONDecoder().decode(ZenSummary.self, from: data),
              msg.type == "session_summary_updated" else { return }
        summaries[msg.id] = msg
    }
}
