import SwiftUI

/// The pairing credentials: which sidecar (host:port) + the bearer token.
/// `certFingerprint` is RESERVED for v2 (self-signed TLS + cert pinning): the app
/// will pin the SHA-256 of the cert it saw at pairing. Optional + defaulted so creds
/// persisted before v2 still decode (v1 is cleartext-over-LAN + token).
struct Credentials: Codable, Equatable {
    var host: String   // e.g. "192.168.1.10:9002" (LAN) or "Bens-Mac.local:9002"
    var token: String
    var certFingerprint: String? = nil
}

/// Top-level app state: holds the pairing credentials and drives the gate
/// between the PairingView (unpaired) and the Zen cards (paired). Loads creds
/// from the Keychain on launch and clears them on a 401 (re-pair).
@MainActor
final class AppModel: ObservableObject {
    @Published var credentials: Credentials?
    let store: ZenStore

    init() {
        self.store = ZenStore()
        self.credentials = Keychain.loadCredentials()
        // The store fires this when any authenticated HTTP call returns 401
        // (a stale/rotated token). Drop creds → SwiftUI swaps back to PairingView.
        store.onUnauthorized = { [weak self] in self?.unpair() }
        if let c = credentials { apply(c) }
    }

    /// Pair from manual entry or a scanned QR. Persists + connects.
    func pair(host rawHost: String, token: String) {
        let c = Credentials(host: Self.normalizeHost(rawHost), token: token.trimmingCharacters(in: .whitespaces))
        Keychain.saveCredentials(c)
        credentials = c
        apply(c)
    }

    /// Handle a `mermaidcollab://pair?host=<host:port>&token=<tok>` deep link.
    @discardableResult
    func handle(url: URL) -> Bool {
        guard url.scheme == "mermaidcollab", url.host == "pair",
              let comps = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return false }
        let q = comps.queryItems ?? []
        guard let host = q.first(where: { $0.name == "host" })?.value, !host.isEmpty,
              let token = q.first(where: { $0.name == "token" })?.value, !token.isEmpty else { return false }
        pair(host: host, token: token)
        return true
    }

    func unpair() {
        store.stop()
        Keychain.deleteCredentials()
        credentials = nil
    }

    private func apply(_ c: Credentials) {
        store.configure(host: c.host, token: c.token)
        store.start()
    }

    /// Strip a scheme/trailing slash and default the port to 9002 if omitted.
    static func normalizeHost(_ raw: String) -> String {
        var h = raw.trimmingCharacters(in: .whitespaces)
        for p in ["http://", "https://", "ws://", "wss://"] where h.hasPrefix(p) { h.removeFirst(p.count) }
        if h.hasSuffix("/") { h.removeLast() }
        if !h.contains(":") { h += ":9002" }
        return h
    }
}

/// First-run / re-pair screen: paste the host + token shown by the desktop
/// "Phone access" panel, or scan its QR (the QR opens the app via the
/// mermaidcollab:// deep link, so this is the manual fallback).
struct PairingView: View {
    @EnvironmentObject var app: AppModel
    @State private var host = ""
    @State private var token = ""

    private var canPair: Bool {
        !host.trimmingCharacters(in: .whitespaces).isEmpty &&
        !token.trimmingCharacters(in: .whitespaces).isEmpty
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    VStack(alignment: .leading, spacing: 8) {
                        Image(systemName: "iphone.gen3.radiowaves.left.and.right")
                            .font(.largeTitle).foregroundStyle(.tint)
                        Text("Pair with your Mac")
                            .font(.title2).fontWeight(.semibold)
                        Text("Open the desktop app → Settings → Phone access. Scan the QR with the Camera app, or type the host and token below.")
                            .font(.subheadline).foregroundStyle(.secondary)
                    }

                    VStack(alignment: .leading, spacing: 12) {
                        field("Host", text: $host, placeholder: "100.x.y.z:9002", keyboard: .URL)
                        field("Token", text: $token, placeholder: "paste the bearer token", keyboard: .asciiCapable)
                    }

                    Button {
                        app.pair(host: host, token: token)
                    } label: {
                        Text("Pair")
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 12)
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(!canPair)
                }
                .padding(20)
            }
            .navigationTitle("Zen")
        }
    }

    private func field(_ label: String, text: Binding<String>, placeholder: String, keyboard: UIKeyboardType) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label.uppercased()).font(.caption2).fontWeight(.semibold).foregroundStyle(.secondary)
            TextField(placeholder, text: text)
                .textFieldStyle(.roundedBorder)
                .keyboardType(keyboard)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
        }
    }
}
