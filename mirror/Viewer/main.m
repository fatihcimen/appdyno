// The viewer's process: reads the parent's messages, runs one source at a time, says what happens. It ends
// with its stdin, so a parent that dies, however it dies, takes its viewer with it.
//   appdyno-viewer             a window
//   appdyno-viewer --headless  the same, with no window and nothing that could raise one
//   appdyno-viewer --selftest [fixtures dir]
//   appdyno-viewer --encode <h264|hevc> <frames>
#import "Viewer.h"
#import <CoreGraphics/CoreGraphics.h>

static NSLock *gOut;

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
  return @{@"surface": MVSourceSurface.class, @"adb": MVSourceStream.class, @"pixels": MVSourcePixels.class};
}

@interface MVApp : NSObject <MVSink, NSApplicationDelegate>
- (instancetype)initWithWindow:(BOOL)window;
- (void)receive:(NSDictionary *)message;
@end

@implementation MVApp {
  MVStats *_stats;
  MVWindow *_window;
  BOOL _headlessOnly;
  id<MVSource> _source;
  NSString *_lastSized;
  NSDictionary *_pendingStatus;
}

- (instancetype)initWithWindow:(BOOL)window {
  if ((self = [super init])) {
    _stats = [MVStats new];
    _headlessOnly = !window;
  }
  return self;
}

- (MVStats *)stats {
  return _stats;
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

- (void)toggleActivity:(id)sender {
  [_window.overlay toggleActivity];
}

- (void)startClock {
  dispatch_source_t timer = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, dispatch_get_global_queue(QOS_CLASS_UTILITY, 0));
  dispatch_source_set_timer(timer, dispatch_time(DISPATCH_TIME_NOW, NSEC_PER_SEC), NSEC_PER_SEC, NSEC_PER_SEC / 10);
  MVStats *stats = _stats;
  dispatch_source_set_event_handler(timer, ^{
    MVEmit(stats.report);
  });
  dispatch_resume(timer);
  // kept for the life of the process
  CFBridgingRetain(timer);
}

/// A `tick` comes up to 60 times a second and needs nothing of the main thread.
- (void)receive:(NSDictionary *)message {
  NSString *op = message[@"op"];
  if ([op isEqual:@"tick"]) {
    id<MVSource> source;
    @synchronized(self) {
      source = _source;
    }
    // the first may come on the heels of its `attach`, which is on its way through the main queue
    if (!source) dispatch_async(dispatch_get_main_queue(), ^{
      if ([(id)self->_source respondsToSelector:@selector(tick:)]) [self->_source tick:message];
    });
    else if ([(id)source respondsToSelector:@selector(tick:)]) [source tick:message];
    return;
  }
  dispatch_async(dispatch_get_main_queue(), ^{
    [self handle:op message:message];
  });
}

- (void)handle:(NSString *)op message:(NSDictionary *)m {
  if ([op isEqual:@"attach"]) return [self attach:m];
  if ([op isEqual:@"detach"]) return [self detach];
  if ([op isEqual:@"status"]) return [_window setStatus:m];
  if ([op isEqual:@"focus"]) return [_window focus];
  if ([op isEqual:@"turns"]) {
    if ([(id)_source respondsToSelector:@selector(setTurns:)]) [_source setTurns:[m[@"turns"] intValue] & 3];
    return;
  }
  if ([op isEqual:@"agent"]) return [_window.overlay setDriving:[m[@"driving"] boolValue] tool:m[@"tool"] ?: @""];
  if ([op isEqual:@"banner"]) return m[@"id"] ? [_window.overlay showBanner:m] : [_window.overlay hideBanner];
  if ([op isEqual:@"activity"]) return [_window.overlay addActivity:m[@"line"] ?: @""];
  if ([op isEqual:@"poke"]) {
    if (m[@"key"]) return [_window pokeKey:m[@"key"]];
    if ([m[@"done"] boolValue]) return [_window.overlay done:self];
    if ([m[@"panel"] boolValue]) return [_window.overlay toggleActivity];
    return [_window pokeX:[m[@"x"] doubleValue] y:[m[@"y"] doubleValue]];
  }
  if ([op isEqual:@"mark"]) return [_stats mark];
  if ([op isEqual:@"quit"]) {
    [self detach];
    MVEmit(@{@"op": @"closed"});
    exit(0);
  }
}

- (void)detach {
  id<MVSource> source;
  @synchronized(self) {
    source = _source;
    _source = nil;
  }
  [source stop];
  [_stats reset];
  _lastSized = nil;
}

- (void)attach:(NSDictionary *)m {
  [self detach];
  NSDictionary *options = m[@"source"];
  Class kind = [options isKindOfClass:NSDictionary.class] ? MVSourceClasses()[options[@"kind"]] : nil;
  if (!kind) {
    MVEmit(@{@"op": @"lost", @"why": @"unknown source", @"fatal": @YES});
    return;
  }
  if (!_headlessOnly && !_window) {
    _window = [MVWindow new];
    __weak MVApp *weak = self;
    _window.onHidden = ^(BOOL hidden) {
      [weak setHidden:hidden];
    };
  }
  [_window configure:m];
  _stats.source = options[@"kind"];
  _stats.mode = @"";
  id<MVSource> source = [[kind alloc] initWithOptions:options sink:self];
  @synchronized(self) {
    _source = source;
  }
  [source start];
}

- (void)setHidden:(BOOL)hidden {
  id<MVSource> source = _source;
  if ([(id)source respondsToSelector:@selector(setHidden:)]) [source setHidden:hidden];
}

- (BOOL)isCurrent:(id)from {
  @synchronized(self) {
    return from == _source;
  }
}

- (void)source:(id)from size:(CGSize)size codec:(NSString *)codec {
  dispatch_async(dispatch_get_main_queue(), ^{
    if (![self isCurrent:from]) return;
    NSString *sized = [NSString stringWithFormat:@"%.0fx%.0f %@", size.width, size.height, codec];
    if ([sized isEqual:self->_lastSized]) return;
    self->_lastSized = sized;
    self->_stats.size = size;
    [self->_window setPicture:size];
    MVEmit(@{@"op": @"first", @"w": @(size.width), @"h": @(size.height), @"codec": codec});
  });
}

- (void)source:(id)from surface:(IOSurfaceRef)surface {
  id held = (__bridge id)surface;
  dispatch_async(dispatch_get_main_queue(), ^{
    if (![self isCurrent:from]) return;
    [self->_window showSurface:(__bridge IOSurfaceRef)held];
    [self->_stats shown];
  });
}

- (void)source:(id)from image:(CVImageBufferRef)image {
  CVBufferRetain(image);
  dispatch_async(dispatch_get_main_queue(), ^{
    if ([self isCurrent:from]) {
      if (self->_window) self->_stats.layer = [self->_window showImage:image] ? @"ok" : @"failed";
      [self->_stats shown];
    }
    CVBufferRelease(image);
  });
}

- (void)source:(id)from turns:(int)turns {
  dispatch_async(dispatch_get_main_queue(), ^{
    if ([self isCurrent:from]) [self->_window setTurns:turns];
  });
}

- (void)source:(id)from needsKey:(int)failures {
  if ([self isCurrent:from]) MVEmit(@{@"op": @"needKey", @"consecutive": @(failures)});
}

- (void)source:(id)from lost:(NSString *)why fatal:(BOOL)fatal {
  dispatch_async(dispatch_get_main_queue(), ^{
    if (![self isCurrent:from]) return;
    [self detach];
    MVEmit(@{@"op": @"lost", @"why": why, @"fatal": @(fatal)});
  });
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
    application.activationPolicy = NSApplicationActivationPolicyRegular;
    NSMenu *bar = [NSMenu new];
    NSMenuItem *appItem = [bar addItemWithTitle:@"appdyno" action:NULL keyEquivalent:@""];
    NSMenu *appMenu = [NSMenu new];
    [appMenu addItemWithTitle:@"Close" action:@selector(performClose:) keyEquivalent:@"w"];
    [appMenu addItemWithTitle:@"Activity" action:@selector(toggleActivity:) keyEquivalent:@"a"].target = app;
    [appMenu addItemWithTitle:@"Quit" action:@selector(terminate:) keyEquivalent:@"q"];
    appItem.submenu = appMenu;
    application.mainMenu = bar;
    [application run];
  }
  return 0;
}
