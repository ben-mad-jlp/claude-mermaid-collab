import XCTest
import MermaidCollabCore

final class ServerRequestRoutingTests: XCTestCase {
    private func makeRegistry() -> ServerRegistry {
        ServerRegistry(entries: [
            ServerEntry(id: "srv-owner", label: "Owner", host: "owner.local:9002", source: .manual),
            ServerEntry(id: "srv-other", label: "Other", host: "other.local:9002", source: .manual),
        ])
    }

    func testRouteForProjectTargetsOwnerServerWhileDifferentServerIsSelected() {
        let route = ServerRequestRouter.route(
            forProject: "/Users/x/Code/alpha",
            path: "/api/todos",
            registry: makeRegistry(),
            projectsByServerId: ["srv-owner": ["/Users/x/Code/alpha"]],
            selectedServerId: "srv-other",
            localServerId: nil
        )

        XCTAssertEqual(route.serverId, "srv-owner")
        XCTAssertEqual(route.host, "owner.local:9002")
        XCTAssertEqual(route.url, URL(string: "http://owner.local:9002/api/todos"))
    }

    func testUnownedProjectFallsBackToSelectedServer() {
        let route = ServerRequestRouter.route(
            forProject: "/Users/x/Code/unclaimed",
            path: "/api/todos",
            registry: makeRegistry(),
            projectsByServerId: [:],
            selectedServerId: "srv-other",
            localServerId: nil
        )

        XCTAssertEqual(route.serverId, "srv-other")
        XCTAssertEqual(route.host, "other.local:9002")
    }

    func testExplicitServerIdOverloadTargetsThatServer() {
        let route = ServerRequestRouter.route(
            serverId: "srv-owner",
            path: "/api/auth/check",
            registry: makeRegistry()
        )

        XCTAssertEqual(route.serverId, "srv-owner")
        XCTAssertEqual(route.url, URL(string: "http://owner.local:9002/api/auth/check"))
    }
}
