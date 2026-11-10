import UIKit
import XCTest

extension Device {
    /**
     * The field with the keyboard focus, held by a query that still finds it after the focus moves on (a
     * code entry submits itself when it is full): its identifier when it has one, else the focus query. With
     * the snapshot that found it, as each query costs a snapshot of the app.
     */
    func focusedField(_ app: XCUIApplication) -> (field: XCUIElement, snap: XCUIElementSnapshot)? {
        let f = app.descendants(matching: .any).matching(NSPredicate(format: "hasKeyboardFocus == true")).firstMatch
        // `exists` answers at once; a snapshot of a missing element waits for it to appear, as before a tap
        guard f.exists, let snap = try? f.snapshot() else { return nil }
        if !snap.identifier.isEmpty {
            return (app.descendants(matching: snap.elementType).matching(identifier: snap.identifier).firstMatch, snap)
        }
        return (f, snap)
    }

    /// A field's text in a snapshot; a field showing its placeholder is empty.
    private func textIn(_ snap: XCUIElementSnapshot) -> String {
        let value = (snap.value as? String) ?? ""
        return value == snap.placeholderValue ? "" : value
    }

    /// The field's text from a snapshot (nil when it is gone).
    private func currentText(_ f: XCUIElement) -> String? {
        (try? f.snapshot()).map(textIn)
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
            if focusedField(app)?.snap.frame.contains(CGPoint(x: x, y: y)) != true {
                _ = animationsOver(x, y)
                // XCUI's own, which returns once the app is idle: keys typed after a synthesized tap went in while the
                // keyboard came up, and a formatting field lost some ("(599) 999" of 5999999900, 3 of 3)
                point(x, y).tap()
            }
        }
        let timeout = Double(request.focusTimeoutMs) / 1000
        var found = focusedField(app)
        while found == nil, Date().timeIntervalSince(start) < timeout, !job.over {
            Thread.sleep(forTimeInterval: 0.08)
            found = focusedField(app)
        }
        let focusMs = Int(Date().timeIntervalSince(start) * 1000)
        // a caller told TIMEOUT or CANCELLED may ask again: its text must not land after that
        try job.stillWaited(before: "the text was typed")
        guard let (field, snap) = found else {
            return try typeUnfocused(request, into: app, job: job, focusMs: focusMs)
        }
        let replace = request.replace
        let secure = snap.elementType == .secureTextField
        let before = textIn(snap)
        let holds = { (now: String) in holdsText(now, before: before, text: text, replace: replace) }
        // keys, not a paste: a paste the user did not make brings up iOS's "Allow Paste" alert, which no one
        // answers here and which holds the text up (a timeout, or text doubled once it goes)
        keyboardUp(app, job: job)
        try job.stillWaited(before: "the text was typed")
        var verified: Bool? = false
        if field.exists {
            if replace { clear(field) }
            if !replace || field.exists { try type(text, into: field, perSecond: 60) }
            // a secure field reads back as dots: waiting for it to hold the text took the whole echo wait, 1.5 s
            // a field that formats what is typed (a phone number) drops a key that comes while it rewrites itself,
            // one of ten at 60 a second: where what it must hold is known, it is typed again, slower
            let known = replace || before.isEmpty
            verified = secure ? nil : echoed(field, job: job, givesUp: known, holds: holds)
            if verified == false, known, field.exists, !job.over {
                clear(field)
                try type(text, into: field, perSecond: 15)
                verified = echoed(field, job: job, givesUp: false, holds: holds)
            }
        }
        // a field that is gone has taken the text and submitted it already
        if request.submit, field.exists, !job.over { field.typeText("\n") }
        let out = try after(request.after, job: job, actionAt: Int(Date().timeIntervalSince1970 * 1000), tapAt: nil)
        // no verdict when the field cannot be read back: gone (it took the text and submitted), or secure
        return out.merging(textWire(focusMs: focusMs, verified: secure ? nil : verified)) { $1 }
    }

    /// shortcut: with the synthesizer gone XCUI's typing writes plain text into the test's log and result bundle
    private func type(_ text: String, into field: XCUIElement, perSecond: UInt64) throws {
        if try !EventShim.type(text, orientation: Device.keysOrientation(), perSecond: perSecond) {
            field.typeText(text)
        }
    }

    /**
     * Whether the field holds the text once the keys are handled, within the echo wait: a field that formats what is
     * typed takes a moment more. `givesUp`: one whose text has held still for half a second will not; nil: the field is
     * gone (a code entry that submitted itself took the text).
     */
    private func echoed(_ field: XCUIElement, job: Job, givesUp: Bool, holds: (String) -> Bool) -> Bool? {
        let end = Date().addingTimeInterval(Device.echoWaitS)
        var last = currentText(field)
        var still = Date()
        while let now = last, !holds(now), Date() < end, !job.over {
            if givesUp, Date().timeIntervalSince(still) >= 0.5 { return false }
            Thread.sleep(forTimeInterval: 0.05)
            let next = currentText(field)
            if next != last { still = Date() }
            last = next
        }
        return last.map(holds)
    }

    /// No element reports the focus (a code entry's hidden field): the keys go to whatever has the keyboard, as a
    /// person's would (XCUI's own typing refuses without a focused element); the text cannot be read back.
    private func typeUnfocused(_ request: TextRequest, into app: XCUIApplication, job: Job,
                               focusMs: Int) throws -> [String: Any] {
        let orientation = Device.keysOrientation()
        if try !EventShim.type(request.text, orientation: orientation) {
            guard app.keyboards.firstMatch.exists else {
                throw AgentError("NO_FOCUS", "no text field took the focus", hint: "tap the field first")
            }
            app.typeText(request.text)
        }
        if request.submit, try !EventShim.type("\n", orientation: orientation) { app.typeText("\n") }
        let out = try after(request.after, job: job, actionAt: Int(Date().timeIntervalSince1970 * 1000), tapAt: nil)
        return out.merging(textWire(focusMs: focusMs, verified: nil)) { $1 }
    }

    /// Clears what the text replaces: all of it selected and deleted at once, as deleting a formatting field's
    /// characters one by one moves its cursor and scrambles what is typed after (live: a phone number typed out of
    /// order).
    private func clear(_ field: XCUIElement) {
        field.typeKey("a", modifierFlags: .command)
        field.typeText(XCUIKeyboardKey.delete.rawValue)
        if let left = currentText(field), !left.isEmpty {
            field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: left.count))
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
            while focusedField(app)?.snap.frame.contains(CGPoint(x: x, y: y)) != true {
                guard Date() < end, !job.over else {
                    throw AgentError("NO_FOCUS", "the field there did not take the focus", hint: "tap the field first")
                }
                Thread.sleep(forTimeInterval: 0.15)
            }
            keyboardUp(app, job: job)
        }
        let focusMs = Int(Date().timeIntervalSince(start) * 1000)
        guard try EventShim.type(request.text, orientation: Device.keysOrientation()) else {
            throw AgentError("UNSUPPORTED", "this Xcode's event synthesizer takes no text")
        }
        return ["focusMs": focusMs]
    }
}
