// The window: a stage in the system's own material, the device on it, a line beneath saying how it is, and the
// Inspector beside it. The picture's view is exactly the device's screen, so its maths never hear of a frame.
#import "Viewer.h"
#import "Window.h"

// what replaces the layer's own enqueue and flush needs macOS 14, and these still work
#pragma clang diagnostic ignored "-Wdeprecated-declarations"

// a new window takes at most this much of the screen
static const double kFitScreen = 0.85;
// far from every screen a Mac can have
static const double kOffscreenAt = -30000;
static const double kMargin = 30, kLine = 26, kInspector = 300;
static const double kClickSeconds = 0.08;
static const CGSize kSmallest = {380, 420};
// wide enough that a toolbar shows all it has; a person can go narrower, and it folds into its own menu
static const double kOpensWide = 600;
static NSString *const kFrameDefault = @"showsDeviceFrame";

@implementation MVOffscreenWindow
- (NSRect)constrainFrameRect:(NSRect)rect toScreen:(NSScreen *)screen {
  return self.offscreen ? rect : [super constrainFrameRect:rect toScreen:screen];
}
- (BOOL)isKeyWindow {
  return self.poses || super.isKeyWindow;
}
- (BOOL)isMainWindow {
  return self.poses || super.isMainWindow;
}
@end

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
  MVOffscreenWindow *_window;
  NSView *_stage;
  MVFrameView *_frame;
  MVView *_view;
  MVInspector *_inspector;
  MVToolbar *_toolbarItems;
  MVStatusLine *_line;
  CALayer *_plain;
  AVSampleBufferDisplayLayer *_video;
  CALayer *_dim;
  CALayer *_cutout;
  CGSize _picture;
  double _zoom;
  int _turns;
  NSString *_name, *_kind;
  NSDictionary *_look;
  BOOL _inspecting;
}

- (instancetype)init {
  if ((self = [super init])) {
    NSRect frame = NSMakeRect(80, 80, 440, 760);
    NSWindowStyleMask style = NSWindowStyleMaskTitled | NSWindowStyleMaskClosable | NSWindowStyleMaskMiniaturizable | NSWindowStyleMaskResizable | NSWindowStyleMaskFullSizeContentView;
    _window = [[MVOffscreenWindow alloc] initWithContentRect:frame styleMask:style backing:NSBackingStoreBuffered defer:NO];
    _window.releasedWhenClosed = NO;
    _window.delegate = self;
    _window.titlebarAppearsTransparent = YES;
    _window.titleVisibility = NSWindowTitleHidden;
    _window.contentMinSize = kSmallest;
    NSVisualEffectView *root = [[NSVisualEffectView alloc] initWithFrame:NSMakeRect(0, 0, frame.size.width, frame.size.height)];
    root.material = NSVisualEffectMaterialUnderWindowBackground;
    root.blendingMode = NSVisualEffectBlendingModeBehindWindow;
    root.state = NSVisualEffectStateFollowsWindowActiveState;
    _window.contentView = root;
    _stage = [[NSView alloc] initWithFrame:root.bounds];
    [root addSubview:_stage];
    _frame = [[MVFrameView alloc] initWithFrame:NSZeroRect];
    _view = [[MVView alloc] initWithFrame:NSZeroRect];
    _view.wantsLayer = YES;
    _view.layer.backgroundColor = NSColor.blackColor.CGColor;
    _frame.screen = _view;
    _frame.showsFrame = ![NSUserDefaults.standardUserDefaults objectForKey:kFrameDefault] || [NSUserDefaults.standardUserDefaults boolForKey:kFrameDefault];
    [_stage addSubview:_frame];
    [_frame addSubview:_view];
    _plain = [self fill:[CALayer layer]];
    // laid out by hand: a layer turned on its side has no place in its parent's resizing
    _plain.autoresizingMask = kCALayerNotSizable;
    _plain.contentsGravity = kCAGravityResizeAspect;
    _video = (AVSampleBufferDisplayLayer *)[self fill:[AVSampleBufferDisplayLayer layer]];
    _video.autoresizingMask = kCALayerNotSizable;
    _video.videoGravity = AVLayerVideoGravityResizeAspect;
    _cutout = [self fill:[CALayer layer]];
    _cutout.autoresizingMask = kCALayerNotSizable;
    _cutout.backgroundColor = NSColor.blackColor.CGColor;
    _cutout.hidden = YES;
    _dim = [self fill:[CALayer layer]];
    _dim.backgroundColor = [NSColor colorWithWhite:0 alpha:0.6].CGColor;
    _dim.hidden = YES;
    _overlay = [[MVOverlay alloc] initInView:_view];
    _line = [[MVStatusLine alloc] initWithFrame:NSZeroRect];
    [_stage addSubview:_line];
    _inspector = [[MVInspector alloc] initWithFrame:NSZeroRect];
    _inspector.hidden = YES;
    [root addSubview:_inspector];
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
  _look = [attach[@"look"] isKindOfClass:NSDictionary.class] ? attach[@"look"] : @{};
  _kind = attach[@"source"][@"kind"];
  _view.controls = _look[@"controls"] ?: @[@"home", @"lock", @"volumeUp", @"volumeDown"];
  if (!_window.toolbar) {
    [self addToolbar];
    NSApp.mainMenu = MVMainMenu(_view.controls);
  }
  _window.poses = self.poses;
  _view.inputOn = ![attach[@"input"] isEqual:@NO];
  // a click once given stands: a reconnect does not take it back
  if (![attach[@"input"] isEqual:@"click"]) _view.armed = YES;
  // a restarted viewer keeps the zoom it had; a phone's picture size comes with its first frame
  if ([attach[@"zoom"] doubleValue] > 0) _zoom = [attach[@"zoom"] doubleValue];
  _line.name = _look[@"name"] ?: _name;
  [_window makeFirstResponder:_view];
  [self show:MVShowOf([attach[@"focus"] boolValue], self.behind)];
}

- (void)addToolbar {
  NSToolbar *toolbar = [[NSToolbar alloc] initWithIdentifier:@"device"];
  _toolbarItems = [[MVToolbar alloc] initWithControls:_view.controls target:self];
  toolbar.delegate = _toolbarItems;
  toolbar.displayMode = NSToolbarDisplayModeIconOnly;
  toolbar.allowsUserCustomization = NO;
  _window.toolbar = toolbar;
  _window.toolbarStyle = NSWindowToolbarStyleUnifiedCompact;
}

/// Everything laid out once, from the window's size: the device takes the room there is.
- (void)layoutPicture {
  NSRect all = _window.contentView.bounds;
  double side = _inspecting ? kInspector : 0;
  double top = _window.contentView.safeAreaInsets.top;
  _stage.frame = NSMakeRect(0, 0, all.size.width - side, all.size.height);
  _inspector.frame = NSMakeRect(all.size.width - side, 0, side, all.size.height);
  _line.frame = NSMakeRect(8, 6, _stage.frame.size.width - 16, kLine - 10);
  if (_picture.width <= 0) return;
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  double margin = _frame.showsFrame ? kMargin : 0;
  CGSize room = CGSizeMake(_stage.frame.size.width - 2 * margin, all.size.height - top - kLine - margin);
  CGSize body = [_frame bodyFor:_picture turns:_turns];
  double scale = MVFitScale(body, room);
  CGSize screen = CGSizeMake(_picture.width * scale, _picture.height * scale);
  CGSize drawn = [_frame bodyFor:screen turns:_turns];
  double bottom = kLine + (room.height - drawn.height) / 2;
  NSRect place = NSMakeRect(round((_stage.frame.size.width - drawn.width) / 2), round(bottom), drawn.width, drawn.height);
  [_frame layOutScreen:screen in:place turns:_turns];
  MVLayoutTurned(_plain, screen, _turns);
  MVLayoutTurned(_video, screen, _turns);
  [self placeCutout:screen];
  [CATransaction commit];
}

/// Over the picture only where the picture lacks one: a simulator draws its own.
- (void)placeCutout:(CGSize)screen {
  BOOL sideways = screen.width > screen.height;
  CGSize portrait = sideways ? CGSizeMake(screen.height, screen.width) : screen;
  CGRect cut = MVCutoutRect(_frame.spec, portrait);
  _cutout.hidden = !_frame.showsFrame || [_kind isEqual:@"surface"] || [_kind isEqual:@"pixels"] || CGRectIsEmpty(cut);
  // the layer's origin is at the bottom left; a turned device has its top at the window's left
  _cutout.frame = sideways ? CGRectMake(cut.origin.y, portrait.width - CGRectGetMaxX(cut), cut.size.height, cut.size.width)
                           : CGRectMake(cut.origin.x, portrait.height - CGRectGetMaxY(cut), cut.size.width, cut.size.height);
  _cutout.cornerRadius = MIN(cut.size.width, cut.size.height) / 2;
}

- (void)applySpec {
  NSDictionary *look = _look[@"frame"];
  _frame.spec = MVFrameSpecOf(look[@"model"], look[@"platform"], look[@"color"], _picture);
}

- (void)setPicture:(CGSize)size {
  if (size.width <= 0 || size.height <= 0 || CGSizeEqualToSize(size, _picture)) return;
  _picture = size;
  _view.picture = size;
  [self applySpec];
  if (_zoom <= 0 && !self.behind) {
    _window.frameAutosaveName = _name;
    double saved = [NSUserDefaults.standardUserDefaults doubleForKey:[self zoomKey]];
    if (saved > 0) _zoom = saved;
  }
  if (_zoom <= 0) _zoom = [self fitZoom];
  [self setZoom:_zoom];
}

- (NSString *)zoomKey {
  return [@"zoom." stringByAppendingString:_name ?: @""];
}

/// The chrome that never scales, at a given zoom's device.
- (CGSize)windowSizeAt:(double)zoom {
  CGSize body = [_frame bodyFor:CGSizeMake(_picture.width * zoom, _picture.height * zoom) turns:_turns];
  double margin = _frame.showsFrame ? kMargin : 0;
  double top = _window.contentView.safeAreaInsets.top;
  double side = _inspecting ? kInspector : 0;
  return CGSizeMake(MAX(body.width + 2 * margin, kOpensWide) + side, MAX(body.height + top + kLine + margin, kSmallest.height));
}

- (double)fitZoom {
  NSRect visible = (_window.screen ?: NSScreen.mainScreen).visibleFrame;
  double top = _window.contentView.safeAreaInsets.top;
  CGSize body = [_frame bodyFor:_picture turns:_turns];
  CGSize room = CGSizeMake(visible.size.width * kFitScreen - 2 * kMargin, visible.size.height * kFitScreen - top - kLine - kMargin);
  return MVFitScale(body, room);
}

- (void)setZoom:(double)zoom {
  _zoom = zoom;
  [_window setContentSize:[self windowSizeAt:zoom]];
  [self layoutPicture];
  [self sayZoom];
}

- (void)sayZoom {
  MVEmit(@{@"op": @"zoom", @"scale": @(_zoom)});
  if (!self.behind) [NSUserDefaults.standardUserDefaults setDouble:_zoom forKey:[self zoomKey]];
}

- (void)setTurns:(int)turns {
  _turns = turns;
  [self layoutPicture];
}

- (void)windowDidResize:(NSNotification *)notification {
  [self layoutPicture];
}

- (void)windowDidEndLiveResize:(NSNotification *)notification {
  if (_picture.width <= 0) return;
  _zoom = _view.bounds.size.width / _picture.width;
  [self sayZoom];
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
  NSString *state = message[@"state"];
  BOOL live = [state isEqual:@"live"];
  _line.state = live ? @"Live" : message[@"title"] ?: state;
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  _dim.hidden = live;
  [CATransaction commit];
  [_overlay showState:live ? nil : state title:message[@"title"] fix:message[@"fix"]];
  _window.title = live ? _name : [NSString stringWithFormat:@"%@: %@", _name, message[@"title"] ?: state];
}

- (void)setDriving:(BOOL)driving tool:(NSString *)tool {
  _line.tool = driving ? tool : nil;
  [_frame setDriving:driving];
}

- (void)sayNote:(NSString *)note {
  [_line say:note];
}

- (void)show:(MVShow)how {
  switch (how) {
    case MVShowBehind:
      _window.offscreen = YES;
      [_window setFrameOrigin:NSMakePoint(kOffscreenAt, kOffscreenAt)];
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

- (void)toggleInspector {
  double zoom = _zoom;
  _inspecting = !_inspecting;
  _inspector.hidden = !_inspecting;
  [self setZoom:zoom > 0 ? zoom : 1];
}

- (void)showPane:(NSInteger)pane {
  if (!_inspecting) [self toggleInspector];
  [_inspector showPane:pane];
}

- (void)showStats:(NSDictionary *)stats {
  if (_inspecting) [_inspector showStats:stats];
}

- (void)addActivity:(NSDictionary *)call {
  [_inspector addActivity:call];
}

- (void)showApps:(NSDictionary *)message {
  [_inspector showApps:message];
}

/// The toolbar's record button says a movie is being made.
- (void)setRecording:(BOOL)on {
  for (NSToolbarItem *item in _window.toolbar.items)
    if ([item.itemIdentifier isEqual:@"record"]) item.image = [NSImage imageWithSystemSymbolName:on ? @"stop.circle.fill" : @"record.circle" accessibilityDescription:on ? @"Stop Recording" : @"Record Screen"];
}

- (void)setFrameShown:(BOOL)shown {
  if (_frame.showsFrame == shown) return;
  _frame.showsFrame = shown;
  if (!self.behind) [NSUserDefaults.standardUserDefaults setBool:shown forKey:kFrameDefault];
  [self setZoom:_zoom > 0 ? _zoom : 1];
}

- (void)control:(id)sender {
  NSString *name = [sender respondsToSelector:@selector(representedObject)] ? [sender representedObject] : nil;
  if (![name isKindOfClass:NSString.class]) name = [sender respondsToSelector:@selector(itemIdentifier)] ? [sender itemIdentifier] : sender;
  [self perform:name];
}

- (void)perform:(NSString *)name {
  if ([name isEqual:@"zoomIn"] || [name isEqual:@"zoomOut"]) return [self setZoom:MVZoomStep(_zoom, [name isEqual:@"zoomIn"])];
  if ([name isEqual:@"zoomFit"]) return [self setZoom:[self fitZoom]];
  if ([name isEqual:@"zoomActual"]) return [self setZoom:MIN(_picture.width, _picture.height) > 0 ? _frame.spec.points / MIN(_picture.width, _picture.height) : 1];
  if ([name isEqual:@"frame"]) return [self setFrameShown:!_frame.showsFrame];
  if ([name isEqual:@"inspector"]) return [self toggleInspector];
  if ([@[@"screenshot", @"copy", @"record", @"reconnect"] containsObject:name]) return MVEmit(@{@"op": @"control", @"name": name});
  if ([name isEqual:@"paste"]) return [_view paste:self];
  [_view pressButton:name];
}

- (BOOL)validateUserInterfaceItem:(id<NSValidatedUserInterfaceItem>)item {
  if (item.action != @selector(control:)) return YES;
  id object = [(id)item respondsToSelector:@selector(representedObject)] ? [(id)item representedObject] : nil;
  if ([object isEqual:@"frame"]) [(NSMenuItem *)item setState:_frame.showsFrame ? NSControlStateValueOn : NSControlStateValueOff];
  if ([object isEqual:@"inspector"]) [(NSMenuItem *)item setState:_inspecting ? NSControlStateValueOn : NSControlStateValueOff];
  return YES;
}

- (void)pokeX:(double)x y:(double)y right:(BOOL)right {
  NSPoint inView = NSMakePoint(x * _view.bounds.size.width, (1 - y) * _view.bounds.size.height);
  NSPoint at = [_view convertPoint:inView toView:nil];
  NSInteger number = _window.windowNumber;
  void (^post)(NSEventType) = ^(NSEventType type) {
    [NSApp postEvent:[NSEvent mouseEventWithType:type location:at modifierFlags:0 timestamp:0 windowNumber:number context:nil eventNumber:0 clickCount:1 pressure:1] atStart:NO];
  };
  post(right ? NSEventTypeRightMouseDown : NSEventTypeLeftMouseDown);
  // as long as a mouse's: a touch that lifts in the instant it lands is no tap to a device
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kClickSeconds * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    post(right ? NSEventTypeRightMouseUp : NSEventTypeLeftMouseUp);
  });
}

- (BOOL)snapshot:(NSString *)file {
  return MVWriteWindow(_window, file);
}

- (void)pokeButton:(NSString *)name {
  [_view pressButton:name];
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
