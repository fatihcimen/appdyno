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
                try job.stillWaited(before: "the field was tapped")
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
        let input = FieldInput(field: field, snap: snap, app: app, job: job, focusS: timeout)
        if field.exists {
            if replace, try !clear(input) { throw Device.lostFocus }
            if !replace || field.exists { try type(text, into: input, perSecond: 60) }
            // a secure field reads back as dots: waiting for it to hold the text took the whole echo wait, 1.5 s
            // a field that formats what is typed (a phone number) drops a key that comes while it rewrites itself,
            // one of ten at 60 a second: where what it must hold is known, it is typed again, a key at a time, once
            // it holds the focus again: a field that let go of it reads back as other
            let known = replace || before.isEmpty
            verified = secure ? nil : echoed(field, job: job, givesUp: known, holds: holds)
            if retypes(verified: verified, known: known, text: text), field.exists, !job.over, try clear(input) {
                let keys = KeysProbe(send: { try self.type($0, into: input, perSecond: 15) },
                                     read: { self.currentText(field) }, clock: { Date().timeIntervalSince1970 },
                                     pause: { Thread.sleep(forTimeInterval: $0) }, over: { job.over })
                try typeEach(text, waitS: Device.echoWaitS, keys)
                verified = echoed(field, job: job, givesUp: false, holds: holds)
            }
        }
        // no verdict when the field cannot be read back: gone (it took the text and submitted), or secure
        let verdict = secure ? nil : verified
        let submits = submitsText(asked: request.submit, verified: verdict)
        // a field that is gone has taken the text and submitted it already
        if submits, field.exists, !job.over { try type("\n", into: input, perSecond: 60) }
        let out = try after(request.after, job: job, actionAt: Int(Date().timeIntervalSince1970 * 1000), tapAt: nil)
        let wire = textWire(focusMs: focusMs, verified: verdict, notSubmitted: request.submit && !submits)
        return out.merging(wire) { $1 }
    }

    /// The field keys go to: its element, the snapshot that found its focus, its app, the request, and how long a tap
    /// that gives it the focus again is waited for.
    struct FieldInput {
        let field: XCUIElement
        let snap: XCUIElementSnapshot
        let app: XCUIApplication
        let job: Job
        let focusS: Double
    }

    static let lostFocus = AgentError(
        "NO_FOCUS", "the field let go of the keyboard focus, and a tap did not give it back",
        hint: "read the screen, then tap the field and type again"
    )

    /// Keys by the synthesizer, which records no failure whatever has the focus. shortcut: with the synthesizer gone
    /// XCUI's typing writes plain text into the test's log and result bundle, and goes only to a field that holds the
    /// focus, as with none it records a failure that ends the runner's test.
    private func type(_ text: String, into input: FieldInput, perSecond: UInt64) throws {
        if try !EventShim.type(text, orientation: Device.keysOrientation(), perSecond: perSecond) {
            guard holdsFocus(input) else { throw Device.lostFocus }
            input.field.typeText(text)
        }
    }

    /// Whether the field holds the keyboard focus now: by its identifier where it has one (one query), else by its
    /// place.
    private func holdsFocus(_ input: FieldInput) -> Bool {
        let snap = input.snap
        guard !snap.identifier.isEmpty else { return focusedField(input.app)?.snap.frame == snap.frame }
        return input.app.descendants(matching: snap.elementType).matching(identifier: snap.identifier)
            .matching(NSPredicate(format: "hasKeyboardFocus == true")).firstMatch.exists
    }

    /// Whether the field holds the focus as keys go to it, tapped once and waited for where it let go of it
    /// (`regainFocus`), its keyboard waited for after such a tap.
    private func focused(_ input: FieldInput) throws -> Bool {
        var tapped = false
        let frame = input.snap.frame
        let held = try regainFocus(waitS: input.focusS, FocusProbe(
            holds: { self.holdsFocus(input) },
            tap: {
                NSLog("appdyno runner: the field let go of the keyboard focus: it is tapped again")
                try input.job.stillWaited(before: "the field was tapped again")
                self.point(frame.midX, frame.midY).tap()
                tapped = true
            },
            clock: { Date().timeIntervalSince1970 }, pause: { Thread.sleep(forTimeInterval: $0) },
            over: { input.job.over }))
        if held, tapped { keyboardUp(input.app, job: input.job) }
        return held
    }

    /**
     * Whether the field holds the text once the keys are handled: a field that formats what is typed takes a moment
     * more, and a loaded Mac's app takes its keys in long after they went. The wait lasts while the text keeps
     * changing, until it has held still for the echo wait (`givesUp`: half a second), counted from the read that last
     * saw it change, as one read of a slow app took most of a second, and for `echoMostS` at most; nil: the field is
     * gone (a code entry that submitted itself took the text).
     */
    private func echoed(_ field: XCUIElement, job: Job, givesUp: Bool, holds: (String) -> Bool) -> Bool? {
        let stillS = givesUp ? 0.5 : Device.echoWaitS
        let end = Date().addingTimeInterval(Device.echoMostS)
        var last = currentText(field)
        var changed = Date()
        while let now = last, !holds(now), Date().timeIntervalSince(changed) < stillS, Date() < end, !job.over {
            Thread.sleep(forTimeInterval: 0.05)
            let readAt = Date()
            let next = currentText(field)
            if next != last { changed = readAt }
            last = next
        }
        return last.map(holds)
    }

    /// No element reports the focus (a code entry's hidden field): the keys go to whatever has the keyboard, as a
    /// person's would (XCUI's own typing refuses without a focused element); the text cannot be read back.
    private func typeUnfocused(_ request: TextRequest, into app: XCUIApplication, job: Job,
                               focusMs: Int) throws -> [String: Any] {
        let orientation = Device.keysOrientation()
        // XCUI's typing with no element reporting the focus records a failure that ends the runner's test
        let noFocus = AgentError("NO_FOCUS", "no text field took the focus", hint: "tap the field first")
        if try !EventShim.type(request.text, orientation: orientation) {
            guard app.keyboards.firstMatch.exists, focusedField(app) != nil else { throw noFocus }
            app.typeText(request.text)
        }
        if request.submit {
            try job.stillWaited(before: "the Enter")
            if try !EventShim.type("\n", orientation: orientation) {
                guard focusedField(app) != nil else { throw noFocus }
                app.typeText("\n")
            }
        }
        let out = try after(request.after, job: job, actionAt: Int(Date().timeIntervalSince1970 * 1000), tapAt: nil)
        return out.merging(textWire(focusMs: focusMs, verified: nil)) { $1 }
    }

    /// Clears what the text replaces: all of it selected and deleted at once, as deleting a formatting field's
    /// characters one by one moves its cursor and scrambles what is typed after (live: a phone number typed out of
    /// order). The focus is made sure of before the selection and before the delete: a hosted Mac's field had let go of
    /// it there, and XCUI's delete ended the runner. False where it did not come back.
    private func clear(_ input: FieldInput) throws -> Bool {
        guard try focused(input) else { return false }
        typeKey("a", .command, in: input.app)
        guard try focused(input) else { return false }
        try type(XCUIKeyboardKey.delete.rawValue, into: input, perSecond: 60)
        if let left = currentText(input.field), !left.isEmpty {
            NSLog("appdyno runner: select all left %d characters, deleted one by one", left.count)
            try type(String(repeating: XCUIKeyboardKey.delete.rawValue, count: left.count), into: input, perSecond: 60)
        }
        return true
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
