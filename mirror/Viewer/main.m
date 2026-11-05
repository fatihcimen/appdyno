// The viewer's process: reads the parent's messages, keeps a stage for each device it shows, says what happens. It
// ends with its stdin, so a parent that dies, however it dies, takes its viewer with it.
//   appdyno-viewer             a window
//   appdyno-viewer --headless  the same, with no window and nothing that could raise one
//   appdyno-viewer --behind    a real window kept off every screen, for a test on a Mac a person is using
//   appdyno-viewer --behind --appearance light|dark   the same, drawn as in use, to be looked at by `snapshot`
//   appdyno-viewer --hub [--focus]   the window of `appdyno hub`, whose stages stand in its room
//   appdyno-viewer --selftest [fixtures dir]
//   appdyno-viewer --encode <h264|hevc> <frames>
#import "Viewer.h"
#import "Window.h"
#import <CoreGraphics/CoreGraphics.h>

static NSLock *gOut;

void MVEmitFrom(NSView *_Nullable view, NSDictionary *message) {
  for (NSView *above = view; above; above = above.superview) {
    if (![above isKindOfClass:MVRootView.class]) continue;
    NSString *stage = ((MVRootView *)above).stage;
    if (!stage) break;
    NSMutableDictionary *tagged = [message mutableCopy];
    tagged[@"stage"] = stage;
    return MVEmit(tagged);
  }
  MVEmit(message);
}

void MVEmit(NSDictionary *message) {
  NSData *line = [NSJSONSerialization dataWithJSONObject:message options:0 error:NULL];
  if (!line) return;
  [gOut lock];
  fwrite(line.bytes, 1, line.length, stdout);
  fputc('\n', stdout);
  fflush(stdout);
  [gOut unlock];
}

NSDictionary<NSString *, Class> *MVSourceClasses(void) {
  return @{@"surface": MVSourceSurface.class, @"adb": MVSourceStream.class, @"pipe": MVSourceStream.class, @"pixels": MVSourcePixels.class};
}

@interface MVApp : NSObject <NSApplicationDelegate>
- (void)setBehind:(BOOL)behind;
- (void)setPoses:(BOOL)poses;
- (void)openHub:(BOOL)focus;
- (instancetype)initWithWindow:(BOOL)window;
- (void)receive:(NSDictionary *)message;
@end

@implementation MVApp {
  NSMutableDictionary<NSString *, MVStage *> *_stages;
  MVHub *_hub;
  BOOL _behind, _poses;
}

- (instancetype)initWithWindow:(BOOL)window {
  if ((self = [super init])) {
    // a process with one device has it under no name
    _stages = [NSMutableDictionary dictionaryWithObject:[[MVStage alloc] initNamed:nil room:nil windowless:!window] forKey:@""];
  }
  return self;
}

- (void)applicationDidFinishLaunching:(NSNotification *)notification {
  NSNotificationCenter *center = NSWorkspace.sharedWorkspace.notificationCenter;
  [center addObserverForName:NSWorkspaceWillSleepNotification object:nil queue:nil usingBlock:^(NSNotification *n) {
    MVEmit(@{@"op": @"sleep"});
  }];
  [center addObserverForName:NSWorkspaceDidWakeNotification object:nil queue:nil usingBlock:^(NSNotification *n) {
    MVEmit(@{@"op": @"wake"});
  }];
}

- (void)applicationWillTerminate:(NSNotification *)notification {
  MVEmit(@{@"op": @"closed"});
}

/// A person's click brought it forward: only now has it a menu bar and a place in the Dock.
- (void)applicationDidBecomeActive:(NSNotification *)notification {
  if (!_behind) NSApp.activationPolicy = NSApplicationActivationPolicyRegular;
}

- (void)startClock {
  dispatch_source_t timer = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, dispatch_get_global_queue(QOS_CLASS_UTILITY, 0));
  dispatch_source_set_timer(timer, dispatch_time(DISPATCH_TIME_NOW, NSEC_PER_SEC), NSEC_PER_SEC, NSEC_PER_SEC / 10);
  __weak MVApp *weak = self;
  dispatch_source_set_event_handler(timer, ^{
    [weak reportStages];
  });
  dispatch_resume(timer);
  // kept for the life of the process
  CFBridgingRetain(timer);
}

- (void)reportStages {
  NSArray<MVStage *> *stages;
  @synchronized(self) {
    stages = _stages.allValues;
  }
  for (MVStage *stage in stages) {
    NSDictionary *report = stage.report;
    MVEmit(report);
    dispatch_async(dispatch_get_main_queue(), ^{
      [stage showReport:report];
    });
  }
}

/// A `tick` comes up to 60 times a second and needs nothing of the main thread.
- (void)receive:(NSDictionary *)message {
  NSString *op = message[@"op"];
  if ([op isEqual:@"tick"]) return [[self stageNamed:message[@"stage"]] tick:message];
  dispatch_async(dispatch_get_main_queue(), ^{
    [self handle:op message:message];
  });
}

- (nullable MVStage *)stageNamed:(nullable NSString *)name {
  @synchronized(self) {
    return _stages[name ?: @""];
  }
}

/// A device of the hub's stands in its room, and goes when it is told to; the process stays.
- (MVStage *)newStageNamed:(NSString *)name {
  MVStage *stage = [[MVStage alloc] initNamed:name room:_hub.room windowless:NO];
  stage.behind = _behind;
  stage.poses = _poses;
  __weak MVApp *weak = self;
  stage.onGone = ^{
    [weak forget:name];
  };
  @synchronized(self) {
    _stages[name] = stage;
  }
  return stage;
}

- (void)forget:(NSString *)name {
  @synchronized(self) {
    [_stages removeObjectForKey:name];
  }
}

- (void)handleHub:(NSString *)op message:(NSDictionary *)m {
  if ([op isEqual:@"hub"]) return [_hub show:m];
  if ([op isEqual:@"note"]) return [_hub sayNote:m[@"text"] ?: @""];
  if ([op isEqual:@"poke"]) return [_hub poke:m];
  if ([op isEqual:@"snapshot"]) {
    NSString *file = m[@"file"] ?: @"";
    return MVEmit(@{@"op": @"snapped", @"file": file, @"ok": @([_hub snapshot:file])});
  }
  if ([op isEqual:@"quit"]) {
    MVEmit(@{@"op": @"closed"});
    exit(0);
  }
}

- (void)handle:(NSString *)op message:(NSDictionary *)m {
  NSString *name = m[@"stage"];
  if (_hub && !name) return [self handleHub:op message:m];
  MVStage *stage = [self stageNamed:name];
  if (!stage && name && [op isEqual:@"attach"]) stage = [self newStageNamed:name];
  [stage handle:op message:m];
}

- (void)setBehind:(BOOL)behind {
  _behind = behind;
  [self stageNamed:nil].behind = behind;
}

- (void)setPoses:(BOOL)poses {
  _poses = poses;
  [self stageNamed:nil].poses = poses;
}

- (void)openHub:(BOOL)focus {
  NSApp.mainMenu = MVHubMenu();
  _hub = [[MVHub alloc] initWithShow:MVShowOf(focus, _behind) poses:_poses];
  [self forget:@""];
}

@end

static void readParent(MVApp *app) {
  char *line = NULL;
  size_t capacity = 0;
  while (getline(&line, &capacity, stdin) > 0) {
    @autoreleasepool {
      NSData *data = [NSData dataWithBytesNoCopy:line length:strlen(line) freeWhenDone:NO];
      id message = [NSJSONSerialization JSONObjectWithData:data options:0 error:NULL];
      if ([message isKindOfClass:NSDictionary.class]) [app receive:message];
    }
  }
  // the parent is gone: the sockets close with the process, and the far end sees that
  exit(0);
}

int main(int argc, char **argv) {
  @autoreleasepool {
    gOut = [NSLock new];
    signal(SIGPIPE, SIG_IGN);
    NSArray<NSString *> *args = NSProcessInfo.processInfo.arguments;
    if ([args containsObject:@"--selftest"]) {
      NSUInteger at = [args indexOfObject:@"--selftest"];
      return MVSelfTest(args.count > at + 1 ? args[at + 1] : nil);
    }
    if ([args containsObject:@"--encode"] && argc == 4) return MVEncodeFixture(args[2], args[3].intValue);
    BOOL headless = [args containsObject:@"--headless"];
    MVApp *app = [[MVApp alloc] initWithWindow:!headless];
    app.behind = [args containsObject:@"--behind"];
    if (!headless) {
      // a window needs a window server: a session with none is refused by its need, with no crash
      CFDictionaryRef session = CGSessionCopyCurrentDictionary();
      if (!session) {
        MVEmit(@{@"op": @"refused", @"need": @"no-display"});
        return 4;
      }
      CFRelease(session);
    }
    MVEmit(@{@"op": @"ready"});
    [NSThread detachNewThreadWithBlock:^{
      readParent(app);
    }];
    [app startClock];
    if (headless) dispatch_main();
    NSApplication *application = NSApplication.sharedApplication;
    application.delegate = app;
    // not one a launch brings forward: the keyboard stays with what a person is using
    application.activationPolicy = NSApplicationActivationPolicyAccessory;
    NSUInteger look = [args indexOfObject:@"--appearance"];
    if (look != NSNotFound && args.count > look + 1) {
      application.appearance = [NSAppearance appearanceNamed:[args[look + 1] isEqual:@"dark"] ? NSAppearanceNameDarkAqua : NSAppearanceNameAqua];
      app.poses = YES;
    }
    if ([args containsObject:@"--hub"]) [app openHub:[args containsObject:@"--focus"]];
    [application run];
  }
  return 0;
}
