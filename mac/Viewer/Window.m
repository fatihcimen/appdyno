// The window: the device on a backdrop drawn from its own picture, full bleed, with glass floating over it: its status,
// its controls and the Inspector. The picture's view is exactly the device's screen, so its maths never hear of a frame.
#import "WindowParts.h"
#import "Words.h"

// a new window takes at most this much of the screen
static const double kFitScreen = 0.85;
// far from every screen a Mac can have
static const double kOffscreenAt = -30000;
static const double kMargin = 24, kTop = 68, kBottom = 24, kInset = 10;
static const double kFirstFrameSeconds = 0.2;
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

/// A sidebar or an Inspector that opens or closes moves the insets, and no frame.
- (void)layout {
  [super layout];
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
    _backdrop = room ? ((MVRoomView *)room).backdrop : [[MVBackdrop alloc] initInView:root window:_window];
    _root = root;
    __weak MVWindow *held = self;
    root.onResize = ^{
      [held layoutPicture];
    };
    if (room) {
      root.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
      [room addSubview:root];
      _room = (MVRoomView *)room;
      _slot = _room.slot;
    } else {
      [self splitAround:root];
    }
    _stage = [[NSView alloc] initWithFrame:root.bounds];
    [root addSubview:_stage];
    _frame = [[MVFrameView alloc] initWithFrame:NSZeroRect];
    _view = [[MVView alloc] initWithFrame:NSZeroRect];
    _view.menuTarget = self;
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
    _line.onChange = ^{
      [held showState];
    };
    _inspector = [[MVInspector alloc] initWithFrame:NSZeroRect target:self];
    _inspector.of = root;
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
  }
  return self;
}

/// How a device is, said once: a colour around it and the capsule over it. The window's title stays for the Window menu and
/// Mission Control, and the bar says it, as the system's own title fades to 2:1 in a window behind others.
- (void)showState {
  NSColor *edge = _recording || _line.failing ? MVRed() : _waitingForPerson ? MVOrange()
                                                      : _line.tool          ? MVAgent()
                                                      : _line.both          ? MVAccent()
                                                                            : nil;
  [_frame setEdge:edge];
  [self showSide];
  if (_window.toolbar != _toolbar) return;
  _window.title = _line.name ?: @"";
  [_bar setName:_line.name ?: @"" about:_line.about];
  [_bar.capsule show:_line];
}

/// Off its room, which stays for the next device.
- (void)leave {
  [_root removeFromSuperview];
  [self letGoOfInspector];
  if (_window.toolbar != _toolbar) return;
  _window.toolbar = _room.bare;
  _window.title = MVWord(@"Devices");
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
  // one name everywhere: a room says what its sidebar says
  NSDictionary *row = _room.rowOf ? _room.rowOf(_root.stage ?: @"") : nil;
  _line.name = row[@"title"] ?: _look[@"name"] ?
                                               : _name;
  [self showState];
  [_window makeFirstResponder:_view];
  if (!_hosted) MVPresent(_window, MVShowOf([attach[@"focus"] boolValue], self.behind));
}

/// Everything laid out once, from the window's size: the device takes the room there is.
- (void)layoutPicture {
  _side = _room ? [_room sideOf:_root] : -1;
  NSRect all = _root.bounds;
  // what stands under a sidebar and an Inspector is the backdrop's
  NSEdgeInsets under = _root.safeAreaInsets;
  _stage.frame = NSMakeRect(under.left, 0, all.size.width - [self sideWidth] - under.left - under.right, all.size.height);
  _hud.frame = NSMakeRect(all.size.width - under.right - MVHudWidth - kInset, kInset, MVHudWidth, all.size.height - kTop - kInset);
  if (_picture.width <= 0) return;
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  double margin = _frame.showsFrame ? kMargin : 0;
  CGSize room = CGSizeMake(_stage.frame.size.width - 2 * margin, all.size.height - kTop - kBottom);
  CGSize body = [_frame bodyFor:_picture];
  double scale = MVFitScale(body, room);
  CGSize screen = CGSizeMake(_picture.width * scale, _picture.height * scale);
  CGSize drawn = [_frame bodyFor:screen];
  double bottom = kBottom + (room.height - drawn.height) / 2;
  NSRect place = NSMakeRect(round((_stage.frame.size.width - drawn.width) / 2), round(bottom), drawn.width, drawn.height);
  [_frame layOutScreen:screen in:place];
  [self showSide];
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
  // the bezel stands at once, and the first frame comes up in it
  if (_picture.width <= 0) MVFade(_view.layer, 0, 1, kFirstFrameSeconds);
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

/// What the numbers beside the device take of the room it has.
- (double)sideWidth {
  return _hudding ? MVHudWidth + kInset : 0;
}

- (BOOL)inspecting {
  return _slot.pane == _inspector && !_slot.item.collapsed;
}

/// The chrome that never scales, at a given zoom's device.
- (CGSize)windowSizeAt:(double)zoom {
  CGSize body = [_frame bodyFor:CGSizeMake(_picture.width * zoom, _picture.height * zoom)];
  double margin = _frame.showsFrame ? kMargin : 0;
  return CGSizeMake(MAX(body.width + 2 * margin, kOpensWide) + [self sideWidth] + (self.inspecting ? MVInspectorWidth : 0), MAX(body.height + kTop + kBottom, kSmallest.height));
}

- (double)fitZoom {
  NSRect visible = (_window.screen ?: NSScreen.mainScreen).visibleFrame;
  CGSize body = [_frame bodyFor:_picture];
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
  [_slot fitWindow:_window.frame.size.width least:kSmallest.width + MVInspectorWidth];
  [self layoutPicture];
}

- (void)windowDidEndLiveResize:(NSNotification *)notification {
  if (_picture.width <= 0 || _hosted) return;
  _zoom = _view.bounds.size.width / _picture.width;
  [self sayZoom];
}

- (void)showSurface:(IOSurfaceRef)surface {
  [_layers showSurface:surface];
  [_backdrop followSurface:surface side:_side];
}

- (BOOL)showImage:(CVImageBufferRef)image {
  [_backdrop followImage:image side:_side];
  return [_layers showImage:image];
}

- (void)setStatus:(NSDictionary *)message {
  NSString *state = message[@"state"];
  BOOL live = [state isEqual:@"live"];
  _line.state = live ? @"Live" : message[@"title"] ?
                                                   : state;
  _line.live = live;
  _line.stuck = [state isEqual:@"waiting"] || [state isEqual:@"stopped"];
  [self showState];
  [_layers setDimmed:!live];
  [_overlay showState:live ? nil : state title:message[@"title"] fix:message[@"fix"]];
}

- (void)setDriving:(BOOL)driving tool:(NSString *)tool client:(nullable NSString *)client {
  _line.tool = driving ? tool : nil;
  _line.client = driving ? client : nil;
  [self showState];
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
  [self openInspector:!self.inspecting];
  [self setZoom:zoom > 0 ? zoom : 1];
}

- (void)showPane:(NSInteger)pane {
  if (!self.inspecting) [self openInspector:YES];
  [_inspector showPane:pane];
}

/// A source runs only while something shows it: what it reads costs the device.
- (void)watchReadings {
  BOOL wanted = _hudding || (self.inspecting && _inspector.readings);
  if (wanted == _reading) return;
  _reading = wanted;
  MVEmitFrom(_view, @{@"op": @"perfWatch", @"on": @(wanted)});
}

/// In a room the numbers are the Inspector's, on Performance; a window of its own has them beside the device too.
- (void)toggleHud {
  if (_hosted) return self.inspecting && _inspector.readings ? [self toggleInspector] : [self showPane:MVPanePerf];
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
  if (!self.inspecting) [self showPane:MVPanePerf];
  if (![message[@"op"] isEqual:@"measured"]) {
    [_inspector.perf showMeasuring:message[@"line"] ?: @""];
    [self sayMeasuring:message[@"line"] ?: @""];
    return;
  }
  [_inspector.perf showMeasured:message];
  [self sayMeasuring:nil];
}

- (void)showStats:(NSDictionary *)stats {
  [_hud setPictureRate:[stats[@"shown"] doubleValue]];
  [_inspector.perf setPictureRate:[stats[@"shown"] doubleValue]];
  [_inspector showStats:stats];
  if (_line.rate == [stats[@"shown"] doubleValue]) return;
  _line.rate = [stats[@"shown"] doubleValue];
  [self showState];
}

/// The capsule's words for what a measure says it is at, and how far that is where it counts: `scroll round 3 of 5`.
- (void)sayMeasuring:(nullable NSString *)line {
  NSRegularExpression *count = [NSRegularExpression regularExpressionWithPattern:@"(\\d+) of (\\d+)" options:0 error:NULL];
  NSTextCheckingResult *found = line ? [count firstMatchInString:line options:0 range:NSMakeRange(0, line.length)] : nil;
  _line.measuring = found ? [@"Measuring " stringByAppendingString:line] : line.length ? line
                                                                                       : nil;
  _line.progress = found ? [line substringWithRange:[found rangeAtIndex:1]].doubleValue / [line substringWithRange:[found rangeAtIndex:2]].doubleValue : 0;
  [self showState];
}

/// A request for a person: words over the picture, and orange around it until it is answered.
- (void)askPerson:(NSDictionary *)message {
  _waitingForPerson = message[@"id"] != nil;
  if (_waitingForPerson) [_overlay showBanner:message];
  else [_overlay hideBanner];
  [self showState];
}

- (void)addActivity:(NSDictionary *)call {
  [_inspector addActivity:call];
}

- (void)showApps:(NSDictionary *)message {
  [_inspector showApps:message];
}

/// The toolbar's record button says a movie is being made.
- (void)setRecording:(BOOL)on {
  [_bar paint:@"record" symbol:on ? @"stop.circle.fill" : @"record.circle" color:on ? MVRed() : MVInkColor()];
  [_bar buttonNamed:@"record"].accessibilityLabel = MVWord(on ? @"Stop Recording" : @"Record Screen");
  _recording = on;
  _line.recording = on;
  [self showState];
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

- (MVToolbar *)bar {
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
