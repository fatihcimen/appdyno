import Foundation
import ObjectiveC
import os
import UIKit
import XCTest

/// A tap sent straight to XCTest's event synthesizer (private API): one finger down and up at a screen
/// point, without XCUI's per-tap lookups and interruption checks. Used only when every class and
/// selector is there at run time (APPDYNO_FAST_TAP=0 turns it off); otherwise the public coordinate tap.
@MainActor enum EventShim {
    private typealias InitRecord = @convention(c) (AnyObject, Selector, NSString, Int) -> AnyObject
    private typealias InitPath = @convention(c) (AnyObject, Selector, CGPoint, Double) -> AnyObject
    private typealias Lift = @convention(c) (AnyObject, Selector, Double) -> Void
    private typealias MoveTo = @convention(c) (AnyObject, Selector, CGPoint, Double) -> Void
    private typealias AddPath = @convention(c) (AnyObject, Selector, AnyObject) -> Void
    private typealias Getter = @convention(c) (AnyObject, Selector) -> AnyObject?
    private typealias Synthesize = @convention(c) (AnyObject, Selector, AnyObject, AnyObject) -> Void
    private typealias InitText = @convention(c) (AnyObject, Selector) -> AnyObject
    private typealias TypeText = @convention(c) (AnyObject, Selector, NSString, Double, UInt64, Bool) -> Void

    private static let recordClass: AnyClass? = NSClassFromString("XCSynthesizedEventRecord")
    private static let pathClass: AnyClass? = NSClassFromString("XCPointerEventPath")
    private static let selInitRecord = NSSelectorFromString("initWithName:interfaceOrientation:")
    private static let selInitPath = NSSelectorFromString("initForTouchAtPoint:offset:")
    private static let selLift = NSSelectorFromString("liftUpAtOffset:")
    private static let selMove = NSSelectorFromString("moveToPoint:atOffset:")
    private static let selAdd = NSSelectorFromString("addPointerEventPath:")
    private static let selSynth = NSSelectorFromString("eventSynthesizer")
    private static let selSynthesize = NSSelectorFromString("synthesizeEvent:completion:")
    private static let selInitText = NSSelectorFromString("initForTextInput")
    private static let selTypeText = NSSelectorFromString("typeText:atOffset:typingSpeed:shouldRedact:")

    /// Keys typed through the synthesizer reach whatever has the keyboard, with no element reporting focus.
    static let textAvailable: Bool = {
        guard let record = recordClass, let path = pathClass,
              class_getInstanceMethod(record, selInitRecord) != nil, class_getInstanceMethod(record, selAdd) != nil,
              class_getInstanceMethod(path, selInitText) != nil, class_getInstanceMethod(path, selTypeText) != nil,
              XCUIDevice.shared.responds(to: selSynth),
              let synth = XCUIDevice.shared.perform(selSynth)?.takeUnretainedValue(),
              synth.responds(to: selSynthesize)
        else { return false }
        return true
    }()

    /// Everything a gesture along its samples needs exists. No public call can do one, so APPDYNO_FAST_TAP=0
    /// does not turn this off.
    static let gestureAvailable: Bool = {
        guard let record = recordClass, let path = pathClass,
              class_getInstanceMethod(record, selInitRecord) != nil, class_getInstanceMethod(record, selAdd) != nil,
              class_getInstanceMethod(path, selInitPath) != nil, class_getInstanceMethod(path, selMove) != nil,
              class_getInstanceMethod(path, selLift) != nil,
              XCUIDevice.shared.responds(to: selSynth),
              let synth = XCUIDevice.shared.perform(selSynth)?.takeUnretainedValue(),
              synth.responds(to: selSynthesize)
        else { return false }
        return true
    }()

    /// Everything the fast tap needs exists (checked once).
    static let available: Bool = {
        // on unless APPDYNO_FAST_TAP=0: about half the time of XCUI's tap on a phone (313 vs 603 ms)
        guard ProcessInfo.processInfo.environment["APPDYNO_FAST_TAP"] != "0",
              let record = recordClass, let path = pathClass,
              class_getInstanceMethod(record, selInitRecord) != nil, class_getInstanceMethod(record, selAdd) != nil,
              class_getInstanceMethod(path, selInitPath) != nil, class_getInstanceMethod(path, selLift) != nil,
              XCUIDevice.shared.responds(to: selSynth),
              let synth = XCUIDevice.shared.perform(selSynth)?.takeUnretainedValue(),
              synth.responds(to: selSynthesize)
        else { return false }
        return true
    }()

    private static func imp<T>(_ obj: AnyObject, _ sel: Selector, _: T.Type) -> T {
        unsafeBitCast(class_getMethodImplementation(object_getClass(obj), sel), to: T.self)
    }

    /// Taps at `p` (screen points); false when the synthesizer refused it, TIMEOUT when it did not answer.
    static func tap(_ p: CGPoint, orientation: Int) throws -> Bool {
        guard available, let recordType = recordClass, let pathType = pathClass else { return false }
        let rawRecord = recordType.alloc() as AnyObject
        let initRecord = imp(rawRecord, selInitRecord, InitRecord.self)
        let record = initRecord(rawRecord, selInitRecord, "tap" as NSString, orientation)
        let rawPath = pathType.alloc() as AnyObject
        let path = imp(rawPath, selInitPath, InitPath.self)(rawPath, selInitPath, p, 0)
        imp(path, selLift, Lift.self)(path, selLift, 0.05)
        imp(record, selAdd, AddPath.self)(record, selAdd, path)
        return try synthesize(record, within: 5, "a tap")
    }

    /// One path per finger on a `gestureTimeline`, all in one record; false or TIMEOUT as for a tap.
    static func gesture(_ fingers: [[GesturePoint]], liftAt: Double, orientation: Int) throws -> Bool {
        guard gestureAvailable, let recordType = recordClass, let pathType = pathClass else { return false }
        let rawRecord = recordType.alloc() as AnyObject
        let initRecord = imp(rawRecord, selInitRecord, InitRecord.self)
        let record = initRecord(rawRecord, selInitRecord, "gesture" as NSString, orientation)
        for f in fingers {
            let rawPath = pathType.alloc() as AnyObject
            let initPath = imp(rawPath, selInitPath, InitPath.self)
            let path = initPath(rawPath, selInitPath, CGPoint(x: f[0].x, y: f[0].y), f[0].t)
            for sample in f.dropFirst() {
                imp(path, selMove, MoveTo.self)(path, selMove, CGPoint(x: sample.x, y: sample.y), sample.t)
            }
            imp(path, selLift, Lift.self)(path, selLift, liftAt)
            imp(record, selAdd, AddPath.self)(record, selAdd, path)
        }
        return try synthesize(record, within: 5 + liftAt, "a gesture")
    }

    /// Types `text` as key events, `perSecond` of them a second (the synthesizer spaces them itself); false or
    /// TIMEOUT as for a tap.
    static func type(_ text: String, orientation: Int, perSecond: UInt64 = 60) throws -> Bool {
        guard textAvailable, let recordType = recordClass, let pathType = pathClass else { return false }
        let rawRecord = recordType.alloc() as AnyObject
        let initRecord = imp(rawRecord, selInitRecord, InitRecord.self)
        let record = initRecord(rawRecord, selInitRecord, "type" as NSString, orientation)
        let rawPath = pathType.alloc() as AnyObject
        let path = imp(rawPath, selInitText, InitText.self)(rawPath, selInitText)
        imp(path, selTypeText, TypeText.self)(path, selTypeText, text as NSString, 0, perSecond, true)
        imp(record, selAdd, AddPath.self)(record, selAdd, path)
        return try synthesize(record, within: 5 + Double(text.count) / Double(max(1, perSecond)), "typing")
    }

    private static func synthesize(_ record: AnyObject, within seconds: Double, _ what: String) throws -> Bool {
        guard let synth = XCUIDevice.shared.perform(selSynth)?.takeUnretainedValue() else { return false }
        let result = OSAllocatedUnfairLock<Bool?>(initialState: nil)
        // Sendable, as it may come on another thread
        let completion: @Sendable @convention(block) (Bool, NSError?) -> Void = { success, _ in
            result.withLock { $0 = success }
        }
        imp(synth, selSynthesize, Synthesize.self)(synth, selSynthesize, record, completion as AnyObject)
        let end = Date().addingTimeInterval(seconds)
        // the completion may come on this (main) thread: turn the run loop, never block it
        while result.withLock({ $0 }) == nil, Date() < end {
            RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.005))
        }
        return try synthesized(result.withLock { $0 }, what)
    }
}
