import XCTest
@testable import MermaidCollabCore

final class MissionPlanTreeTests: XCTestCase {
    private func makeDiagnostic() -> MissionDiagnostic {
        let epic1 = MissionServingEpic(id: "epic-1", title: "First epic", open: true, landedInGit: nil)
        let epic1Again = MissionServingEpic(id: "epic-1", title: "First epic (dup)", open: false, landedInGit: true)
        let epic2 = MissionServingEpic(id: "epic-2", title: "Second epic", open: true, landedInGit: nil)

        let criterionA = MissionCriterionDetail(
            id: "crit-a", action: "building", met: false, servingEpics: [epic1]
        )
        let criterionB = MissionCriterionDetail(
            id: "crit-b", action: "verify", met: false, servingEpics: [epic1Again, epic2]
        )

        let leaves = [
            MissionDiagnosticLeaf(id: "leaf-1a", epicId: "epic-1", derivedStatus: "in_progress", terminalReason: nil, terminalClass: "none"),
            MissionDiagnosticLeaf(id: "leaf-1b", epicId: "epic-1", derivedStatus: "done", terminalReason: nil, terminalClass: "landed"),
            MissionDiagnosticLeaf(id: "leaf-1c", epicId: "epic-1", derivedStatus: "ready", terminalReason: nil, terminalClass: "none"),
            MissionDiagnosticLeaf(id: "leaf-2a", epicId: "epic-2", derivedStatus: "parked", terminalReason: "gate rejected", terminalClass: "gate-rejected"),
            MissionDiagnosticLeaf(id: "leaf-orphan", epicId: "epic-orphan", derivedStatus: "done", terminalReason: nil, terminalClass: "landed"),
        ]

        return MissionDiagnostic(criteria: [criterionA, criterionB], leaves: leaves)
    }

    func test1_buildsOneNodePerDistinctServingEpic() {
        let tree = MissionPlanTree.build(from: makeDiagnostic())
        XCTAssertEqual(tree.count, 2)
        XCTAssertEqual(tree.map(\.id), ["epic-1", "epic-2"])
    }

    func test2_epicNodeChildrenMatchPayloadLeafCounts() {
        let tree = MissionPlanTree.build(from: makeDiagnostic())
        XCTAssertEqual(tree[0].children.count, 3)
        XCTAssertEqual(tree[1].children.count, 1)
        XCTAssertFalse(tree.flatMap(\.children).map(\.id).contains("leaf-orphan"))
    }

    func test3_leafNodeCopiesTerminalClassVerbatim() {
        let tree = MissionPlanTree.build(from: makeDiagnostic())
        let epic2Leaf = tree[1].children[0]
        XCTAssertEqual(epic2Leaf.terminalClass, "gate-rejected")
        XCTAssertEqual(epic2Leaf.derivedStatus, "parked")
    }
}
