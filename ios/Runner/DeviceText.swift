import UIKit
import XCTest

extension Device {
    /**
     * The field with the keyboard focus, held by a query that still finds it after the focus moves on (a
     * code entry submits itself when it is full): its identifier when it has one, else the focus query.
     */
    func focusedField(_ app: XCUIApplication) -> XCUIElement? {
        let f = app.descendants(matching: .any).matching(NSPredicate(format: "hasKeyboardFocus == true")).firstMatch
        // `exists` answers at once; a snapshot of a missing element waits for it to appear, as before a tap
        guard f.exists, let snap = try? f.snapshot() else { return nil }
        if !snap.identifier.isEmpty {
            return app.descendants(matching: snap.elementType).matching(identifier: snap.identifier).firstMatch
        }
        return f
    }

    /// The field's text from a snapshot (nil when it is gone); a field showing its placeholder is empty.
    private func currentText(_ f: XCUIElement) -> String? {
        guard let snap = try? f.snapshot() else { return nil }
        let value = (snap.value as? String) ?? ""
        return value == snap.placeholderValue ? "" : value
    }

    /// Reading what another app put on the pasteboard asks the user, whom this thread would wait for
    /// forever. Only the count of changes can be read without asking, so that is what tells whose it is.
    private static var pasteboardMark = -1
    static var ownsPasteboard: Bool { UIPasteboard.general.changeCount == pasteboardMark }
    static func markPasteboard() { pasteboardMark = UIPasteboard.general.changeCount }

    func setText(_ request: TextRequest, job: Job) throws -> [String: Any] {
        let text = request.text
        let start = Date()
        let app = front().0
        if let (x, y) = request.at {
            // a field that already has the focus there is not tapped again (each event costs about 350 ms)
            let focused = try? focusedField(app)?.snapshot()
            if focused?.frame.contains(CGPoint(x: x, y: y)) != true {
                _ = animationsOver(x, y)
                point(x, y).tap()
            }
        }
        let timeout = Double(request.focusTimeoutMs) / 1000
        var field = focusedField(app)
        while field == nil, Date().timeIntervalSince(start) < timeout, !job.over {
            Thread.sleep(forTimeInterval: 0.08)
            field = focusedField(app)
        }
        let focusMs = Int(Date().timeIntervalSince(start) * 1000)
        guard let field else { return try typeUnfocused(request, into: app, job: job, focusMs: focusMs) }
        let replace = request.replace
        let secure = (try? field.snapshot())?.elementType == .secureTextField
        let before = currentText(field) ?? ""
        // nil: the field is gone (a code entry that submitted itself took the text)
        func check() -> Bool? {
            currentText(field).map { holdsText($0, before: before, text: text, replace: replace) }
        }
        // keys, not a paste: a paste the user did not make brings up iOS's "Allow Paste" alert, which no one
        // answers here and which holds the text up (a timeout, or text doubled once it goes)
        keyboardUp(app, job: job)
        var verified: Bool? = false
        if verified == false, field.exists {
            makeRoom(in: field, before: before, text: text, replace: replace)
            // shortcut: with the synthesizer gone XCUI's typing writes plain text into the test's log and result bundle
            if field.exists, !EventShim.type(text, orientation: Device.interfaceOrientation()) { field.typeText(text) }
            verified = check()
            // the keys are sent, not yet handled, and a field that formats what is typed takes a moment more
            let echoEnd = Date().addingTimeInterval(Device.echoWaitS)
            while verified == false, Date() < echoEnd, !job.over {
                Thread.sleep(forTimeInterval: 0.05)
                verified = check()
            }
        }
        // a field that is gone has taken the text and submitted it already
        if request.submit, field.exists { field.typeText("\n") }
        let out = try after(request.after, job: job, actionAt: Int(Date().timeIntervalSince1970 * 1000), tapAt: nil)
        // no verdict when the field cannot be read back: gone (it took the text and submitted), or secure
        return out.merging(textWire(focusMs: focusMs, verified: secure ? nil : verified)) { $1 }
    }

    /// No element reports the focus (a code entry's hidden field): the keys go to whatever has the keyboard, as a
    /// person's would (XCUI's own typing refuses without a focused element); the text cannot be read back.
    private func typeUnfocused(_ request: TextRequest, into app: XCUIApplication, job: Job,
                               focusMs: Int) throws -> [String: Any] {
        let orientation = Device.interfaceOrientation()
        let typed = EventShim.type(request.text, orientation: orientation)
        if !typed {
            guard app.keyboards.firstMatch.exists else {
                throw AgentError("NO_FOCUS", "no text field took the focus", hint: "tap the field first")
            }
            app.typeText(request.text)
        }
        if request.submit, !EventShim.type("\n", orientation: orientation) { app.typeText("\n") }
        let out = try after(request.after, job: job, actionAt: Int(Date().timeIntervalSince1970 * 1000), tapAt: nil)
        return out.merging(textWire(focusMs: focusMs, verified: nil)) { $1 }
    }

    /// Clears what the text replaces, or what a paste that went in half added.
    private func makeRoom(in field: XCUIElement, before: String, text: String, replace: Bool) {
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
    }

    /// A field that just took the focus may not take key commands before its keyboard is up.
    private func keyboardUp(_ app: XCUIApplication, job: Job) {
        let keyboard = app.keyboards.firstMatch
        let end = Date().addingTimeInterval(1)
        while !keyboard.exists, Date() < end, !job.over { Thread.sleep(forTimeInterval: 0.05) }
    }

    /**
     * What a person types in a mirror: a string to the synthesizer, so the phone's layout has no say in the letters and
     * nothing is read back. `into` is a point of a field they tapped: the letters wait for that field and for no other,
     * as one a keyboard is already up on keeps the focus for a while after the tap.
     */
    func typeKeys(_ request: KeysRequest, job: Job) throws -> [String: Any] {
        let start = Date()
        if let (x, y) = request.into {
            let app = front().0
            let end = start.addingTimeInterval(Double(request.focusTimeoutMs) / 1000)
            while (try? focusedField(app)?.snapshot())?.frame.contains(CGPoint(x: x, y: y)) != true {
                guard Date() < end, !job.over else {
                    throw AgentError("NO_FOCUS", "the field there did not take the focus", hint: "tap the field first")
                }
                Thread.sleep(forTimeInterval: 0.15)
            }
            keyboardUp(app, job: job)
        }
        let focusMs = Int(Date().timeIntervalSince(start) * 1000)
        guard EventShim.type(request.text, orientation: Device.interfaceOrientation()) else {
            throw AgentError("UNSUPPORTED", "this Xcode's event synthesizer takes no text")
        }
        return ["focusMs": focusMs]
    }
}
