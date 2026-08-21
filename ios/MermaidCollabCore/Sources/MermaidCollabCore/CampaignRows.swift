import Foundation

/// One probe within a bridge snapshot campaign
/// (`BridgeCampaignProbe`, `src/services/campaign-snapshot.ts:73-91`).
public struct ProbeRow: Codable, Sendable, Equatable {
    public let id: String
    public let kind: String
    /// Human-facing bucket derived from the raw server verdict — see `state(forVerdict:)`.
    public let state: String

    public init(id: String, kind: String, state: String) {
        self.id = id
        self.kind = kind
        self.state = state
    }

    /// Maps a stored `ProbeVerdict` (`src/services/campaign-store.ts:25`) to a display
    /// bucket. The default case returns the input verbatim — a verdict value added
    /// server-side must surface, not collapse to a wrong bucket.
    public static func state(forVerdict verdict: String) -> String {
        switch verdict {
        case "fail": return "failing"
        case "pass": return "passing"
        case "not-run": return "not-run"
        default: return verdict
        }
    }
}

/// One entry of the bridge snapshot's `campaigns` array
/// (`BridgeCampaign`, `src/services/campaign-snapshot.ts:93-119`).
///
/// Only `id`, `title` and `probes[].{id, kind, verdict}` are read off the wire — every
/// other field (`goal`, `createdAt`, `droppedAt`, `ruling`, `chamber`, `chamberHistory`,
/// `linkedMissions`, `missionCount`, `leafCount`, `chamberRoster`) is ignored, not
/// rejected, so the wire can grow without breaking decoding.
public struct CampaignRow: Codable, Sendable, Equatable {
    public let id: String
    public let title: String
    public let probes: [ProbeRow]

    public init(id: String, title: String, probes: [ProbeRow]) {
        self.id = id
        self.title = title
        self.probes = probes
    }

    private struct ProbeDTO: Decodable {
        let id: String
        let kind: String?
        let verdict: String?
    }

    private struct CampaignDTO: Decodable {
        let id: String
        let title: String
        let probes: [ProbeDTO]?
    }

    private static func row(from dto: CampaignDTO) -> CampaignRow {
        let probes = (dto.probes ?? []).map { probeDTO in
            ProbeRow(
                id: probeDTO.id,
                kind: probeDTO.kind ?? "",
                state: ProbeRow.state(forVerdict: probeDTO.verdict ?? "not-run")
            )
        }
        return CampaignRow(id: dto.id, title: dto.title, probes: probes)
    }

    /// Decodes a single snapshot `campaigns` element.
    public static func decode(from data: Data) throws -> CampaignRow {
        let dto = try JSONDecoder().decode(CampaignDTO.self, from: data)
        return row(from: dto)
    }

    /// Decodes the snapshot's `campaigns` array. Probe order is the wire order — this
    /// maps without sorting, filtering or deduplicating.
    public static func decodeAll(from data: Data) throws -> [CampaignRow] {
        let dtos = try JSONDecoder().decode([CampaignDTO].self, from: data)
        return dtos.map(row(from:))
    }
}
