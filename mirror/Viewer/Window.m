// The window: the device on a backdrop drawn from its own picture, full bleed, with glass floating over it: its status,
// its controls and the Inspector. The picture's view is exactly the device's screen, so its maths never hear of a frame.
#import "WindowParts.h"

// a new window takes at most this much of the screen
static const double kFitScreen = 0.85;
// far from every screen a Mac can have
static const double kOffscreenAt = -30000;
static const double kMargin = 30, kTop = 72, kBottom = 30, kInspector = 300, kInset = 10;
static const CGSize kSmallest = {380, 420};
// wide enough that a toolbar shows all it has; a person can go narrower, and it folds into its own menu
static const double kOpensWide = 780;
static NSString *const kFrameDefault = @"showsDeviceFrame";

MVShow MVShowOf(BOOL focus, BOOL behind) {
  if (behind) return MVShowBehind;
  return focus ? MVShowFocused : MVShowFront;
}

@implementation MVRootView
- (void)setFrameSize:(NSSize)size {
  [super setFrameSize:size];
  if (self.onResize) self.onResize();
}
@end

@implementation MVWindow

- (MVOffscreenWindow *)ownWindow {
  NSRect frame = NSMakeRect(80, 80, 440, 760);
  NSWindowStyleMask style = NSWindowStyleMaskTitled | NSWindowStyleMaskClosable | NSWindowStyleMaskMiniaturizable | NSWindowStyleMaskResizable | NSWindowStyleMaskFullSizeContentView;
  MVOffscreenWindow *window = [[MVOffscreenWindow alloc] initWithContentRect:frame styleMask:style backing:NSBackingStoreBuffered defer:NO];
  window.releasedWhenClosed = NO;
  window.delegate = self;
  window.titlebarAppearsTransparent = YES;
  window.contentMinSize = kSmallest;
  return window;
}

- (instancetype)init {
  return [self initInRoom:nil];
}

- (instancetype)initInRoom:(nullable NSView *)room {
  if ((self = [super init])) {
    _hosted = room != nil;
    _window = room ? (MVOffscreenWindow *)room.window : [self ownWindow];
    MVRootView *root = [[MVRootView alloc] initWithFrame:room ? room.bounds : NSMakeRect(0, 0, 440, 760)];
    root.wantsLayer = YES;
    _backdrop = [[MVBackdrop alloc] initInView:root window:_window];
    _root = root;
    __weak MVWindow *held = self;
    if (room) {
      root.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
      root.onResize = ^{
        [held layoutPicture];
      };
      [room addSubview:root];
    } else {
      _window.contentView = root;
    }
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
    _view.onTouched = ^{
      [held useToolbar];
    };
    _layers = [[MVPictureLayers alloc] initInView:_view];
    _overlay = [[MVOverlay alloc] initInView:_view];
    _line = [MVStatusLine new];
    _line.onChange = ^(NSString *subtitle) {
      [held sayStatus:subtitle];
    };
    _inspector = [[MVInspector alloc] initWithFrame:NSZeroRect target:self];
    __weak MVWindow *weak = self;
    _inspector.onPane = ^{
      [weak watchReadings];
      [weak watchElements];
    };
    _inspector.flow.onClick = ^{
      [weak watchElements];
    };
    _hud = [[MVHud alloc] initWithFrame:NSZeroRect];
    _hud.hidden = YES;
    [root addSubview:_hud];
    _panel = MVGlass(_inspector, 22, nil);
    _panel.translatesAutoresizingMaskIntoConstraints = YES;
    _panel.hidden = YES;
    [root addSubview:_panel];
  }
  return self;
}

/// A device and how it is, as the system's title and subtitle: in a room the window is the hub's, and says the one chosen.
- (void)sayStatus:(NSString *)subtitle {
  if (_window.toolbar != _toolbar) return;
  _window.title = _line.name ?: @"";
  _window.subtitle = subtitle;
}

/// Off its room, which stays for the next device.
- (void)leave {
  [_root removeFromSuperview];
  if (_window.toolbar != _toolbar) return;
  _window.toolbar = nil;
  _window.title = @"Devices";
  _window.subtitle = @"";
}

- (void)configure:(NSDictionary *)attach {
  _name = attach[@"title"] ?: @"appdyno";
  _root.stage = attach[@"stage"];
  _look = [attach[@"look"] isKindOfClass:NSDictionary.class] ? attach[@"look"] : @{};
  _kind = attach[@"source"][@"kind"];
  _view.controls = _look[@"controls"] ?: @[@"home", @"lock", @"volumeUp", @"volumeDown"];
  if (!_bar) {
    [self addControls];
    if (!_hosted) NSApp.mainMenu = MVMainMenu(_view.controls);
  }
  if (!_hosted) _window.poses = self.poses;
  _view.inputOn = ![attach[@"input"] isEqual:@NO];
  // a click once given stands: a reconnect does not take it back
  if (![attach[@"input"] isEqual:@"click"]) _view.armed = YES;
  // a restarted viewer keeps the zoom it had; a phone's picture size comes with its first frame
  if ([attach[@"zoom"] doubleValue] > 0) _zoom = [attach[@"zoom"] doubleValue];
  _line.name = _look[@"name"] ?: _name;
  [_window makeFirstResponder:_view];
  if (!_hosted) MVPresent(_window, MVShowOf([attach[@"focus"] boolValue], self.behind));
}

/// Everything laid out once, from the window's size: the device takes the room there is.
- (void)layoutPicture {
  NSRect all = _root.bounds;
  double side = [self sideWidth];
  // what stands under a sidebar is the backdrop's
  double under = _root.safeAreaInsets.left;
  _stage.frame = NSMakeRect(under, 0, all.size.width - side - under, all.size.height);
  _panel.frame = NSMakeRect(all.size.width - kInspector - kInset, kInset, kInspector, all.size.height - kTop - kInset);
  double beside = all.size.width - (_inspecting ? kInspector + kInset : 0) - MVHudWidth - kInset;
  _hud.frame = NSMakeRect(beside, kInset, MVHudWidth, all.size.height - kTop - kInset);
  if (_picture.width <= 0) return;
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  double margin = _frame.showsFrame ? kMargin : 0;
  CGSize room = CGSizeMake(_stage.frame.size.width - 2 * margin, all.size.height - kTop - kBottom);
  CGSize body = [_frame bodyFor:_picture turns:_turns];
  double scale = MVFitScale(body, room);
  CGSize screen = CGSizeMake(_picture.width * scale, _picture.height * scale);
  CGSize drawn = [_frame bodyFor:screen turns:_turns];
  double bottom = kBottom + (room.height - drawn.height) / 2;
  NSRect place = NSMakeRect(round((_stage.frame.size.width - drawn.width) / 2), round(bottom), drawn.width, drawn.height);
  [_frame layOutScreen:screen in:place turns:_turns];
  // a simulator's picture has its island in it and no notch, and an emulator's has what its device has
  BOOL drawsItsOwn = [_kind isEqual:@"pixels"] || ([_kind isEqual:@"surface"] && _frame.spec.cutout == MVCutoutIsland);
  CGSize portrait = screen.width > screen.height ? CGSizeMake(screen.height, screen.width) : screen;
  [_layers layOut:screen turns:_turns cutout:_frame.showsFrame && !drawsItsOwn ? MVCutoutRect(_frame.spec, portrait) : CGRectZero];
  [CATransaction commit];
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
  if (_zoom <= 0 && !self.behind && !_hosted) {
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

/// What the panes beside the device take of the window.
- (double)sideWidth {
  return (_inspecting ? kInspector + kInset : 0) + (_hudding ? MVHudWidth + kInset : 0);
}

/// The chrome that never scales, at a given zoom's device.
- (CGSize)windowSizeAt:(double)zoom {
  CGSize body = [_frame bodyFor:CGSizeMake(_picture.width * zoom, _picture.height * zoom) turns:_turns];
  double margin = _frame.showsFrame ? kMargin : 0;
  return CGSizeMake(MAX(body.width + 2 * margin, kOpensWide) + [self sideWidth], MAX(body.height + kTop + kBottom, kSmallest.height));
}

- (double)fitZoom {
  NSRect visible = (_window.screen ?: NSScreen.mainScreen).visibleFrame;
  CGSize body = [_frame bodyFor:_picture turns:_turns];
  CGSize room = CGSizeMake(visible.size.width * kFitScreen - 2 * kMargin, visible.size.height * kFitScreen - kTop - kBottom);
  return MVFitScale(body, room);
}

/// A window of its own takes the device's size; in a room the device takes the room's.
- (void)setZoom:(double)zoom {
  _zoom = zoom;
  if (_hosted) return [self layoutPicture];
  [_window setContentSize:[self windowSizeAt:zoom]];
  [self placeBeside];
  [self layoutPicture];
  [self sayZoom];
}

- (void)sayZoom {
  MVEmitFrom(_view, @{@"op": @"zoom", @"scale": @(_zoom)});
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
  if (_picture.width <= 0 || _hosted) return;
  _zoom = _view.bounds.size.width / _picture.width;
  [self sayZoom];
}

- (void)showSurface:(IOSurfaceRef)surface {
  [_layers showSurface:surface];
  [_backdrop followSurface:surface];
}

- (BOOL)showImage:(CVImageBufferRef)image {
  [_backdrop followImage:image];
  return [_layers showImage:image];
}

- (void)setStatus:(NSDictionary *)message {
  NSString *state = message[@"state"];
  BOOL live = [state isEqual:@"live"];
  _line.state = live ? @"Live" : message[@"title"] ?: state;
  [_layers setDimmed:!live];
  [_overlay showState:live ? nil : state title:message[@"title"] fix:message[@"fix"]];
}

/// One colour around the device says what is happening to it, and the window's subtitle says it in words.
- (void)tintPill {
  NSColor *red = NSColor.systemRedColor, *accent = NSColor.controlAccentColor;
  [_frame setEdge:_recording || _line.failing ? red : _line.tool || _line.both ? accent : nil];
}

- (void)setDriving:(BOOL)driving tool:(NSString *)tool {
  _line.tool = driving ? tool : nil;
  [self tintPill];
}

- (void)sayNote:(NSString *)note {
  [_line say:note];
}

void MVPresent(MVOffscreenWindow *window, MVShow how) {
  switch (how) {
    case MVShowBehind:
      window.offscreen = YES;
      [window setFrameOrigin:NSMakePoint(kOffscreenAt, kOffscreenAt)];
      [window orderBack:nil];
      break;
    case MVShowFront:
      [window orderFrontRegardless];
      break;
    case MVShowFocused:
      window.personHere = YES;
      NSApp.activationPolicy = NSApplicationActivationPolicyRegular;
      [window makeKeyAndOrderFront:nil];
      [NSApp activateIgnoringOtherApps:YES];
      break;
  }
}

- (void)raise {
  if (!_hosted) MVPresent(_window, MVShowOf(NO, self.behind));
}

- (void)toggleInspector {
  double zoom = _zoom;
  _inspecting = !_inspecting;
  MVShowPane(_panel, _inspecting);
  [self watchReadings];
  [self watchElements];
  [self setZoom:zoom > 0 ? zoom : 1];
}

- (void)showPane:(NSInteger)pane {
  if (!_inspecting) [self toggleInspector];
  [_inspector showPane:pane];
}

/// A source runs only while something shows it: what it reads costs the device.
- (void)watchReadings {
  BOOL wanted = _hudding || (_inspecting && _inspector.readings);
  if (wanted == _reading) return;
  _reading = wanted;
  MVEmitFrom(_view, @{@"op": @"perfWatch", @"on": @(wanted)});
}

/// In a room the numbers are the Inspector's, on Performance; a window of its own has them beside the device too.
- (void)toggleHud {
  if (_hosted) return _inspecting && _inspector.readings ? [self toggleInspector] : [self showPane:MVPanePerf];
  _hudding = !_hudding;
  MVShowPane(_hud, _hudding);
  [self watchReadings];
  [self setZoom:_zoom > 0 ? _zoom : 1];
}

- (void)showPerf:(NSDictionary *)message {
  if (_hudding) [_hud show:message];
  [_inspector.perf show:message];
}

- (void)showMeasure:(NSDictionary *)message {
  if (!_inspecting) [self showPane:MVPanePerf];
  if (![message[@"op"] isEqual:@"measured"]) return [_inspector.perf showMeasuring:message[@"line"] ?: @""];
  [_inspector.perf showMeasured:message];
}

- (void)showStats:(NSDictionary *)stats {
  [_hud setPictureRate:[stats[@"shown"] doubleValue]];
  [_inspector.perf setPictureRate:[stats[@"shown"] doubleValue]];
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
  NSButton *button = [_bar buttonNamed:@"record"];
  button.image = [NSImage imageWithSystemSymbolName:on ? @"stop.circle.fill" : @"record.circle" accessibilityDescription:on ? @"Stop Recording" : @"Record Screen"];
  button.contentTintColor = on ? NSColor.systemRedColor : NSColor.labelColor;
  _recording = on;
  [self tintPill];
}

- (void)setFrameShown:(BOOL)shown {
  if (_frame.showsFrame == shown) return;
  _frame.showsFrame = shown;
  if (!self.behind) [NSUserDefaults.standardUserDefaults setBool:shown forKey:kFrameDefault];
  [self setZoom:_zoom > 0 ? _zoom : 1];
}

- (NSWindow *)nsWindow {
  return _window;
}

- (NSView *)screenView {
  return _view;
}

- (MVStatusLine *)line {
  return _line;
}

- (NSView *)bar {
  return _bar;
}

- (NSDictionary *)look {
  return _look;
}

- (void)windowDidChangeOcclusionState:(NSNotification *)notification {
  if (self.onHidden) self.onHidden(!(_window.occlusionState & NSWindowOcclusionStateVisible));
}

- (void)windowWillClose:(NSNotification *)notification {
  MVEmit(@{@"op": @"closed"});
  exit(0);
}

@end
