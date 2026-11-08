// A simulator's screen, with no encode: CoreSimulator hands over the IOSurface it draws into and calls back
// on each present, so the window shows the framebuffer itself. Private API, loaded at run time; selector
// names follow idb's public headers (see THIRD_PARTY_NOTICES). What fails says so, with no crash.
#import "Viewer.h"
#import <dlfcn.h>
#import <objc/runtime.h>

static const char *const kCoreSimulator = "/Library/Developer/PrivateFrameworks/CoreSimulator.framework/CoreSimulator";
// SimDeviceState: 3 is booted
enum { kBooted = 3 };

@protocol MVSimulator
+ (id)sharedServiceContextForDeveloperDir:(NSString *)dir error:(NSError **)error;
- (id)defaultDeviceSetWithError:(NSError **)error;
- (NSDictionary *)devicesByUDID;
- (unsigned long)state;
- (id)io;
- (NSArray *)ioPorts;
- (id)descriptor;
- (void)enumerateScreensWithCompletionQueue:(dispatch_queue_t)queue completionHandler:(void (^)(NSArray *, NSError *))handler;
- (void)registerScreenCallbacksWithUUID:(NSUUID *)uuid callbackQueue:(dispatch_queue_t)queue frameCallback:(void (^)(void))frame surfacesChangedCallback:(void (^)(id, id))surfaces propertiesChangedCallback:(void (^)(id))properties;
- (void)unregisterScreenCallbacksWithUUID:(NSUUID *)uuid;
@end

@implementation MVSourceSurface {
  NSDictionary *_options;
  __weak id<MVSink> _sink;
  id<MVSimulator> _device;
  NSUUID *_uuid;
  NSMutableArray *_screens;
  NSMapTable *_surfaces;
  id _chosen;
  id _surface;
  dispatch_source_t _watch;
  BOOL _stopped, _hidden, _stale;
  int _turns;
}

- (instancetype)initWithOptions:(NSDictionary *)options sink:(id<MVSink>)sink {
  if ((self = [super init])) {
    _options = options;
    _sink = sink;
    _uuid = NSUUID.UUID;
    _turns = [options[@"turns"] intValue] & 3;
    _screens = [NSMutableArray array];
    _surfaces = [NSMapTable strongToStrongObjectsMapTable];
  }
  return self;
}

- (void)lost:(NSString *)why {
  id<MVSink> sink = _sink;
  [sink source:self lost:why fatal:NO];
}

- (void)start {
  dispatch_async(dispatch_get_main_queue(), ^{
    [self attachOnMain];
  });
}

- (void)attachOnMain {
  if (_stopped) return;
  dlopen(kCoreSimulator, RTLD_NOW);
  Class contextClass = objc_getClass("SimServiceContext");
  if (!contextClass) return [self lost:@"CoreSimulator is missing"];
  NSError *error = nil;
  id<MVSimulator> context = [(id<MVSimulator>)contextClass sharedServiceContextForDeveloperDir:_options[@"developerDir"] error:&error];
  id<MVSimulator> set = [context defaultDeviceSetWithError:&error];
  NSUUID *udid = [[NSUUID alloc] initWithUUIDString:_options[@"udid"] ?: @""];
  _device = udid ? set.devicesByUDID[udid] : nil;
  if (!_device) return [self lost:@"simulator-off"];
  if (_device.state != kBooted) return [self lost:@"simulator-off"];
  [self watchState];
  __weak MVSourceSurface *weak = self;
  id<MVSimulator> io = _device.io;
  for (id<MVSimulator> port in io.ioPorts) {
    id<MVSimulator> descriptor = port.descriptor;
    if (![(id)descriptor respondsToSelector:@selector(enumerateScreensWithCompletionQueue:completionHandler:)]) continue;
    [descriptor enumerateScreensWithCompletionQueue:dispatch_get_main_queue()
                                  completionHandler:^(NSArray *screens, __unused NSError *e) {
                                    [weak registerScreens:screens];
                                  }];
  }
}

- (void)watchState {
  __weak MVSourceSurface *weak = self;
  _watch = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, dispatch_get_main_queue());
  dispatch_source_set_timer(_watch, dispatch_time(DISPATCH_TIME_NOW, NSEC_PER_SEC), NSEC_PER_SEC, NSEC_PER_SEC / 4);
  dispatch_source_set_event_handler(_watch, ^{
    [weak checkState];
  });
  dispatch_resume(_watch);
}

- (void)checkState {
  if (_stopped || _device.state == kBooted) return;
  dispatch_source_cancel(_watch);
  _watch = nil;
  [self lost:@"simulator-off"];
}

/// A device may report several screens and not all draw, and a Duo draws on one at a time: the one that draws is shown.
- (void)registerScreens:(NSArray *)screens {
  if (_stopped) return;
  __weak MVSourceSurface *weak = self;
  for (id<MVSimulator> screen in screens) {
    if (![(id)screen respondsToSelector:@selector(registerScreenCallbacksWithUUID:callbackQueue:frameCallback:surfacesChangedCallback:propertiesChangedCallback:)]) continue;
    [_screens addObject:screen];
    __weak id weakScreen = screen;
    [screen registerScreenCallbacksWithUUID:_uuid
        callbackQueue:dispatch_get_main_queue()
        frameCallback:^{
          [weak presented:weakScreen];
        }
        surfacesChangedCallback:^(id surface, __unused id masked) {
          [weak screen:weakScreen surface:surface];
        }
        propertiesChangedCallback:^(__unused id properties){}];
  }
}

- (void)screen:(id)screen surface:(id)surface {
  if (_stopped || !surface) return;
  [_surfaces setObject:surface forKey:screen];
  _chosen = _chosen ?: screen;
  if (screen != _chosen) return;
  // a fold: a new surface, with no reconnect
  _surface = surface;
  [self sayShape];
  [self show];
}

/** A guest that turns draws sideways in the same surface and no callback says so: its turns come from the parent. */
- (void)sayShape {
  IOSurfaceRef s = (__bridge IOSurfaceRef)_surface;
  size_t w = IOSurfaceGetWidth(s), h = IOSurfaceGetHeight(s);
  id<MVSink> sink = _sink;
  [sink source:self turns:_turns];
  [sink source:self size:CGSizeMake(w, h) codec:@"surface"];
}

- (void)setTurns:(int)turns {
  if (turns == _turns) return;
  _turns = turns;
  if (!_surface) return;
  [self sayShape];
  [self show];
}

- (void)presented:(id)screen {
  id surface = [_surfaces objectForKey:screen];
  if (_stopped || !surface) return;
  if (screen != _chosen) {
    _chosen = screen;
    _surface = surface;
    [self sayShape];
  }
  [self show];
}

- (void)show {
  id<MVSink> sink = _sink;
  [sink.stats arrived:0 captureMs:-1];
  if (_hidden) {
    _stale = YES;
    [sink.stats dropped:1];
    return;
  }
  [sink source:self surface:(__bridge IOSurfaceRef)_surface];
}

- (void)setHidden:(BOOL)hidden {
  dispatch_async(dispatch_get_main_queue(), ^{
    self->_hidden = hidden;
    if (!hidden && self->_stale && self->_surface) {
      self->_stale = NO;
      [self show];
    }
  });
}

// on the main queue, as every call of this source
- (void)stop {
  _stopped = YES;
  if (_watch) dispatch_source_cancel(_watch);
  _watch = nil;
  for (id<MVSimulator> screen in _screens) [screen unregisterScreenCallbacksWithUUID:_uuid];
  [_screens removeAllObjects];
  _surface = nil;
}

@end
