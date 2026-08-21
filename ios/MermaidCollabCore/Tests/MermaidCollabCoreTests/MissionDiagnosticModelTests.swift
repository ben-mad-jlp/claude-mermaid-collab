import XCTest
@testable import MermaidCollabCore

final class MissionDiagnosticModelTests: XCTestCase {
    func test1_decodesThreeCriteriaWithActionStrings() throws {
        let json = """
        {
          "status": "active",
          "rollup": { "total": 3, "met": 1 },
          "conductorPass": null,
          "baseHealth": "green",
          "hostLoad": 0.42,
          "criteria": [
            {
              "id": "crit-1",
              "action": "discover",
              "met": false,
              "servingEpics": [
                { "id": "epic-1", "title": "First epic", "open": true, "landedInGit": null }
              ]
            },
            {
              "id": "crit-2",
              "action": "building",
              "met": false,
              "servingEpics": []
            },
            {
              "id": "crit-3",
              "action": "met",
              "met": true,
              "servingEpics": [
                { "id": "epic-3", "title": "Third epic", "open": false, "landedInGit": true }
              ]
            }
          ],
          "leaves": []
        }
        """.data(using: .utf8)!

        let detail = try JSONDecoder().decode(MissionDiagnostic.self, from: json)

        XCTAssertEqual(detail.criteria.count, 3)
        XCTAssertEqual(detail.criteria.map(\.action), ["discover", "building", "met"])
        XCTAssertEqual(detail.criteria[0].servingEpics.first?.landedInGit, nil)
    }

    func test2_decodesLeafTerminalClassVerbatim() throws {
        let json = """
        {
          "criteria": [],
          "leaves": [
            {
              "id": "leaf-1",
              "epicId": "epic-1",
              "derivedStatus": "terminal",
              "terminalReason": null,
              "terminalClass": "epic-base-red"
            }
          ]
        }
        """.data(using: .utf8)!

        let detail = try JSONDecoder().decode(MissionDiagnostic.self, from: json)

        XCTAssertEqual(detail.leaves.count, 1)
        let leaf = try XCTUnwrap(detail.leaves.first)
        XCTAssertEqual(leaf.terminalClass, "epic-base-red")
        XCTAssertNil(leaf.terminalReason)
        XCTAssertEqual(leaf.derivedStatus, "terminal")
        XCTAssertEqual(leaf.epicId, "epic-1")
    }

    func test3_decodesUnknownActionStringWithoutThrowing() throws {
        let json = """
        {
          "criteria": [
            { "id": "crit-1", "action": "future-action", "met": false, "servingEpics": [] }
          ],
          "leaves": []
        }
        """.data(using: .utf8)!

        let detail = try JSONDecoder().decode(MissionDiagnostic.self, from: json)

        XCTAssertEqual(detail.criteria.first?.action, "future-action")
    }
}
