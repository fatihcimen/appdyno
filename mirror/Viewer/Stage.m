// One device's stream and what shows it, in a window of its own or a room of the hub's. A source feeds a stage, and a
// parent's messages about the device come here.
#import "Motion.h"
#import "Place.h"
#import "Viewer.h"
#import "Window.h"

@implementation MVStage {
  MVStats *_stats;
  MVWindow *_window;
  id<MVSource> _source;
  NSString *_name;
  NSView *_room;
  BOOL _windowless;
  NSString *_lastSized, *_codec;
  CGSize _sourceSize;
  int _turns;
  MVWatch *_watch;
}

- (instancetype)initNamed:(nullable NSString *)name room:(nullable NSView *)room windowless:(BOOL)windowless {
  if ((self = [super init])) {
    _stats = [MVStats new];
    _stats.stage = name;
    _name = [name copy];
    _room = room;
    _windowless = windowless;
  }
  return self;
}

- (MVStats *)stats {
  return _stats;
}

- (void)say:(NSDictionary *)message {
  if (!_name) return MVEmit(message);
  NSMutableDictionary *tagged = [message mutableCopy];
  tagged[@"stage"] = _name;
  MVEmit(tagged);
}

- (NSDictionary *)report {
  NSDictionary *report = _stats.report;
  if (!_name) return report;
  NSMutableDictionary *tagged = [report mutableCopy];
  tagged[@"stage"] = _name;
  return tagged;
}

- (void)showReport:(NSDictionary *)report {
  [_window showStats:report];
}

- (void)tick:(NSDictionary *)message {
  id<MVSource> source;
  @synchronized(self) {
    source = _source;
  }
  // the first may come on the heels of its `attach`, which is on its way through the main queue
  if (!source) dispatch_async(dispatch_get_main_queue(), ^{
    if ([(id)self->_source respondsToSelector:@selector(tick:)]) [self->_source tick:message];
  });
  else if ([(id)source respondsToSelector:@selector(tick:)]) [source tick:message];
}

- (void)poke:(NSDictionary *)m {
  if (m[@"clickOn"]) return [_window pokeClick:m[@"clickOn"]];
  if (m[@"menu"]) return [_window pokeMenu:m[@"menu"]];
  if (m[@"key"]) return [_window pokeKey:m[@"key"]];
  if (m[@"text"]) return [_window pokeText:m[@"text"]];
  if (m[@"button"]) return [_window pokeButton:m[@"button"]];
  if ([m[@"done"] boolValue]) return [_window.overlay done:self];
  if (m[@"pane"]) return [_window showPane:[m[@"pane"] integerValue]];
  if (m[@"journey"]) return [self say:@{@"op": @"control", @"name": @"journey", @"file": m[@"journey"]}];
  if (m[@"control"]) return [_window perform:m[@"control"]];
  if (m[@"click"]) return [_window chooseClick:m[@"click"]];
  double x = [m[@"x"] doubleValue], y = [m[@"y"] doubleValue];
  if ([m[@"hover"] boolValue]) return [_window pokeHoverX:x y:y];
  if (m[@"seconds"]) return [_window pokeX:x y:y toX:[(m[@"x2"] ?: m[@"x"]) doubleValue] toY:[(m[@"y2"] ?: m[@"y"]) doubleValue] seconds:[m[@"seconds"] doubleValue]];
  [_window pokeX:x y:y right:[m[@"right"] boolValue]];
}

- (void)record:(NSDictionary *)m {
  if ([(id)_source respondsToSelector:@selector(startRecording:)]) [(MVSourceStream *)_source startRecording:m[@"file"]];
  else [self say:@{@"op": @"recorded", @"why": @"this kind of picture is not recorded here", @"frames": @0}];
}

- (void)recordStop {
  NSDictionary *told = [(id)_source respondsToSelector:@selector(finishRecording)] ? [(MVSourceStream *)_source finishRecording] : nil;
  NSMutableDictionary *answer = [told ?: @{@"frames": @0, @"why": @"nothing was being recorded"} mutableCopy];
  answer[@"op"] = @"recorded";
  [self say:answer];
}

- (void)quit {
  [self detach];
  [self say:@{@"op": @"closed"}];
  if (!self.onGone) exit(0);
  [_window leave];
  self.onGone();
}

- (void)handle:(NSString *)op message:(NSDictionary *)m {
  if ([op isEqual:@"attach"]) return [self attach:m];
  if ([op isEqual:@"detach"]) return [self detach];
  if ([op isEqual:@"status"]) return [_window setStatus:m];
  if ([op isEqual:@"raise"]) return [_window raise];
  if ([op isEqual:@"turns"]) {
    if ([(id)_source respondsToSelector:@selector(setTurns:)]) [_source setTurns:[m[@"turns"] intValue] & 3];
    return;
  }
  if ([op isEqual:@"record"]) return [self record:m];
  if ([op isEqual:@"recordStop"]) return [self recordStop];
  if ([op isEqual:@"agent"]) return [_window setDriving:[m[@"driving"] boolValue] tool:m[@"tool"] ?: @"" client:m[@"client"]];
  if ([op isEqual:@"banner"]) return [_window askPerson:m];
  if ([op isEqual:@"activity"]) return [_window addActivity:m];
  if ([op isEqual:@"apps"]) return [_window showApps:m];
  if ([op isEqual:@"perf"]) return [_window showPerf:m];
  if ([op isEqual:@"flow"]) return [_window showFlow:m];
  if ([op isEqual:@"element"]) return [_window showElement:m];
  if ([op isEqual:@"measuring"] || [op isEqual:@"measured"]) return [_window showMeasure:m];
  if ([op isEqual:@"results"]) return [_window.inspector.perf showHistory:m];
  if ([op isEqual:@"note"]) return [_window sayNote:m[@"text"] ?: @""];
  if ([op isEqual:@"recording"]) return [_window setRecording:[m[@"on"] boolValue]];
  if ([op isEqual:@"pair"]) return [_window setPair:m];
  if ([op isEqual:@"touchAt"]) return [_window.overlay showTouchAtX:[m[@"x"] doubleValue] y:[m[@"y"] doubleValue] agent:[m[@"agent"] boolValue]];
  if ([op isEqual:@"copied"]) return MVCopyImage(m[@"file"]);
  if ([op isEqual:@"copyText"]) return MVCopyText(m[@"text"] ?: @"", MVPlaceBoard());
  if ([op isEqual:@"poke"]) return [self poke:m];
  if ([op isEqual:@"snapshot"]) {
    NSString *file = m[@"file"] ?: @"";
    BOOL ok = [m[@"screen"] boolValue] ? [_window snapshotScreen:file] : [_window snapshot:file];
    return [self say:@{@"op": @"snapped", @"file": file, @"ok": @(ok)}];
  }
  if ([op isEqual:@"mark"]) return [_stats mark:[m[@"bigger"] boolValue]];
  if ([op isEqual:@"watch"]) return [self watch:m];
  if ([op isEqual:@"quit"]) return [self quit];
}

/// One at a time: it reads the frames a window shows, on the way to it, and leaves them as they are.
- (void)watch:(NSDictionary *)m {
  if (_watch) return [self say:@{@"op": @"watched", @"id": m[@"id"] ?: @"", @"why": @"another watch is running on this stream"}];
  MVWatch *watch = [[MVWatch alloc] initWithId:m[@"id"] ?: @"" ms:[m[@"ms"] doubleValue] strip:[m[@"strip"] boolValue]];
  _watch = watch;
  // a still screen sends nothing, and its time runs out all the same
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(watch.ms * NSEC_PER_MSEC)), dispatch_get_main_queue(), ^{
    if (!watch.started) [self endWatch:watch];
  });
}

- (void)endWatch:(MVWatch *)watch {
  if (_watch != watch) return;
  _watch = nil;
  [self say:watch.finish];
}

- (void)watchImage:(CVImageBufferRef)image {
  MVWatch *watch = _watch;
  BOOL started = watch.started;
  [watch addImage:image turns:_turns];
  if (!watch.started || started) return;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(watch.ms * NSEC_PER_MSEC)), dispatch_get_main_queue(), ^{
    [self endWatch:watch];
  });
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
  _codec = nil;
  _turns = 0;
}

- (void)attach:(NSDictionary *)m {
  [self detach];
  NSDictionary *options = m[@"source"];
  Class kind = [options isKindOfClass:NSDictionary.class] ? MVSourceClasses()[options[@"kind"]] : nil;
  if (!kind) return [self say:@{@"op": @"lost", @"why": @"unknown source", @"fatal": @YES}];
  if (!_windowless && !_window) {
    _window = [[MVWindow alloc] initInRoom:_room];
    _window.behind = self.behind;
    _window.poses = self.poses;
    __weak MVStage *weak = self;
    // a window kept behind the rest is covered by design: it still shows what it gets
    if (!self.behind) {
      _window.onHidden = ^(BOOL hidden) {
        [weak setHidden:hidden];
      };
    }
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
    self->_sourceSize = size;
    self->_codec = codec;
    [self sayShape];
  });
}

/// What is told of the picture is its shape stood up, whatever kind of source turned it.
- (void)sayShape {
  CGSize size = _turns % 2 ? CGSizeMake(_sourceSize.height, _sourceSize.width) : _sourceSize;
  NSString *sized = [NSString stringWithFormat:@"%.0fx%.0f %@", size.width, size.height, _codec];
  if (!_codec || [sized isEqual:_lastSized]) return;
  _lastSized = sized;
  _stats.size = size;
  [_window setTurns:_turns];
  [_window setPicture:size];
  [self say:@{@"op": @"first", @"w": @(size.width), @"h": @(size.height), @"codec": _codec}];
}

- (void)source:(id)from surface:(IOSurfaceRef)surface {
  id held = (__bridge id)surface;
  dispatch_async(dispatch_get_main_queue(), ^{
    if (![self isCurrent:from]) return;
    [self->_window showSurface:(__bridge IOSurfaceRef)held];
    [self->_stats shown];
    CVPixelBufferRef image = NULL;
    if (self->_watch && CVPixelBufferCreateWithIOSurface(NULL, (__bridge IOSurfaceRef)held, NULL, &image) == kCVReturnSuccess) {
      [self watchImage:image];
      CVBufferRelease(image);
    }
  });
}

- (void)source:(id)from image:(CVImageBufferRef)image {
  CVBufferRetain(image);
  dispatch_async(dispatch_get_main_queue(), ^{
    if ([self isCurrent:from]) {
      if (self->_window) self->_stats.layer = [self->_window showImage:image] ? @"ok" : @"failed";
      [self->_stats shown];
      if (self->_watch) [self watchImage:image];
    }
    CVBufferRelease(image);
  });
}

- (void)source:(id)from turns:(int)turns {
  dispatch_async(dispatch_get_main_queue(), ^{
    if (![self isCurrent:from]) return;
    self->_turns = turns;
    [self sayShape];
  });
}

- (void)source:(id)from needsKey:(int)failures {
  if ([self isCurrent:from]) [self say:@{@"op": @"needKey", @"consecutive": @(failures)}];
}

- (void)source:(id)from lost:(NSString *)why fatal:(BOOL)fatal {
  dispatch_async(dispatch_get_main_queue(), ^{
    if (![self isCurrent:from]) return;
    [self detach];
    [self say:@{@"op": @"lost", @"why": why, @"fatal": @(fatal)}];
  });
}

@end
