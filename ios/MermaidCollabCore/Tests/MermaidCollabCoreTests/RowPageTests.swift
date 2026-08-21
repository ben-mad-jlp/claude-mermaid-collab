import XCTest
@testable import MermaidCollabCore

final class RowPageTests: XCTestCase {
    func test1_pageOf200RowsWithPageSize50CarriesFiftyRows() {
        let page = RowPage.build(rows: Array(1...200), pageSize: 50)

        XCTAssertEqual(page.rows.count, 50)
    }

    func test2_pageOf200RowsWithPageSize50CarriesOmittedCountOf150() {
        let page = RowPage.build(rows: Array(1...200), pageSize: 50)

        XCTAssertEqual(page.omittedCount, 150)
    }

    func test3_pageOf10RowsWithPageSize50CarriesTenRowsAndZeroOmittedCount() {
        let page = RowPage.build(rows: Array(1...10), pageSize: 50)

        XCTAssertEqual(page.rows.count, 10)
        XCTAssertEqual(page.omittedCount, 0)
    }
}
