import XCTest
@testable import MermaidCollabCore

final class ServerProjectsMappingTests: XCTestCase {
    func test1_twoServersYieldOneKeyEachWithTheirOwnProjects() {
        let result = ServerProjectsMapping.mapping(from: [
            (serverId: "a", projects: ["/p/one"]),
            (serverId: "b", projects: ["/p/two", "/p/three"]),
        ])

        XCTAssertEqual(result.keys.count, 2)
        XCTAssertEqual(result["a"], ["/p/one"])
        XCTAssertEqual(result["b"], ["/p/two", "/p/three"])
    }
}
