import XCTest

extension Device {
    /// The platform audit's types by the protocol's names (`AUDIT_TYPES`).
    static let auditTypes: [(name: String, type: XCUIAccessibilityAuditType)] = [
        ("contrast", .contrast), ("elementDetection", .elementDetection), ("hitRegion", .hitRegion),
        ("sufficientElementDescription", .sufficientElementDescription), ("dynamicType", .dynamicType),
        ("textClipped", .textClipped), ("trait", .trait)
    ]

    /**
     * The platform's accessibility audit of the app in front. Each issue is taken by the handler, which
     * answers true (handled): an issue left to XCTest would be recorded as a test failure and fail the
     * request. An audit the platform cannot run is UNSUPPORTED (the caller goes on without it).
     */
    func audit(_ request: AuditRequest, job: Job) throws -> [String: Any] {
        let (app, id) = front()
        guard id != Device.springboardId else { throw AgentError("APP_NOT_RUNNING", "the target app is not in front") }
        // the platform audits everything when given no type, so a type it does not have is said, not passed on as none
        if let lacking = request.types?.first(where: { name in !Device.auditTypes.contains { $0.name == name } }) {
            throw AgentError("UNSUPPORTED", "the platform accessibility audit has no \(lacking)")
        }
        var types: XCUIAccessibilityAuditType = []
        for t in Device.auditTypes where request.types?.contains(t.name) ?? true { types.insert(t.type) }
        let start = Date()
        var issues: [[String: Any]] = []
        var truncated = false
        do {
            try app.performAccessibilityAudit(for: types) { issue in
                // each issue's element is read once (a snapshot); past the limit only counted; a type this
                // runner does not name (a newer Xcode's) is left out
                if issues.count >= request.maxIssues || job.over {
                    truncated = true
                } else if let found = Device.auditIssue(issue) {
                    issues.append(found)
                }
                return true
            }
        } catch {
            throw AgentError("UNSUPPORTED",
                             "the platform accessibility audit could not run: \(error.localizedDescription)")
        }
        return ["issues": issues, "truncated": truncated, "elapsedMs": Int(Date().timeIntervalSince(start) * 1000)]
    }

    static func auditIssue(_ issue: XCUIAccessibilityAuditIssue) -> [String: Any]? {
        guard let name = auditTypes.first(where: { $0.type == issue.auditType })?.name else { return nil }
        guard let snap = try? issue.element?.snapshot() else {
            return auditIssueWire(type: name, message: issue.compactDescription, box: nil, element: nil)
        }
        var element: [String: Any] = ["c": typeName(snap.elementType)]
        if !snap.identifier.isEmpty { element["id"] = snap.identifier }
        if !snap.label.isEmpty { element["d"] = snap.label }
        if let value = snap.value as? String, !value.isEmpty { element["t"] = value }
        return auditIssueWire(type: name, message: issue.compactDescription, box: box(snap.frame), element: element)
    }
}
