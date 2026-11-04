// A process inside one simulator that reads the app in front through the accessibility server, with no
// XCTest test running in it. Requests and answers are JSON lines on stdin and stdout. The calls and the
// halving of rejected depths follow idb's SimulatorFrameworkBridge (MIT, see THIRD_PARTY_NOTICES). Private
// API: appdyno checks it at start, and any read it refuses goes to the runner.
#import <Foundation/Foundation.h>
#import <CoreGraphics/CoreGraphics.h>
#import <dlfcn.h>
#import <objc/message.h>
#import <objc/runtime.h>

@protocol AX
- (instancetype)initForRemoteAccess;
- (id)userTestingSnapshotForElement:(id)element options:(NSDictionary *)options error:(NSError **)error;
+ (id)elementWithProcessIdentifier:(pid_t)pid;
- (void *)AXUIElement;
+ (id)primaryApp;
+ (id)systemApplication;
- (pid_t)pid;
- (NSString *)bundleId;
- (CGRect)frame;
@end

static NSString *const SnapshotAttributesKey = @"UIAccessibilitySnapshotKeyAttributes";
static NSString *const SnapshotChildrenKey = @"UIAccessibilitySnapshotKeyChildren";
static NSString *const SnapshotChildCountKey = @"UIAccessibilitySnapshotKeyChildrenCount";
static NSString *const SnapshotElementKey = @"UIAccessibilitySnapshotKeyElement";
// The AX server rejects a request of more than about 62 levels on a deep tree.
static const NSUInteger FirstRequestLevels = 60;
static const int RequestLimit = 64;

static id<AX> gFramework;
static Class gElementClass, gAXElement;
static NSDictionary *(*gDefaultParameters)(void);
static NSArray *(*gNumbersForNames)(NSArray *);
static uint32_t (*gValueType)(const void *);
static Boolean (*gValueGet)(const void *, uint32_t, void *);
static NSArray<NSString *> *gNames;
static NSArray *gNumbers;
static NSDictionary<NSNumber *, NSString *> *gShortNames;
static NSNumber *gFrameNumber, *gChildrenNumber;

// The switches XCTest turns on for its run and off at its end: with them off an app tells the accessibility
// server nothing, not even its name. On while this helper is asked to read; off again on `leave`, if it was
// this helper that turned them on and the host starts no runner that needs them.
static BOOL gTurnedOn;
static int (*gAppAXOn)(void), (*gAutomationOn)(void);
static void (*gSetAppAX)(int), (*gSetAutomation)(int);

static void accessibilityOn(void) {
  if (gAppAXOn() && gAutomationOn()) return;
  gSetAppAX(1);
  gSetAutomation(1);
  gTurnedOn = YES;
}

static NSString *setup(void) {
  dlopen("/System/Library/PrivateFrameworks/AXRuntime.framework/AXRuntime", RTLD_NOW);
  dlopen("/System/Library/PrivateFrameworks/AccessibilityUtilities.framework/AccessibilityUtilities", RTLD_NOW);
  dlopen("/Developer/Library/PrivateFrameworks/XCTAutomationSupport.framework/XCTAutomationSupport", RTLD_NOW);
  Class framework = objc_lookUpClass("XCTAccessibilityFramework");
  gElementClass = objc_lookUpClass("XCAccessibilityElement");
  gAXElement = objc_lookUpClass("AXElement");
  if (!framework || !gElementClass || !gAXElement) return @"the accessibility classes are missing";
  gFramework = [(id<AX>)[framework alloc] initForRemoteAccess];
  if (![(id)gFramework respondsToSelector:@selector(userTestingSnapshotForElement:options:error:)]) return @"the snapshot call is missing";
  gDefaultParameters = dlsym(RTLD_DEFAULT, "XCTDefaultSnapshotParameters");
  gNumbersForNames = dlsym(RTLD_DEFAULT, "XCAXAccessibilityAttributesForStringAttributes");
  gValueType = dlsym(RTLD_DEFAULT, "AXValueGetType");
  gValueGet = dlsym(RTLD_DEFAULT, "AXValueGetValue");
  if (!gDefaultParameters || !gNumbersForNames || !gValueType || !gValueGet) return @"the conversion calls are missing";
  dlopen("/usr/lib/libAccessibility.dylib", RTLD_NOW);
  gAppAXOn = dlsym(RTLD_DEFAULT, "_AXSApplicationAccessibilityEnabled");
  gAutomationOn = dlsym(RTLD_DEFAULT, "_AXSAutomationEnabled");
  gSetAppAX = dlsym(RTLD_DEFAULT, "_AXSApplicationAccessibilitySetEnabled");
  gSetAutomation = dlsym(RTLD_DEFAULT, "_AXSSetAutomationEnabled");
  if (!gAppAXOn || !gAutomationOn || !gSetAppAX || !gSetAutomation) return @"the accessibility switches are missing";
  NSDictionary<NSString *, NSString *> *names = @{
    @"XC_kAXXCAttributeAutomationType": @"a", @"XC_kAXXCAttributeElementType": @"e", @"XC_kAXXCAttributeLabel": @"l",
    @"XC_kAXXCAttributeValue": @"v", @"XC_kAXXCAttributePlaceholderValue": @"h", @"XC_kAXXCAttributeIdentifier": @"i",
    @"XC_kAXXCAttributeFrame": @"f", @"XC_kAXXCAttributeTraits": @"t", @"XC_kAXXCAttributeChildren": @"k",
    @"XC_kAXXCAttributeIsRemoteElement": @"r", @"XC_kAXXCAttributeHasNativeFocus": @"n",
  };
  gNames = names.allKeys;
  gNumbers = gNumbersForNames(gNames);
  if (gNumbers.count != gNames.count) return @"the attribute names are not known";
  NSMutableDictionary *byNumber = [NSMutableDictionary dictionary];
  [gNumbers enumerateObjectsUsingBlock:^(id n, NSUInteger i, BOOL *stop) { byNumber[n] = names[gNames[i]]; }];
  gShortNames = byNumber;
  gFrameNumber = gNumbers[[gNames indexOfObject:@"XC_kAXXCAttributeFrame"]];
  gChildrenNumber = gNumbers[[gNames indexOfObject:@"XC_kAXXCAttributeChildren"]];
  return nil;
}

typedef struct { int requests; int rejected; NSUInteger levels; } Capture;

static NSDictionary *request(id element, NSUInteger maxNodes, Capture *c, NSError **error) {
  for (;;) {
    if (c->requests++ >= RequestLimit) return nil;
    NSMutableDictionary *options = [gDefaultParameters() mutableCopy] ?: [NSMutableDictionary dictionary];
    options[@"attributes"] = gNumbers;
    options[@"maxDepth"] = @(c->levels);
    options[@"maxChildren"] = @(maxNodes);
    options[@"maxArrayCount"] = @(maxNodes);
    // what a modal view covers is left out, as XCUI leaves it out: a sheet over a list is no list to touch
    options[@"snapshotKeyHonorModalViews"] = @YES;
    NSError *failure = nil;
    NSDictionary *tree = [gFramework userTestingSnapshotForElement:element options:options error:&failure];
    if (tree) return tree;
    NSNumber *ax = failure.userInfo[@"accessibility-error"];
    BOOL rejected = ([ax isKindOfClass:NSNumber.class] && ax.integerValue == -25201) ||
        ([failure.domain isEqualToString:@"com.apple.dt.xctest.automation-support.error"] && failure.code == 5);
    if (!rejected || c->levels <= 1 || ++c->rejected > 2) {
      if (error) *error = failure;
      return nil;
    }
    c->levels /= 2;
  }
}

// To JSON, in the order the snapshot gives; a boundary node whose children were withheld is read again.
static NSDictionary *build(NSDictionary *snapshot, NSUInteger left, NSUInteger *count, NSUInteger maxNodes, Capture *c, NSError **error) {
  NSDictionary *attributes = snapshot[SnapshotAttributesKey];
  NSMutableDictionary *node = [NSMutableDictionary dictionaryWithCapacity:8];
  for (NSNumber *number in attributes) {
    NSString *name = gShortNames[number];
    if (!name || [number isEqual:gChildrenNumber]) continue;
    id value = attributes[number];
    if ([number isEqual:gFrameNumber]) {
      CGRect r;
      if (gValueType((__bridge const void *)value) == 3 && gValueGet((__bridge const void *)value, 3, &r)) {
        if (isfinite(r.origin.x) && isfinite(r.origin.y) && isfinite(r.size.width) && isfinite(r.size.height))
          node[name] = @[@(r.origin.x), @(r.origin.y), @(r.size.width), @(r.size.height)];
      }
    } else if ([value isKindOfClass:NSString.class] || [value isKindOfClass:NSNumber.class]) {
      // the traits word is 64 bits wide, past what a JSON number keeps
      node[name] = [name isEqualToString:@"t"] ? [value stringValue] : value;
    }
  }
  NSArray *children = snapshot[SnapshotChildrenKey];
  NSNumber *known = snapshot[SnapshotChildCountKey];
  if ([known isKindOfClass:NSNumber.class] && known.unsignedIntegerValue > children.count && *count < maxNodes) {
    id element = snapshot[SnapshotElementKey];
    if (!element) return nil;
    NSDictionary *more = request(element, maxNodes - *count, c, error);
    if (!more) return nil;
    children = more[SnapshotChildrenKey];
  }
  if (children.count) {
    NSMutableArray *built = [NSMutableArray arrayWithCapacity:children.count];
    for (NSDictionary *child in children) {
      if (++*count > maxNodes) { node[@"cut"] = @YES; break; }
      NSDictionary *b = build(child, left - 1, count, maxNodes, c, error);
      if (!b) return nil;
      [built addObject:b];
    }
    node[@"k"] = built;
  }
  return node;
}

static NSDictionary *refuse(NSString *why) { return @{@"ok": @NO, @"refused": why}; }

static NSDictionary *readApp(NSDictionary *q) {
  id<AX> primary = [(id<AX>)gAXElement primaryApp];
  pid_t pid = [(id)primary respondsToSelector:@selector(pid)] ? [primary pid] : 0;
  NSString *bundle = [(id)primary respondsToSelector:@selector(bundleId)] ? [primary bundleId] : nil;
  if (pid <= 0 || !bundle) return refuse(@"no-foreground");
  NSString *wanted = q[@"bundle"];
  if (wanted && ![wanted isEqualToString:bundle]) return @{@"ok": @NO, @"refused": @"not-foreground", @"front": bundle};
  id<AX> system = [(id<AX>)gAXElement systemApplication];
  CGRect window = [primary frame], screen = [system frame];
  if (CGRectGetWidth(screen) > 0 && CGRectGetWidth(window) > 0 && !CGRectEqualToRect(CGRectIntegral(window), CGRectIntegral(screen)))
    return refuse(@"window-not-full-screen");
  __attribute__((objc_precise_lifetime)) id<AX> root = [(id<AX>)gElementClass elementWithProcessIdentifier:pid];
  void *raw = [root AXUIElement];
  if (!raw) return refuse(@"no-element");
  NSUInteger maxNodes = [q[@"maxNodes"] unsignedIntegerValue] ?: 5000;
  Capture c = {0, 0, FirstRequestLevels};
  NSError *error = nil;
  NSDictionary *snapshot = request((__bridge id)raw, maxNodes, &c, &error);
  if (!snapshot) return @{@"ok": @NO, @"refused": @"read-failed", @"error": error.localizedDescription ?: @"", @"requests": @(c.requests)};
  NSUInteger count = 1;
  NSDictionary *tree = build(snapshot, FirstRequestLevels, &count, maxNodes, &c, &error);
  if (!tree) return @{@"ok": @NO, @"refused": @"read-failed", @"error": error.localizedDescription ?: @"cut short", @"requests": @(c.requests)};
  // a change of owner during the read: its tree may be neither's
  if ([[(id<AX>)gAXElement primaryApp] pid] != pid) return refuse(@"owner-changed");
  return @{@"ok": @YES, @"bundle": bundle, @"pid": @(pid), @"tree": tree, @"requests": @(c.requests), @"screen": @[@(CGRectGetWidth(screen)), @(CGRectGetHeight(screen))]};
}

// The app's reports to an observer of the system-wide element (private, from the accessibility runtime).
static const uint32_t kUserTesting = 4002, kAskIdle = 0x7fa, kAskAnimations = 0x7fb;
static const NSTimeInterval kTouchReportS = 0.3;
static int32_t (*gPerform)(void *, uint32_t, const void *);
static long gTouchesEnded, gAnimationsOver;
static NSString *gBlind;

static void answer(NSDictionary *a, id ident, uint64_t t0) {
  NSMutableDictionary *m = [a mutableCopy];
  m[@"id"] = ident ?: @0;
  m[@"ms"] = @((clock_gettime_nsec_np(CLOCK_UPTIME_RAW) - t0) / 1000000);
  m[@"touchesEnded"] = @(gTouchesEnded);
  NSData *out = [NSJSONSerialization dataWithJSONObject:m options:0 error:NULL];
  fwrite(out.bytes, 1, out.length, stdout);
  fputc('\n', stdout);
  fflush(stdout);
}

static void observed(void *observer, void *element, uint32_t notification, const void *info, void *refcon) {
  id report = (__bridge id)info;
  id event = notification == kUserTesting && [report isKindOfClass:NSDictionary.class] ? report[@"event"] : nil;
  if ([event isEqual:@"TouchEventsCompleted"]) gTouchesEnded++;
  if ([event isEqual:@"AnimationsNonActive"]) gAnimationsOver++;
}

static NSString *observe(void) {
  int32_t (*create)(int32_t, void (*)(void *, void *, uint32_t, const void *, void *), void **) = dlsym(RTLD_DEFAULT, "AXObserverCreate");
  int32_t (*add)(void *, void *, uint32_t, void *) = dlsym(RTLD_DEFAULT, "AXObserverAddNotification");
  CFRunLoopSourceRef (*source)(void *) = dlsym(RTLD_DEFAULT, "AXObserverGetRunLoopSource");
  void *(*systemWide)(void) = dlsym(RTLD_DEFAULT, "AXUIElementCreateSystemWide");
  gPerform = dlsym(RTLD_DEFAULT, "AXUIElementPerformActionWithValue");
  if (!create || !add || !source || !systemWide || !gPerform) return @"the observer calls are missing";
  void *observer = NULL;
  void *element = systemWide();
  if (!element || create(0, observed, &observer) != 0 || !observer || add(observer, element, kUserTesting, NULL) != 0) return @"the observer did not start";
  CFRunLoopAddSource(CFRunLoopGetMain(), source(observer), kCFRunLoopDefaultMode);
  return nil;
}

static NSDictionary *ask(uint32_t action) {
  pid_t pid = [[(id<AX>)gAXElement primaryApp] pid];
  __attribute__((objc_precise_lifetime)) id<AX> root = [(id<AX>)gElementClass elementWithProcessIdentifier:pid];
  void *raw = [root AXUIElement];
  return raw && gPerform(raw, action, NULL) == 0 ? @{@"ok": @YES} : refuse(@"no-report");
}

// The app in front reports to the observer from now on (its touches finishing, among others).
static NSDictionary *arm(void) { return ask(kAskIdle); }

// Turns the run loop, which is what brings the app's reports, until `done` or `seconds` have gone.
static void turnUntil(BOOL (^done)(void), NSTimeInterval seconds) {
  uint64_t end = clock_gettime_nsec_np(CLOCK_UPTIME_RAW) + (uint64_t)(seconds * NSEC_PER_SEC);
  while (!done() && clock_gettime_nsec_np(CLOCK_UPTIME_RAW) < end) CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.005, true);
}

// UIKit takes no touches while a view animates: until the app in front reports no animation running, the
// report XCTest waits for before an event. An animation a touch starts has not begun until the app has handled
// that touch, and the report would say all is still: `touches` is how many touch reports must be in first
// (another process may draw what was touched and report nothing, hence the short limit).
static NSDictionary *animationsOver(NSTimeInterval within, long touches) {
  turnUntil(^{ return (BOOL)(gTouchesEnded >= touches); }, kTouchReportS);
  long seen = gAnimationsOver;
  NSDictionary *asked = ask(kAskAnimations);
  if (![asked[@"ok"] boolValue]) return asked;
  turnUntil(^{ return (BOOL)(gAnimationsOver != seen); }, within);
  return @{@"ok": @YES, @"over": @(gAnimationsOver != seen)};
}

// What the host says of this simulator before any test runner is there.
static NSDictionary *hello(void) {
  // just after a boot the home screen is not up and has no frame yet; the simulator's own size is portrait
  CGRect frame = [[(id<AX>)gAXElement systemApplication] frame];
  NSDictionary<NSString *, NSString *> *env = NSProcessInfo.processInfo.environment;
  double scale = [env[@"SIMULATOR_MAINSCREEN_SCALE"] doubleValue];
  double w = CGRectGetWidth(frame) > 0 ? CGRectGetWidth(frame) : [env[@"SIMULATOR_MAINSCREEN_WIDTH"] doubleValue] / scale;
  double h = CGRectGetHeight(frame) > 0 ? CGRectGetHeight(frame) : [env[@"SIMULATOR_MAINSCREEN_HEIGHT"] doubleValue] / scale;
  NSOperatingSystemVersion v = NSProcessInfo.processInfo.operatingSystemVersion;
  NSString *os = v.patchVersion ? [NSString stringWithFormat:@"%ld.%ld.%ld", (long)v.majorVersion, (long)v.minorVersion, (long)v.patchVersion]
                                : [NSString stringWithFormat:@"%ld.%ld", (long)v.majorVersion, (long)v.minorVersion];
  return @{@"ok": @YES, @"osVersion": os, @"model": env[@"SIMULATOR_MODEL_IDENTIFIER"] ?: @"iPhone", @"scale": @(scale), @"screen": @[@(w), @(h)]};
}

static void handle(NSData *line) {
  @autoreleasepool {
    NSDictionary *q = [NSJSONSerialization JSONObjectWithData:line options:0 error:NULL];
    uint64_t t0 = clock_gettime_nsec_np(CLOCK_UPTIME_RAW);
    NSDictionary *a;
    @try {
      if (![q[@"op"] isEqual:@"leave"]) {
        accessibilityOn();
        // just after a boot the accessibility server comes up a moment after the switches go on
        if (gBlind) gBlind = observe();
      }
      if ([q[@"op"] isEqual:@"read"]) a = readApp(q);
      else if ([q[@"op"] isEqual:@"arm"]) a = gBlind ? refuse(gBlind) : arm();
      else if ([q[@"op"] isEqual:@"animations"]) a = gBlind ? refuse(gBlind) : animationsOver([q[@"within"] doubleValue], [q[@"touches"] longValue]);
      else if ([q[@"op"] isEqual:@"leave"]) {
        if (gTurnedOn) { gSetAppAX(0); gSetAutomation(0); }
        gTurnedOn = NO;
        answer(@{@"ok": @YES}, q[@"id"], t0);
        exit(0);
      } else if ([q[@"op"] isEqual:@"touched"]) {
        long touches = [q[@"touches"] longValue];
        turnUntil(^{ return (BOOL)(gTouchesEnded >= touches); }, [q[@"within"] doubleValue] ?: kTouchReportS);
        a = @{@"ok": @YES};
      } else if ([q[@"op"] isEqual:@"hello"]) a = hello();
      else if ([q[@"op"] isEqual:@"front"]) {
        NSString *front = [(id<AX>)[(id<AX>)gAXElement primaryApp] bundleId];
        a = front ? @{@"ok": @YES, @"bundle": front} : refuse(@"no-foreground");
      } else if ([q[@"op"] isEqual:@"ping"]) a = gBlind ? @{@"ok": @YES, @"blind": gBlind} : @{@"ok": @YES};
      else a = refuse(@"unknown request");
    } @catch (NSException *e) {
      a = @{@"ok": @NO, @"refused": @"exception", @"error": e.reason ?: @""};
    }
    answer(a, q[@"id"], t0);
  }
}

int main(void) {
  @autoreleasepool {
    NSString *problem = setup();
    if (!problem) accessibilityOn();
    gBlind = problem ?: observe();
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INTERACTIVE, 0), ^{
      char *line = NULL;
      size_t capacity = 0;
      ssize_t n;
      while ((n = getline(&line, &capacity, stdin)) > 0) {
        NSData *data = [NSData dataWithBytes:line length:(NSUInteger)n];
        dispatch_async(dispatch_get_main_queue(), ^{
          if (problem) answer(refuse(problem), [NSJSONSerialization JSONObjectWithData:data options:0 error:NULL][@"id"], 0);
          else handle(data);
        });
      }
      exit(0);
    });
    CFRunLoopRun();
  }
  return 0;
}
