// The window: the picture at the device's proportions, and what the session says over it. No frame around
// the phone and no assets: a picture and a banner.
#import "Viewer.h"
#import "Window.h"

// what replaces the layer's own enqueue and flush needs macOS 14, and these still work
#pragma clang diagnostic ignored "-Wdeprecated-declarations"

// a new window takes at most this much of the screen
static const double kFitScreen = 0.85;

static NSTextField *label(CGFloat size, NSFontWeight weight) {
  NSTextField *field = [NSTextField wrappingLabelWithString:@""];
  field.font = [NSFont systemFontOfSize:size weight:weight];
  field.textColor = NSColor.whiteColor;
  field.alignment = NSTextAlignmentCenter;
  field.drawsBackground = NO;
  return field;
}

MVShow MVShowOf(BOOL focus, BOOL behind) {
  if (behind) return MVShowBehind;
  return focus ? MVShowFocused : MVShowFront;
}

void MVLayoutTurned(CALayer *layer, CGSize parent, int turns) {
  BOOL sideways = turns % 2;
  layer.bounds = CGRectMake(0, 0, sideways ? parent.height : parent.width, sideways ? parent.width : parent.height);
  layer.position = CGPointMake(parent.width / 2, parent.height / 2);
  layer.transform = CATransform3DMakeRotation(turns * M_PI_2, 0, 0, 1);
}

@implementation MVWindow {
  NSWindow *_window;
  MVView *_view;
  CALayer *_plain;
  AVSampleBufferDisplayLayer *_video;
  CALayer *_dim;
  NSTextField *_title, *_fix;
  CGSize _picture;
  double _zoom;
  int _turns;
  NSString *_name;
}

- (instancetype)init {
  if ((self = [super init])) {
    NSRect frame = NSMakeRect(80, 80, 320, 640);
    _window = [[NSWindow alloc] initWithContentRect:frame styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskClosable | NSWindowStyleMaskMiniaturizable | NSWindowStyleMaskResizable backing:NSBackingStoreBuffered defer:NO];
    _window.releasedWhenClosed = NO;
    _window.delegate = self;
    _window.backgroundColor = NSColor.blackColor;
    _view = [[MVView alloc] initWithFrame:NSMakeRect(0, 0, frame.size.width, frame.size.height)];
    _view.wantsLayer = YES;
    _view.layer.backgroundColor = NSColor.blackColor.CGColor;
    _window.contentView = _view;
    _plain = [self fill:[CALayer layer]];
    // laid out by hand: a layer turned on its side has no place in its parent's resizing
    _plain.autoresizingMask = kCALayerNotSizable;
    _plain.contentsGravity = kCAGravityResizeAspect;
    _video = (AVSampleBufferDisplayLayer *)[self fill:[AVSampleBufferDisplayLayer layer]];
    _video.videoGravity = AVLayerVideoGravityResizeAspect;
    _dim = [self fill:[CALayer layer]];
    _dim.backgroundColor = [NSColor colorWithWhite:0 alpha:0.6].CGColor;
    _dim.hidden = YES;
    _title = label(15, NSFontWeightSemibold);
    _fix = label(12, NSFontWeightRegular);
    NSStackView *words = [NSStackView stackViewWithViews:@[_title, _fix]];
    words.orientation = NSUserInterfaceLayoutOrientationVertical;
    words.translatesAutoresizingMaskIntoConstraints = NO;
    [_view addSubview:words];
    _overlay = [[MVOverlay alloc] initInView:_view];
    [NSLayoutConstraint activateConstraints:@[
      [words.centerYAnchor constraintEqualToAnchor:_view.centerYAnchor],
      [words.leadingAnchor constraintEqualToAnchor:_view.leadingAnchor constant:16],
      [words.trailingAnchor constraintEqualToAnchor:_view.trailingAnchor constant:-16],
    ]];
  }
  return self;
}

- (CALayer *)fill:(CALayer *)layer {
  layer.frame = _view.bounds;
  layer.autoresizingMask = kCALayerWidthSizable | kCALayerHeightSizable;
  [_view.layer addSublayer:layer];
  return layer;
}

- (void)configure:(NSDictionary *)attach {
  _name = attach[@"title"] ?: @"appdyno";
  _window.title = _name;
  _view.inputOn = ![attach[@"input"] isEqual:@NO];
  // a click once given stands: a reconnect does not take it back
  if (![attach[@"input"] isEqual:@"click"]) _view.armed = YES;
  // a restarted viewer keeps the zoom it had; a phone's picture size comes with its first frame
  if ([attach[@"zoom"] doubleValue] > 0) _zoom = [attach[@"zoom"] doubleValue];
  [_window makeFirstResponder:_view];
  [self show:MVShowOf([attach[@"focus"] boolValue], self.behind)];
}

- (void)setPicture:(CGSize)size {
  if (size.width <= 0 || size.height <= 0 || CGSizeEqualToSize(size, _picture)) return;
  _picture = size;
  _view.picture = size;
  _window.contentAspectRatio = NSMakeSize(size.width, size.height);
  if (_zoom <= 0) {
    NSRect visible = (_window.screen ?: NSScreen.mainScreen).visibleFrame;
    double scale = _window.backingScaleFactor ?: 1;
    _zoom = MIN(1 / scale, MIN(visible.size.width * kFitScreen / size.width, visible.size.height * kFitScreen / size.height));
  }
  [_window setContentSize:NSMakeSize(size.width * _zoom, size.height * _zoom)];
  [self layoutPicture];
}

- (void)setTurns:(int)turns {
  _turns = turns;
  [self layoutPicture];
}

- (void)layoutPicture {
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  MVLayoutTurned(_plain, _view.bounds.size, _turns);
  [CATransaction commit];
}

- (void)windowDidResize:(NSNotification *)notification {
  [self layoutPicture];
}

- (void)windowDidEndLiveResize:(NSNotification *)notification {
  if (_picture.width <= 0) return;
  _zoom = _view.bounds.size.width / _picture.width;
  MVEmit(@{@"op": @"zoom", @"scale": @(_zoom)});
}

- (void)showSurface:(IOSurfaceRef)surface {
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  // the same surface again shows nothing new unless the layer is told it changed
  _plain.contents = nil;
  _plain.contents = (__bridge id)surface;
  [CATransaction commit];
}

- (BOOL)showImage:(CVImageBufferRef)image {
  CMVideoFormatDescriptionRef format = NULL;
  if (CMVideoFormatDescriptionCreateForImageBuffer(NULL, image, &format) != noErr) return NO;
  CMSampleTimingInfo timing = {.duration = kCMTimeInvalid, .presentationTimeStamp = CMClockGetTime(CMClockGetHostTimeClock()), .decodeTimeStamp = kCMTimeInvalid};
  CMSampleBufferRef sample = NULL;
  OSStatus status = CMSampleBufferCreateReadyWithImageBuffer(NULL, image, format, &timing, &sample);
  CFRelease(format);
  if (status != noErr) return NO;
  CFMutableDictionaryRef attachments = (CFMutableDictionaryRef)CFArrayGetValueAtIndex(CMSampleBufferGetSampleAttachmentsArray(sample, YES), 0);
  CFDictionarySetValue(attachments, kCMSampleAttachmentKey_DisplayImmediately, kCFBooleanTrue);
  BOOL failed = _video.status == AVQueuedSampleBufferRenderingStatusFailed;
  if (failed) [_video flush];
  [_video enqueueSampleBuffer:sample];
  CFRelease(sample);
  return !failed;
}

- (void)setStatus:(NSDictionary *)message {
  BOOL live = [message[@"state"] isEqual:@"live"];
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  _dim.hidden = live;
  [CATransaction commit];
  _title.stringValue = live ? @"" : message[@"title"] ?: @"";
  _fix.stringValue = live ? @"" : message[@"fix"] ?: @"";
  _window.title = live ? _name : [NSString stringWithFormat:@"%@: %@", _name, message[@"title"] ?: message[@"state"]];
}

- (void)show:(MVShow)how {
  switch (how) {
    case MVShowBehind:
      [_window orderBack:nil];
      break;
    case MVShowFront:
      [_window orderFrontRegardless];
      break;
    case MVShowFocused:
      NSApp.activationPolicy = NSApplicationActivationPolicyRegular;
      [_window makeKeyAndOrderFront:nil];
      [NSApp activateIgnoringOtherApps:YES];
      break;
  }
}

- (void)raise {
  [self show:MVShowOf(NO, self.behind)];
}

- (void)pokeX:(double)x y:(double)y {
  NSPoint inView = NSMakePoint(x * _view.bounds.size.width, (1 - y) * _view.bounds.size.height);
  NSPoint at = [_view convertPoint:inView toView:nil];
  for (NSNumber *type in @[@(NSEventTypeLeftMouseDown), @(NSEventTypeLeftMouseUp)]) {
    NSEvent *e = [NSEvent mouseEventWithType:type.unsignedIntegerValue location:at modifierFlags:0 timestamp:0 windowNumber:_window.windowNumber context:nil eventNumber:0 clickCount:1 pressure:1];
    [NSApp postEvent:e atStart:NO];
  }
}

- (void)pokeKey:(NSString *)characters {
  NSEvent *e = [NSEvent keyEventWithType:NSEventTypeKeyDown location:NSZeroPoint modifierFlags:0 timestamp:0 windowNumber:_window.windowNumber context:nil characters:characters charactersIgnoringModifiers:characters isARepeat:NO keyCode:0];
  // to the window itself: this app need not be the active one for an acceptance run
  [_window sendEvent:e];
}

- (void)windowDidChangeOcclusionState:(NSNotification *)notification {
  if (self.onHidden) self.onHidden(!(_window.occlusionState & NSWindowOcclusionStateVisible));
}

- (void)windowWillClose:(NSNotification *)notification {
  MVEmit(@{@"op": @"closed"});
  exit(0);
}

@end
