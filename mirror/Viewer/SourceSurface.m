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
  id _chosen;
  id _surface;
  dispatch_source_t _watch;
  BOOL _stopped, _hidden, _stale;
}

- (instancetype)initWithOptions:(NSDictionary *)options sink:(id<MVSink>)sink {
  if ((self = [super init])) {
    _options = options;
    _sink = sink;
    _uuid = NSUUID.UUID;
    _screens = [NSMutableArray array];
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
    [descriptor enumerateScreensWithCompletionQueue:dispatch_get_main_queue() completionHandler:^(NSArray *screens, NSError *e) {
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

/// A device may report several screens and not all draw: the first to hand over a surface is the one.
- (void)registerScreens:(NSArray *)screens {
  if (_stopped) return;
  __weak MVSourceSurface *weak = self;
  for (id<MVSimulator> screen in screens) {
    if (![(id)screen respondsToSelector:@selector(registerScreenCallbacksWithUUID:callbackQueue:frameCallback:surfacesChangedCallback:propertiesChangedCallback:)]) continue;
    [_screens addObject:screen];
    __weak id weakScreen = screen;
    [screen registerScreenCallbacksWithUUID:_uuid callbackQueue:dispatch_get_main_queue()
        frameCallback:^{
          [weak presented:weakScreen];
        }
        surfacesChangedCallback:^(id surface, id masked) {
          [weak screen:weakScreen surface:surface];
        }
        propertiesChangedCallback:^(id properties){
        }];
  }
}

- (void)screen:(id)screen surface:(id)surface {
  if (_stopped || !surface) return;
  if (!_chosen) {
    _chosen = screen;
    for (id<MVSimulator> other in _screens)
      if (other != screen) [other unregisterScreenCallbacksWithUUID:_uuid];
    [_screens removeAllObjects];
    [_screens addObject:screen];
  }
  if (screen != _chosen) return;
  // a rotation or a fold: a new surface, with no reconnect
  _surface = surface;
  IOSurfaceRef s = (__bridge IOSurfaceRef)surface;
  id<MVSink> sink = _sink;
  [sink source:self size:CGSizeMake(IOSurfaceGetWidth(s), IOSurfaceGetHeight(s)) codec:@"surface"];
  [self show];
}

- (void)presented:(id)screen {
  if (_stopped || screen != _chosen) return;
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
