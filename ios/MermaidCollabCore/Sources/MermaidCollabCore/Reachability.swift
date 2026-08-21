import Foundation

/// The result of one liveness probe against a server: either the request never got an HTTP
/// response (transport failure) or it did (HTTP status). Diagnostic strings are transient and
/// never affect the reachability mapping.
public enum ServerProbeResult: Equatable, Sendable {
    case transportFailure(String)
    case httpStatus(Int)
}

/// Maps one probe result to the shipped `ServerReachability` union. Pure, total, no I/O.
public func reachabilityState(from result: ServerProbeResult) -> ServerReachability {
    switch result {
    case .transportFailure:
        return .unreachable
    case .httpStatus(let status):
        switch status {
        case 401, 403:
            return .unauthorized
        case 200...299:
            return .reachable
        default:
            return .unreachable
        }
    }
}

extension ServerRegistry {
    /// Stamps every entry's `reachability` from one shared probe-result dictionary keyed by
    /// `ServerEntry.id`. Entries whose id is absent from `results` default to `.unreachable`.
    /// Preserves entry count, order, and every other field.
    public func applyingProbeResults(_ results: [String: ServerProbeResult]) -> ServerRegistry {
        let updated = entries.map { entry -> ServerEntry in
            var copy = entry
            if let result = results[entry.id] {
                copy.reachability = reachabilityState(from: result)
            } else {
                copy.reachability = .unreachable
            }
            return copy
        }
        return ServerRegistry(entries: updated)
    }
}
