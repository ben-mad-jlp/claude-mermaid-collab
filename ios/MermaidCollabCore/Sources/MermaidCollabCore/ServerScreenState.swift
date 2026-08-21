import Foundation

/// The fourth axis a server screen needs, derived over an already-stamped `ServerEntry`
/// (`ServerRegistry.swift:20`) plus an observed item count. Pure, total, no I/O — never
/// re-probes or re-defaults reachability (`Reachability.swift:12`); it only distinguishes a
/// reachable-but-empty server from a reachable server with rows, which today both render as a
/// bare empty list.
public enum ServerScreenState: Equatable, Sendable {
    case unreachable, unauthorized, empty, populated

    /// Reachability wins over count: an `.unreachable` or `.unauthorized` entry derives its
    /// reachability-driven case regardless of `itemCount`. Only a `.reachable` entry can derive
    /// `.empty` or `.populated`. `itemCount` is trusted as given — not clamped or validated; a
    /// negative value falls through to `.populated`.
    public static func state(for entry: ServerEntry, itemCount: Int) -> ServerScreenState {
        switch entry.reachability {
        case .unreachable:
            return .unreachable
        case .unauthorized:
            return .unauthorized
        case .reachable:
            return itemCount == 0 ? .empty : .populated
        }
    }
}
