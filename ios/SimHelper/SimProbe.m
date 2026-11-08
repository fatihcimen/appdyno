// The frame probe: injected into a simulator app when it is launched (no change to the app). A display
// link on the main run loop records every frame interval; a timer on another queue writes them to the
// file named by APPDYNO_PROBE_OUT as JSON lines, so a stalled main thread does not hold the file back
// and a stall still running shows. A start's phases go there too: process start, this library's first code, UIKit's
// application object made, did finish launching, first frame.
#import <Foundation/Foundation.h>
#import <QuartzCore/QuartzCore.h>
#import <UIKit/UIKit.h>
#import <objc/runtime.h>
#import <stdatomic.h>
#import <stdio.h>
#import <stdlib.h>
#import <sys/sysctl.h>
#import <sys/time.h>
#import <unistd.h>

typedef struct {
  double t, dt, vsync;
} Frame;

/** A minute at 120 Hz, far more than one flush ever has to catch up. */
enum { CAPACITY = 8192 };
static const double OPEN_STALL_MS = 100;

static Frame frames[CAPACITY];
static _Atomic uint64_t written;
static _Atomic double lastTick, lastInput, launchMs, uikitAt, finishedAt;
static FILE *out;
static double processStart, firstCode;
static CADisplayLink *displayLink;
/** What flushes, held for as long as the app runs. */
static dispatch_source_t flushTimer;

static double nowMs(void) {
  struct timeval tv;
  gettimeofday(&tv, NULL);
  return tv.tv_sec * 1000.0 + tv.tv_usec / 1000.0;
}

@interface AppdynoProbe : NSObject
@end
@implementation AppdynoProbe {
  CFTimeInterval last;
}
- (void)tick:(CADisplayLink *)l {
  double now = nowMs();
  if (processStart > 0 && atomic_load(&launchMs) == 0) atomic_store(&launchMs, now - processStart);
  if (last > 0) {
    uint64_t n = atomic_load_explicit(&written, memory_order_relaxed);
    // the display link's own clock: a callback running late on a busy Mac is not a missed frame
    frames[n % CAPACITY] =
        (Frame){now, (l.timestamp - last) * 1000, (l.targetTimestamp - l.timestamp) * 1000};
    atomic_store_explicit(&written, n + 1, memory_order_release);
  }
  last = l.timestamp;
  atomic_store(&lastTick, now);
}
- (void)pause {
  // no ticks in the background: the time away is no interval and no stall
  displayLink.paused = YES;
  last = 0;
  atomic_store(&lastTick, 0);
}
- (void)resume {
  displayLink.paused = NO;
}
@end

static void (*sendEventOriginal)(id, SEL, UIEvent *);
static void sendEventTimed(id self, SEL cmd, UIEvent *event) {
  sendEventOriginal(self, cmd, event);
  if (event.type == UIEventTypeTouches) atomic_store(&lastInput, nowMs());
}

static id (*initOriginal)(id, SEL);
static id initTimed(id self, SEL cmd) {
  if (atomic_load(&uikitAt) == 0) atomic_store(&uikitAt, nowMs());
  return initOriginal(self, cmd);
}

/** Whichever of the phases has not come yet reads as nothing, not as less than nothing. */
static double since(double from, double to) { return to > from && from > 0 ? to - from : 0; }

static void flush(void) {
  static uint64_t flushed;
  static double seenInput, seenLaunch;
  uint64_t n = atomic_load_explicit(&written, memory_order_acquire);
  if (n - flushed > CAPACITY) flushed = n - CAPACITY;
  for (; flushed < n; flushed++) {
    Frame f = frames[flushed % CAPACITY];
    fprintf(out, "{\"t\":%.1f,\"dt\":%.1f,\"v\":%.1f}\n", f.t, f.dt, f.vsync);
  }
  double launch = atomic_load(&launchMs), input = atomic_load(&lastInput);
  if (launch != seenLaunch) {
    double uikit = atomic_load(&uikitAt), finished = atomic_load(&finishedAt);
    double frame = processStart + launch;
    fprintf(out,
            "{\"phases\":{\"load\":%.1f,\"main\":%.1f,\"uikit\":%.1f,\"first_frame\":%.1f}}\n",
            since(processStart, firstCode), since(firstCode, uikit), since(uikit, finished),
            since(finished, frame));
    fprintf(out, "{\"launchMs\":%.1f}\n", seenLaunch = launch);
  }
  if (input != seenInput) fprintf(out, "{\"input\":%.1f}\n", seenInput = input);
  double tick = atomic_load(&lastTick), now = nowMs();
  if (tick > 0 && now - tick > OPEN_STALL_MS)
    fprintf(out, "{\"open\":%.1f,\"ms\":%.1f}\n", now, now - tick);
  fflush(out);
}

__attribute__((constructor)) static void start(void) {
  const char *path = getenv("APPDYNO_PROBE_OUT");
  if (!path || !(out = fopen(path, "a"))) return;
  firstCode = nowMs();
  struct kinfo_proc proc;
  size_t size = sizeof proc;
  int mib[] = {CTL_KERN, KERN_PROC, KERN_PROC_PID, getpid()};
  if (sysctl(mib, 4, &proc, &size, NULL, 0) == 0)
    processStart = proc.kp_proc.p_starttime.tv_sec * 1000.0 + proc.kp_proc.p_starttime.tv_usec / 1000.0;
  fprintf(out, "{\"loaded\":\"%s\",\"pid\":%d,\"t\":%.1f}\n",
          NSBundle.mainBundle.bundleIdentifier.UTF8String ?: "?", getpid(), nowMs());
  fflush(out);

  Method send = class_getInstanceMethod(UIApplication.class, @selector(sendEvent:));
  sendEventOriginal = (void *)method_setImplementation(send, (IMP)sendEventTimed);
  // its own method, or one added to it: the one it inherits is every object's
  Method init = class_getInstanceMethod(UIApplication.class, @selector(init));
  initOriginal = (void *)method_getImplementation(init);
  if (!class_addMethod(UIApplication.class, @selector(init), (IMP)initTimed,
                       method_getTypeEncoding(init)))
    method_setImplementation(init, (IMP)initTimed);
  [NSNotificationCenter.defaultCenter addObserverForName:UIApplicationDidFinishLaunchingNotification
                                                  object:nil
                                                   queue:nil
                                              usingBlock:^(NSNotification *n) {
                                                atomic_store(&finishedAt, nowMs());
                                              }];

  dispatch_async(dispatch_get_main_queue(), ^{
    AppdynoProbe *probe = [AppdynoProbe new];
    displayLink = [CADisplayLink displayLinkWithTarget:probe selector:@selector(tick:)];
    [displayLink addToRunLoop:NSRunLoop.mainRunLoop forMode:NSRunLoopCommonModes];
    NSNotificationCenter *center = NSNotificationCenter.defaultCenter;
    [center addObserver:probe
               selector:@selector(pause)
                   name:UIApplicationDidEnterBackgroundNotification
                 object:nil];
    [center addObserver:probe
               selector:@selector(resume)
                   name:UIApplicationWillEnterForegroundNotification
                 object:nil];
  });

  dispatch_source_t timer = dispatch_source_create(
      DISPATCH_SOURCE_TYPE_TIMER, 0, 0, dispatch_get_global_queue(QOS_CLASS_UTILITY, 0));
  dispatch_source_set_timer(timer, DISPATCH_TIME_NOW, 250 * NSEC_PER_MSEC, 50 * NSEC_PER_MSEC);
  dispatch_source_set_event_handler(timer, ^{
    flush();
  });
  dispatch_resume(timer);
  flushTimer = timer;
}
