import Foundation

/// Whole-registry persistence seam. `ServerRegistry` is the operator's ordered list of
/// registered servers (`ServerRegistry.swift:38`); this protocol is where that model gets
/// loaded from and saved to disk (file in the app target, memory in tests).
///
/// Mutation members are non-`mutating` so both a stateless `struct` conformer (the file
/// one) and a stateful `final class` conformer can satisfy the protocol without `mutating`
/// fan-out at call sites — mirrors `ServerTokenStore` (`ServerTokenStore.swift:10-13`).
///
/// `load()` never throws: a persistence fault (missing file, corrupt data, decode error)
/// degrades to `ServerRegistryDefaults.registry` rather than propagating into `ZenStore`
/// init. Bearer tokens must never ride along in this blob — see the invariant documented
/// at `ServerTokenStore.swift:3-5`; `ServerEntry.pairing` does carry a token, but this seam
/// does not strip or add fields, it encodes/decodes `ServerRegistry` verbatim.
public protocol ServerRegistryPersisting {
    func load() -> ServerRegistry
    func save(_ registry: ServerRegistry)
}

/// Seed default registry: the single local sidecar entry that used to be inlined at
/// `Store.swift`'s `registry` property.
public enum ServerRegistryDefaults {
    public static let defaultRegistry = ServerRegistry(entries: [
        ServerEntry(id: "local", label: "This Mac", host: "localhost:9002", source: .manual)
    ])
}

/// JSON-file-backed `ServerRegistryPersisting`, at an injectable `url` (tests point it at a
/// tmp path; the app target points it at Application Support).
public struct FileServerRegistryStore: ServerRegistryPersisting {
    private let url: URL

    public init(url: URL) {
        self.url = url
    }

    public func load() -> ServerRegistry {
        guard let data = try? Data(contentsOf: url),
              let registry = try? ServerRegistry.decoded(from: data)
        else {
            return ServerRegistryDefaults.defaultRegistry
        }
        return registry
    }

    /// Best-effort persistence — swallows every throw so a write fault never crashes the app.
    public func save(_ registry: ServerRegistry) {
        guard let data = try? registry.encoded() else { return }
        try? FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try? data.write(to: url, options: .atomic)
    }
}

/// Headless-testable in-memory `ServerRegistryPersisting`. Returns the default registry
/// until the first `save`.
public final class InMemoryServerRegistryStore: ServerRegistryPersisting {
    private var stored: ServerRegistry?

    public init() {}

    public func load() -> ServerRegistry {
        stored ?? ServerRegistryDefaults.defaultRegistry
    }

    public func save(_ registry: ServerRegistry) {
        stored = registry
    }
}
