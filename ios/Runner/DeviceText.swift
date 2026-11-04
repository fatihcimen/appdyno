import UIKit
import XCTest

extension Device {
    /**
     * The field with the keyboard focus, held by a query that still finds it after the focus moves on (a
     * code entry submits itself when it is full): its identifier when it has one, else the focus query.
     */
    func focusedField(_ app: XCUIApplication) -> XCUIElement? {
        let f = app.descendants(matching: .any).matching(NSPredicate(format: "hasKeyboardFocus == true")).firstMatch
        guard let snap = try? f.snapshot() else { return nil }
        if !snap.identifier.isEmpty {
            return app.descendants(matching: snap.elementType).matching(identifier: snap.identifier).firstMatch
        }
        return f
    }

    /// The field's text; a field showing its placeholder is empty.
    /// The field's text from a snapshot (nil when it is gone); a field showing its placeholder is empty.
    private func currentText(_ f: XCUIElement) -> String? {
        guard let s = try? f.snapshot() else { return nil }
        let v = (s.value as? String) ?? ""
        return v == s.placeholderValue ? "" : v
    }

    /// Reading what another app put on the pasteboard asks the user, whom this thread would wait for
    /// forever. Only the count of changes can be read without asking, so that is what tells whose it is.
    private static var pasteboardMark = -1
    static var ownsPasteboard: Bool { UIPasteboard.general.changeCount == pasteboardMark }
    static func markPasteboard() { pasteboardMark = UIPasteboard.general.changeCount }

    func setText(_ r: TextRequest, job: Job) throws -> [String: Any] {
        let text = r.text
        let t0 = Date()
        let app = front().0
        if let (x, y) = r.at {
            // a field that already has the focus there is not tapped again (each event costs about 350 ms)
            let focused = focusedField(app)
            if focused == nil || !(focused!.frame.contains(CGPoint(x: x, y: y))) {
                _ = animationsOver(x, y)
                point(x, y).tap()
            }
        }
        let timeout = Double(r.focusTimeoutMs) / 1000
        var field = focusedField(app)
        while field == nil, Date().timeIntervalSince(t0) < timeout, !job.over {
            Thread.sleep(forTimeInterval: 0.08)
            field = focusedField(app)
        }
        let focusMs = Int(Date().timeIntervalSince(t0) * 1000)
        guard let field else {
            // no element reports the focus (a code entry's hidden field): the keys go to whatever has the
            // keyboard, as a person's would (XCUI's own typing refuses without a focused element); the text
            // cannot be read back
            let o = Device.interfaceOrientation()
            let typed = EventShim.type(text, orientation: o)
            if !typed {
                guard app.keyboards.firstMatch.exists else {
                    throw AgentError("NO_FOCUS", "no text field took the focus", hint: "tap the field first")
                }
                app.typeText(text)
            }
            if r.submit, !EventShim.type("\n", orientation: o) { app.typeText("\n") }
            let out = try after(r.after, job: job, actionAt: Int(Date().timeIntervalSince1970 * 1000), tapAt: nil)
            return out.merging(textWire(focusMs: focusMs, verified: nil)) { $1 }
        }
        let replace = r.replace
        let secure = field.elementType == .secureTextField
        let before = currentText(field) ?? ""
        // nil: the field is gone (a code entry that submitted itself took the text)
        func check() -> Bool? {
            currentText(field).map { holdsText($0, before: before, text: text, replace: replace) }
        }
        // keys, not a paste: a paste the user did not make brings up iOS's "Allow Paste" alert, which no one
        // answers here and which holds the text up (a timeout, or text doubled once it goes)
        // a field that just took the focus may not take key commands before its keyboard is up
        let keyboard = app.keyboards.firstMatch
        let kbEnd = Date().addingTimeInterval(1)
        while !keyboard.exists, Date() < kbEnd, !job.over { Thread.sleep(forTimeInterval: 0.05) }
        var verified: Bool? = false
        if verified == false, field.exists {
            if replace {
                // all of it selected and deleted at once: deleting a formatting field's characters one by one
                // moves its cursor and scrambles what is typed after (live: a phone number typed out of order)
                field.typeKey("a", modifierFlags: .command)
                field.typeText(XCUIKeyboardKey.delete.rawValue)
                if let left = currentText(field), !left.isEmpty {
                    field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: left.count))
                }
            } else if let now = currentText(field), now.count > before.count, !now.hasPrefix(before + text) {
                // a paste that went in half: what it added is taken back
                field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: now.count - before.count))
            }
            if field.exists { field.typeText(text) }
            verified = check()
            // the keys are sent, not yet handled, and a field that formats what is typed takes a moment more
            let echoEnd = Date().addingTimeInterval(Device.echoWaitS)
            while verified == false, Date() < echoEnd, !job.over {
                Thread.sleep(forTimeInterval: 0.05)
                verified = check()
            }
        }
        // a field that is gone has taken the text and submitted it already
        if r.submit, field.exists { field.typeText("\n") }
        let out = try after(r.after, job: job, actionAt: Int(Date().timeIntervalSince1970 * 1000), tapAt: nil)
        // no verdict when the field cannot be read back: gone (it took the text and submitted), or secure
        return out.merging(textWire(focusMs: focusMs, verified: secure ? nil : verified)) { $1 }
    }
}
