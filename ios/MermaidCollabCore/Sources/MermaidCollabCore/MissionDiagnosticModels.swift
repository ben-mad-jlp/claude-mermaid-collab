import Foundation

// Mirrors the wire shape of `MissionDiagnostic` (src/services/mission-diagnostic.ts:50-63),
// served by GET /api/supervisor/missions/diagnostic. Only `criteria` and `leaves` are
// modeled — every other top-level key (status, rollup, conductorPass, baseHealth, hostLoad)
// is deliberately ignored. `action` and `terminalClass` are kept as `String`, not enums,
// because their server-side unions may grow; an unrecognized value must still decode.

/// One epic serving a mission criterion, as reported in `MissionCriterionDetail.servingEpics`.
public struct MissionServingEpic: Codable, Sendable, Equatable {
    public let id: String
    public let title: String
    public let open: Bool
    public let landedInGit: Bool?

    public init(id: String, title: String, open: Bool, landedInGit: Bool?) {
        self.id = id
        self.title = title
        self.open = open
        self.landedInGit = landedInGit
    }
}

/// One mission criterion row, including the epics currently serving it.
public struct MissionCriterionDetail: Codable, Sendable, Equatable {
    public let id: String
    /// `CriterionAction` on the wire (met|building|verify|discover); kept as a raw string
    /// so an unrecognized future value still decodes instead of throwing.
    public let action: String
    public let met: Bool
    public let servingEpics: [MissionServingEpic]

    public init(id: String, action: String, met: Bool, servingEpics: [MissionServingEpic]) {
        self.id = id
        self.action = action
        self.met = met
        self.servingEpics = servingEpics
    }

    private enum CodingKeys: String, CodingKey {
        case id, action, met, servingEpics
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        action = try container.decode(String.self, forKey: .action)
        met = try container.decode(Bool.self, forKey: .met)
        servingEpics = try container.decodeIfPresent([MissionServingEpic].self, forKey: .servingEpics) ?? []
    }
}

/// One leaf row from the diagnostic, mirroring `MissionDiagnosticLeaf`
/// (src/services/mission-diagnostic.ts:27-34). `terminalClass` is a raw string mirroring
/// the server-owned `LeafTerminalClass` union (:20-26), which may grow.
public struct MissionDiagnosticLeaf: Codable, Sendable, Equatable {
    public let id: String
    public let epicId: String
    public let derivedStatus: String
    public let terminalReason: String?
    public let terminalClass: String

    public init(
        id: String,
        epicId: String,
        derivedStatus: String,
        terminalReason: String?,
        terminalClass: String
    ) {
        self.id = id
        self.epicId = epicId
        self.derivedStatus = derivedStatus
        self.terminalReason = terminalReason
        self.terminalClass = terminalClass
    }
}

/// Top-level payload for `GET /api/supervisor/missions/diagnostic`. Only `criteria` and
/// `leaves` are modeled; `status`/`rollup`/`conductorPass`/`baseHealth`/`hostLoad` are
/// present on the wire but intentionally not declared here.
public struct MissionDiagnostic: Codable, Sendable, Equatable {
    public let criteria: [MissionCriterionDetail]
    public let leaves: [MissionDiagnosticLeaf]

    public init(criteria: [MissionCriterionDetail], leaves: [MissionDiagnosticLeaf]) {
        self.criteria = criteria
        self.leaves = leaves
    }

    private enum CodingKeys: String, CodingKey {
        case criteria, leaves
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        criteria = try container.decodeIfPresent([MissionCriterionDetail].self, forKey: .criteria) ?? []
        leaves = try container.decodeIfPresent([MissionDiagnosticLeaf].self, forKey: .leaves) ?? []
    }
}
