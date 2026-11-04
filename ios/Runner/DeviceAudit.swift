import XCTest

extension Device {
    /// The platform audit's types by the protocol's names (`AUDIT_TYPES`).
    static let auditTypes: [(name: String, type: XCUIAccessibilityAuditType)] = [
        ("contrast", .contrast), ("elementDetection", .elementDetection), ("hitRegion", .hitRegion),
        ("sufficientElementDescription", .sufficientElementDescription), ("dynamicType", .dynamicType),
        ("textClipped", .textClipped), ("trait", .trait),
    ]

    /**
     * The platform's accessibility audit of the app in front. Each issue is taken by the handler, which
     * answers true (handled): an issue left to XCTest would be recorded as a test failure and fail the
     * request. An audit the platform cannot run is UNSUPPORTED (the caller goes on without it).
     */
    func audit(_ r: AuditRequest, job: Job) throws -> [String: Any] {
        let (app, id) = front()
        guard id != Device.springboardId else { throw AgentError("APP_NOT_RUNNING", "the target app is not in front") }
        var types: XCUIAccessibilityAuditType = []
        for t in Device.auditTypes where r.types?.contains(t.name) ?? true { types.insert(t.type) }
        let t0 = Date()
        var issues: [[String: Any]] = []
        var truncated = false
        do {
            try app.performAccessibilityAudit(for: types) { issue in
                // each issue's element is read once (a snapshot); past the limit only counted; a type this
                // runner does not name (a newer Xcode's) is left out
                if issues.count >= r.maxIssues || job.over { truncated = true } else if let i = Device.auditIssue(issue) { issues.append(i) }
                return true
            }
        } catch {
            throw AgentError("UNSUPPORTED", "the platform accessibility audit could not run: \(error.localizedDescription)")
        }
        return ["issues": issues, "truncated": truncated, "elapsedMs": Int(Date().timeIntervalSince(t0) * 1000)]
    }

    static func auditIssue(_ issue: XCUIAccessibilityAuditIssue) -> [String: Any]? {
        guard let name = auditTypes.first(where: { $0.type == issue.auditType })?.name else { return nil }
        guard let s = try? issue.element?.snapshot() else { return auditIssueWire(type: name, message: issue.compactDescription, box: nil, element: nil) }
        var el: [String: Any] = ["c": typeName(s.elementType)]
        if !s.identifier.isEmpty { el["id"] = s.identifier }
        if !s.label.isEmpty { el["d"] = s.label }
        if let v = s.value as? String, !v.isEmpty { el["t"] = v }
        return auditIssueWire(type: name, message: issue.compactDescription, box: box(s.frame), element: el)
    }
}
