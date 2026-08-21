import Foundation

// Pure derivation over `MissionDiagnostic` (MissionDiagnosticModels.swift) that groups a
// mission's serving epics with their leaves into a display-ready tree. No decoding, no
// networking, no SwiftUI — just a fold over already-decoded model values.

/// One leaf underneath an epic node in the plan tree.
public struct MissionPlanLeafNode: Sendable, Equatable {
    public let id: String
    public let derivedStatus: String
    /// Copied verbatim from `MissionDiagnosticLeaf.terminalClass` — never mapped to an enum
    /// or normalised, since the server-side union may grow.
    public let terminalClass: String

    public init(id: String, derivedStatus: String, terminalClass: String) {
        self.id = id
        self.derivedStatus = derivedStatus
        self.terminalClass = terminalClass
    }
}

/// One epic node in the plan tree, with its leaves grouped underneath.
public struct MissionPlanEpicNode: Sendable, Equatable {
    public let id: String
    public let title: String
    public let children: [MissionPlanLeafNode]

    public init(id: String, title: String, children: [MissionPlanLeafNode]) {
        self.id = id
        self.title = title
        self.children = children
    }
}

/// Namespace for deriving a `MissionPlanEpicNode` tree from a `MissionDiagnostic`.
public enum MissionPlanTree {
    /// Builds one node per distinct serving epic (first appearance across
    /// `criteria[].servingEpics` wins for title and position), with leaves grouped by
    /// `epicId`. A leaf whose `epicId` matches no serving epic is dropped.
    public static func build(from diagnostic: MissionDiagnostic) -> [MissionPlanEpicNode] {
        var leavesByEpicId: [String: [MissionPlanLeafNode]] = [:]
        for leaf in diagnostic.leaves {
            leavesByEpicId[leaf.epicId, default: []].append(
                MissionPlanLeafNode(
                    id: leaf.id,
                    derivedStatus: leaf.derivedStatus,
                    terminalClass: leaf.terminalClass
                )
            )
        }

        var seenEpicIds: Set<String> = []
        var nodes: [MissionPlanEpicNode] = []
        for criterion in diagnostic.criteria {
            for epic in criterion.servingEpics {
                guard seenEpicIds.insert(epic.id).inserted else { continue }
                nodes.append(
                    MissionPlanEpicNode(
                        id: epic.id,
                        title: epic.title,
                        children: leavesByEpicId[epic.id] ?? []
                    )
                )
            }
        }
        return nodes
    }
}
