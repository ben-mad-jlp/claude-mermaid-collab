import XCTest
@testable import MermaidCollabCore

final class CampaignRowsTests: XCTestCase {
    // (1)
    func test1_campaignRowDecodedFromSnapshotElementCarriesIdAndTitle() throws {
        let json = """
        {
          "id": "camp-1",
          "title": "Harden the pairing flow",
          "goal": "No token leaks across servers",
          "createdAt": "2026-08-01T00:00:00.000Z",
          "droppedAt": null,
          "probes": [],
          "ruling": null,
          "chamber": null,
          "chamberHistory": [],
          "linkedMissions": [],
          "missionCount": 0,
          "leafCount": 0,
          "chamberRoster": []
        }
        """
        let row = try CampaignRow.decode(from: Data(json.utf8))
        XCTAssertEqual(row.id, "camp-1")
        XCTAssertEqual(row.title, "Harden the pairing flow")
    }

    // (2)
    func test2_campaignWithTwoProbesYieldsTwoProbeRows() throws {
        let json = """
        {
          "id": "camp-2",
          "title": "Two probes",
          "probes": [
            {"id": "probe-a", "kind": "command", "verdict": "not-run"},
            {"id": "probe-b", "kind": "command", "verdict": "pass"}
          ]
        }
        """
        let row = try CampaignRow.decode(from: Data(json.utf8))
        XCTAssertEqual(row.probes.count, 2)
        XCTAssertEqual(row.probes[0].id, "probe-a")
        XCTAssertEqual(row.probes[1].id, "probe-b")
    }

    // (3)
    func test3_probeWithFailingLatestVerdictYieldsStateFailing() throws {
        let json = """
        {
          "id": "camp-3",
          "title": "One failing probe",
          "probes": [
            {"id": "probe-a", "kind": "command", "verdict": "fail"}
          ]
        }
        """
        let row = try CampaignRow.decode(from: Data(json.utf8))
        XCTAssertEqual(row.probes[0].state, "failing")
    }
}
