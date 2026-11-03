import XCTest

/// XCTest's own metrics under `measure()`, apart from the runner's test (one set of metrics per test method).
/// The app is named by APPDYNO_METRICS_APP; xcodebuild passes TEST_RUNNER_-prefixed variables.
final class PerfMetricsTests: XCTestCase {
    private func target() throws -> XCUIApplication {
        guard let id = ProcessInfo.processInfo.environment["APPDYNO_METRICS_APP"], !id.isEmpty else {
            throw AgentError("INVALID_ARGUMENT", "APPDYNO_METRICS_APP is required")
        }
        return XCUIApplication(bundleIdentifier: id)
    }

    /// Scrolls what is on the app's screen, so the caller brings it there first.
    func testHitches() throws {
        let app = try target()
        guard #available(iOS 26, *) else { throw XCTSkip("XCTHitchMetric needs iOS 26") }
        app.activate()
        let options = XCTMeasureOptions()
        options.invocationOptions = [.manuallyStop]
        measure(metrics: [XCTHitchMetric(application: app)], options: options) {
            app.swipeUp(velocity: .fast)
            app.swipeUp(velocity: .fast)
            stopMeasuring()
            app.swipeDown(velocity: .fast)
            app.swipeDown(velocity: .fast)
        }
    }

    func testLaunch() throws {
        let app = try target()
        measure(metrics: [XCTApplicationLaunchMetric()]) { app.launch() }
    }
}
