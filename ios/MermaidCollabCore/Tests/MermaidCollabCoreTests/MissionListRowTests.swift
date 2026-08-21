import XCTest
@testable import MermaidCollabCore

final class MissionListRowTests: XCTestCase {
    func test1_cheapRollupFactsOmittedDecodesAsUnconfirmed() throws {
        let json = """
        [
          {
            "node": {
              "id": "mission-1",
              "title": "Ship the thing",
              "status": "active",
              "nickname": "shipper"
            },
            "rollup": {
              "status": "in_progress",
              "mechanical": { "done": 1, "total": 3 },
              "capability": { "met": 0, "total": 2, "dropped": 0 },
              "factsOmitted": true
            },
            "ownerSession": "worker-abc"
          }
        ]
        """

        let rows = try JSONDecoder().decode([MissionListRow].self, from: Data(json.utf8))

        XCTAssertEqual(rows.count, 1)
        let row = rows[0]
        XCTAssertEqual(row.id, "mission-1")
        XCTAssertEqual(row.title, "Ship the thing")
        XCTAssertEqual(row.rollupConfirmed, false)
    }

    func test2_fullRollupFactsOmittedFalseDecodesAsConfirmed() throws {
        let json = """
        [
          {
            "node": {
              "id": "mission-2",
              "title": "Land the epic",
              "status": "converged"
            },
            "rollup": {
              "status": "done",
              "mechanical": { "done": 5, "total": 5 },
              "capability": { "met": 4, "total": 4, "dropped": 1 },
              "factsOmitted": false
            },
            "criteria": []
          }
        ]
        """

        let rows = try JSONDecoder().decode([MissionListRow].self, from: Data(json.utf8))

        XCTAssertEqual(rows.count, 1)
        let row = rows[0]
        XCTAssertEqual(row.rollupConfirmed, true)
        XCTAssertEqual(row.mechanicalDone, 5)
        XCTAssertEqual(row.mechanicalTotal, 5)
        XCTAssertEqual(row.capabilityMet, 4)
        XCTAssertEqual(row.capabilityTotal, 4)
        XCTAssertEqual(row.capabilityDropped, 1)
    }

    func test3_absentFactsOmittedDefaultsToConfirmed() throws {
        let json = """
        [
          {
            "node": {
              "id": "mission-3",
              "title": "No rollup yet",
              "status": "queued"
            },
            "rollup": {
              "status": "pending",
              "mechanical": { "done": 0, "total": 0 },
              "capability": { "met": 0, "total": 0, "dropped": 0 }
            }
          }
        ]
        """

        let rows = try JSONDecoder().decode([MissionListRow].self, from: Data(json.utf8))

        XCTAssertEqual(rows.count, 1)
        XCTAssertEqual(rows[0].rollupConfirmed, true)
    }
}
