import Foundation

/// One row of the bridge snapshot's `missions` array
/// (`src/services/bridge-snapshot.ts` → `MissionSummary`, `src/services/mission-store.ts:2285`).
///
/// The wire shape is a nested envelope — `{ node: {...}, rollup: {...} }` — but this row
/// flattens it for callers and inverts `rollup.factsOmitted` into the positively-named
/// `rollupConfirmed`, so a caller cannot read an unconfirmed (cheap-path) rollup as fact
/// by forgetting a negation.
public struct MissionListRow: Codable, Sendable, Equatable, Identifiable {
    public let id: String
    public let title: String
    /// Raw server status string — no enum: server vocabulary is additive and can grow.
    public let status: String
    public let nickname: String?

    public let rollupStatus: String?
    public let mechanicalDone: Int
    public let mechanicalTotal: Int
    public let capabilityMet: Int
    public let capabilityTotal: Int
    public let capabilityDropped: Int
    /// `true` unless the rollup explicitly says `factsOmitted: true`. An absent
    /// `factsOmitted` defaults to `false` on the wire, so this defaults to `true`.
    public let rollupConfirmed: Bool

    public init(
        id: String,
        title: String,
        status: String,
        nickname: String? = nil,
        rollupStatus: String? = nil,
        mechanicalDone: Int = 0,
        mechanicalTotal: Int = 0,
        capabilityMet: Int = 0,
        capabilityTotal: Int = 0,
        capabilityDropped: Int = 0,
        rollupConfirmed: Bool = true
    ) {
        self.id = id
        self.title = title
        self.status = status
        self.nickname = nickname
        self.rollupStatus = rollupStatus
        self.mechanicalDone = mechanicalDone
        self.mechanicalTotal = mechanicalTotal
        self.capabilityMet = capabilityMet
        self.capabilityTotal = capabilityTotal
        self.capabilityDropped = capabilityDropped
        self.rollupConfirmed = rollupConfirmed
    }

    private enum CodingKeys: String, CodingKey {
        case node, rollup
    }

    private enum NodeKeys: String, CodingKey {
        case id, title, status, nickname
    }

    private enum RollupKeys: String, CodingKey {
        case status, mechanical, capability, factsOmitted
    }

    private enum CountKeys: String, CodingKey {
        case done, total, met, dropped
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)

        let node = try container.nestedContainer(keyedBy: NodeKeys.self, forKey: .node)
        id = try node.decode(String.self, forKey: .id)
        title = try node.decode(String.self, forKey: .title)
        status = try node.decode(String.self, forKey: .status)
        nickname = try node.decodeIfPresent(String.self, forKey: .nickname)

        if container.contains(.rollup) {
            let rollup = try container.nestedContainer(keyedBy: RollupKeys.self, forKey: .rollup)
            rollupStatus = try rollup.decodeIfPresent(String.self, forKey: .status)

            if rollup.contains(.mechanical) {
                let mechanical = try rollup.nestedContainer(keyedBy: CountKeys.self, forKey: .mechanical)
                mechanicalDone = try mechanical.decodeIfPresent(Int.self, forKey: .done) ?? 0
                mechanicalTotal = try mechanical.decodeIfPresent(Int.self, forKey: .total) ?? 0
            } else {
                mechanicalDone = 0
                mechanicalTotal = 0
            }

            if rollup.contains(.capability) {
                let capability = try rollup.nestedContainer(keyedBy: CountKeys.self, forKey: .capability)
                capabilityMet = try capability.decodeIfPresent(Int.self, forKey: .met) ?? 0
                capabilityTotal = try capability.decodeIfPresent(Int.self, forKey: .total) ?? 0
                capabilityDropped = try capability.decodeIfPresent(Int.self, forKey: .dropped) ?? 0
            } else {
                capabilityMet = 0
                capabilityTotal = 0
                capabilityDropped = 0
            }

            let factsOmitted = try rollup.decodeIfPresent(Bool.self, forKey: .factsOmitted) ?? false
            rollupConfirmed = !factsOmitted
        } else {
            rollupStatus = nil
            mechanicalDone = 0
            mechanicalTotal = 0
            capabilityMet = 0
            capabilityTotal = 0
            capabilityDropped = 0
            rollupConfirmed = true
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)

        var node = container.nestedContainer(keyedBy: NodeKeys.self, forKey: .node)
        try node.encode(id, forKey: .id)
        try node.encode(title, forKey: .title)
        try node.encode(status, forKey: .status)
        try node.encodeIfPresent(nickname, forKey: .nickname)

        var rollup = container.nestedContainer(keyedBy: RollupKeys.self, forKey: .rollup)
        try rollup.encodeIfPresent(rollupStatus, forKey: .status)

        var mechanical = rollup.nestedContainer(keyedBy: CountKeys.self, forKey: .mechanical)
        try mechanical.encode(mechanicalDone, forKey: .done)
        try mechanical.encode(mechanicalTotal, forKey: .total)

        var capability = rollup.nestedContainer(keyedBy: CountKeys.self, forKey: .capability)
        try capability.encode(capabilityMet, forKey: .met)
        try capability.encode(capabilityTotal, forKey: .total)
        try capability.encode(capabilityDropped, forKey: .dropped)

        try rollup.encode(!rollupConfirmed, forKey: .factsOmitted)
    }
}
